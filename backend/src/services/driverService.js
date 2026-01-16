const { query, queryRead, executeTransaction } = require('../config/database');
const { 
  getRedisClient,
  cacheGetOrSet, 
  invalidateCache, 
  addDriverLocation, 
  removeDriverLocation 
} = require('../config/redis');
const { publishLocationUpdate, publishNotification } = require('../config/kafka');
const { NotFoundError, ConflictError, InvalidStateTransitionError } = require('../utils/errors');
const {
  cacheGet,
  cacheSet,
  getOrCompute,
  CACHE_KEYS,
  CACHE_TTL,
  invalidateDriverCache,
} = require('./cacheService');

// =============================================
// LOCATION UPDATE BATCHING FOR HIGH THROUGHPUT
// =============================================

// Batch location updates for database writes (reduces DB load)
const locationBatch = [];
const BATCH_SIZE = 100;
const BATCH_INTERVAL_MS = 1000;
let batchTimer = null;

const flushLocationBatch = async () => {
  if (locationBatch.length === 0) return;
  
  const batch = locationBatch.splice(0, locationBatch.length);
  
  try {
    // Batch insert using VALUES list (much faster than individual inserts)
    const values = batch.map((_, i) => {
      const offset = i * 6;
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`;
    }).join(', ');
    
    const params = batch.flatMap(loc => [
      loc.driverId, loc.latitude, loc.longitude, 
      loc.heading, loc.speed, loc.accuracy
    ]);
    
    await query(
      `INSERT INTO driver_locations (driver_id, latitude, longitude, heading, speed, accuracy)
       VALUES ${values}`,
      params
    );
  } catch (err) {
    console.error('Batch location insert failed:', err.message);
  }
};

// Start batch timer
const startBatchTimer = () => {
  if (!batchTimer) {
    batchTimer = setInterval(flushLocationBatch, BATCH_INTERVAL_MS);
  }
};

/**
 * Get driver by ID with caching
 */
const getDriverById = async (id) => {
  const cacheKey = CACHE_KEYS.DRIVER(id);
  
  const driver = await getOrCompute(cacheKey, CACHE_TTL.DRIVER, async () => {
    const result = await queryRead(
      'SELECT * FROM drivers WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  });

  if (!driver) {
    throw new NotFoundError('Driver');
  }

  return driver;
};

/**
 * OPTIMIZED: Update driver location
 * - Uses Redis for real-time geo-indexing (no DB lookup)
 * - Batches DB writes for history
 * - Publishes to Kafka async
 */
const updateLocation = async (driverId, locationData) => {
  const { latitude, longitude, heading, speed, accuracy } = locationData;

  // Get driver status from Redis cache (fast path)
  const redis = getRedisClient();
  const statusKey = `driver:status:${driverId}`;
  let driverInfo = await redis.hgetall(statusKey);
  
  // If not in cache, fetch from DB and cache
  if (!driverInfo || !driverInfo.status) {
    const result = await queryRead(
      'SELECT id, status, vehicle_type, tenant_id FROM drivers WHERE id = $1',
      [driverId]
    );
    
    if (result.rows.length === 0) {
      throw new NotFoundError('Driver');
    }
    
    driverInfo = result.rows[0];
    
    // Cache driver info in hash for fast access
    await redis.hmset(statusKey, {
      status: driverInfo.status,
      vehicle_type: driverInfo.vehicle_type,
      tenant_id: driverInfo.tenant_id,
    });
    await redis.expire(statusKey, CACHE_TTL.DRIVER_STATUS);
  }

  // Update geo-index if driver is online (Redis GEO - O(log(N)))
  if (driverInfo.status === 'online') {
    await addDriverLocation(driverInfo.vehicle_type, driverId, longitude, latitude);
  }

  // Batch location for DB history (async, non-blocking)
  locationBatch.push({
    driverId, latitude, longitude, heading, speed, accuracy
  });
  startBatchTimer();

  // Publish to Kafka (fire and forget for latency)
  publishLocationUpdate(driverId, driverInfo.tenant_id, {
    latitude,
    longitude,
    heading,
    speed,
    vehicle_type: driverInfo.vehicle_type,
    status: driverInfo.status,
  }).catch(err => console.error('Kafka publish failed:', err.message));

  return {
    driver_id: driverId,
    latitude,
    longitude,
    timestamp: new Date().toISOString(),
  };
};

/**
 * Update driver status with cache invalidation
 */
const updateDriverStatus = async (driverId, status) => {
  const validStatuses = ['online', 'offline', 'busy'];
  if (!validStatuses.includes(status)) {
    throw new ConflictError(`Invalid status: ${status}`);
  }

  const result = await query(
    `UPDATE drivers SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [status, driverId]
  );

  if (result.rowCount === 0) {
    throw new NotFoundError('Driver');
  }

  const driver = result.rows[0];
  const redis = getRedisClient();

  // Update Redis cache immediately
  const statusKey = `driver:status:${driverId}`;
  await redis.hmset(statusKey, {
    status: driver.status,
    vehicle_type: driver.vehicle_type,
    tenant_id: driver.tenant_id,
  });
  await redis.expire(statusKey, CACHE_TTL.DRIVER_STATUS);

  // Update geo-index based on status
  if (status === 'online') {
    // Get latest location
    const locationResult = await queryRead(
      `SELECT latitude, longitude FROM driver_locations 
       WHERE driver_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
      [driverId]
    );
    
    if (locationResult.rows[0]) {
      const { latitude, longitude } = locationResult.rows[0];
      await addDriverLocation(driver.vehicle_type, driverId, longitude, latitude);
    }
  } else {
    // Remove from geo-index when offline or busy
    await removeDriverLocation(driver.vehicle_type, driverId);
  }

  // Invalidate other caches
  await invalidateDriverCache(driverId);

  return driver;
};

/**
 * OPTIMIZED: Get driver status (Redis hash for sub-ms latency)
 */
const getDriverStatus = async (driverId) => {
  const redis = getRedisClient();
  const statusKey = `driver:status:${driverId}`;
  
  // Try Redis hash first (faster than full cache)
  let info = await redis.hgetall(statusKey);
  
  if (info && info.status) {
    return {
      id: driverId,
      status: info.status,
      vehicle_type: info.vehicle_type,
    };
  }
  
  // Fallback to DB
  const result = await queryRead(
    'SELECT id, status, vehicle_type, tenant_id FROM drivers WHERE id = $1',
    [driverId]
  );
  
  if (result.rows.length === 0) {
    return null;
  }
  
  const driver = result.rows[0];
  
  // Cache for next time
  await redis.hmset(statusKey, {
    status: driver.status,
    vehicle_type: driver.vehicle_type,
    tenant_id: driver.tenant_id,
  });
  await redis.expire(statusKey, CACHE_TTL.DRIVER_STATUS);
  
  return driver;
};

/**
 * Get drivers by tenant with pagination
 */
const getDriversByTenant = async (tenantId, options = {}) => {
  const { status = null, limit = 50, offset = 0 } = options;

  let queryStr = 'SELECT * FROM drivers WHERE tenant_id = $1';
  const params = [tenantId];

  if (status) {
    queryStr += ` AND status = $${params.length + 1}`;
    params.push(status);
  }

  queryStr += ` ORDER BY rating DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const result = await queryRead(queryStr, params);
  return result.rows;
};

/**
 * OPTIMIZED: Get online drivers count (cached)
 */
const getOnlineDriversCount = async (tenantId) => {
  const cacheKey = `online_drivers:${tenantId}`;
  
  return getOrCompute(cacheKey, 30, async () => {
    const result = await queryRead(
      `SELECT vehicle_type, COUNT(*) as count 
       FROM drivers 
       WHERE tenant_id = $1 AND status = 'online'
       GROUP BY vehicle_type`,
      [tenantId]
    );

    return result.rows.reduce((acc, row) => {
      acc[row.vehicle_type] = parseInt(row.count);
      return acc;
    }, {});
  });
};

/**
 * Update driver rating after trip (atomic)
 */
const updateDriverRating = async (driverId, newRating) => {
  const result = await query(
    `UPDATE drivers 
     SET rating = (rating * total_rides + $1) / (total_rides + 1),
         total_rides = total_rides + 1,
         updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [newRating, driverId]
  );

  if (result.rowCount === 0) {
    throw new NotFoundError('Driver');
  }

  await invalidateDriverCache(driverId);
  return result.rows[0];
};

/**
 * OPTIMIZED: Get pending ride offers (uses index)
 */
const getPendingOffers = async (driverId) => {
  // Use the optimized index: idx_ride_offers_pending_expiry
  const result = await queryRead(
    `SELECT 
       ro.id as offer_id,
       ro.ride_id,
       ro.expires_at,
       ro.offered_at,
       r.pickup_lat,
       r.pickup_lng,
       r.dropoff_lat,
       r.dropoff_lng,
       r.tier,
       r.estimated_fare,
       r.estimated_distance_km,
       ri.name as rider_name
     FROM ride_offers ro
     JOIN rides r ON ro.ride_id = r.id
     JOIN riders ri ON r.rider_id = ri.id
     WHERE ro.driver_id = $1 
       AND ro.status = 'pending'
       AND ro.expires_at > NOW()
     ORDER BY ro.offered_at DESC
     LIMIT 1`,
    [driverId]
  );

  return result.rows;
};

/**
 * Get driver's pending offers (for polling fallback)
 */
const getDriverPendingOffers = async (driverId) => {
  const offers = await getPendingOffers(driverId);
  return offers[0] || null;
};

// Cleanup on shutdown
const cleanup = async () => {
  if (batchTimer) {
    clearInterval(batchTimer);
    batchTimer = null;
  }
  await flushLocationBatch();
};

module.exports = {
  getDriverById,
  updateLocation,
  updateDriverStatus,
  getDriverStatus,
  getDriversByTenant,
  getOnlineDriversCount,
  updateDriverRating,
  getPendingOffers,
  getDriverPendingOffers,
  cleanup,
};
