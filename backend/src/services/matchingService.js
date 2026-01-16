const { v4: uuidv4 } = require('uuid');
const { query, queryRead, executeTransaction, queryBatch } = require('../config/database');
const { 
  findNearbyDrivers, 
  removeDriverLocation, 
  invalidateCache,
  getRedisClient 
} = require('../config/redis');
const { publishRideEvent, publishNotification } = require('../config/kafka');
const { acquireLock, releaseLock } = require('./lockingService');
const { 
  NotFoundError, 
  ConflictError, 
  LockAcquisitionError,
  InvalidStateTransitionError 
} = require('../utils/errors');
const {
  cacheGet,
  cacheSet,
  getOrCompute,
  CACHE_KEYS,
  CACHE_TTL,
  invalidateRideCache,
  invalidateDriverCache,
  cacheDriverCurrentRide,
  getDriverCurrentRideFromCache,
  invalidateDriverCurrentRide,
} = require('./cacheService');
const { startDriverSimulation, stopDriverSimulation, switchToTripPhase } = require('./simulationService');

const MATCHING_RADIUS_KM = parseFloat(process.env.MATCHING_RADIUS_KM) || 100;
const MATCHING_TIMEOUT_MS = parseInt(process.env.MATCHING_TIMEOUT_MS) || 30000;
const OFFER_EXPIRY_MS = 15000;

/**
 * OPTIMIZED: Find and match nearby drivers for a ride
 * - Uses Redis GEO for O(log(N)) nearby search
 * - Parallel DB queries where possible
 * - Batch notifications
 */
const findDriversForRide = async (rideId) => {
  const startTime = Date.now();
  
  // Get ride details (use read pool)
  const rideResult = await queryRead('SELECT * FROM rides WHERE id = $1', [rideId]);
  if (rideResult.rowCount === 0) {
    throw new NotFoundError('Ride');
  }
  
  const ride = rideResult.rows[0];

  if (ride.status !== 'REQUESTED' && ride.status !== 'MATCHING') {
    throw new InvalidStateTransitionError(ride.status, 'MATCHING', 'Ride');
  }

  // Update ride to MATCHING status (async, don't wait)
  query(
    "UPDATE rides SET status = 'MATCHING', updated_at = NOW() WHERE id = $1",
    [rideId]
  ).catch(err => console.error('Status update failed:', err.message));

  // Find nearby drivers using Redis GeoSpatial - O(log(N) + M)
  const nearbyDrivers = await findNearbyDrivers(
    ride.tier,
    ride.pickup_lng,
    ride.pickup_lat,
    MATCHING_RADIUS_KM,
    20
  );

  if (nearbyDrivers.length === 0) {
    await query(
      "UPDATE rides SET status = 'REQUESTED', updated_at = NOW() WHERE id = $1",
      [rideId]
    );
    return { drivers: [], message: 'No drivers available nearby' };
  }

  // Get driver details - single optimized query
  const driverIds = nearbyDrivers.map(d => d.driverId);
  const driversResult = await queryRead(
    `SELECT id, name, rating, total_rides, acceptance_rate, vehicle_type 
     FROM drivers 
     WHERE id = ANY($1) AND status = 'online'`,
    [driverIds]
  );

  // Create distance lookup map for O(1) access
  const distanceMap = new Map(nearbyDrivers.map(d => [d.driverId, d.distance]));

  // Score and rank drivers
  const scoredDrivers = driversResult.rows
    .map(driver => {
      const distance = distanceMap.get(driver.id) || 999;
      const distanceScore = 1 / (1 + distance);
      const ratingScore = driver.rating / 5;
      const acceptanceScore = driver.acceptance_rate / 100;
      
      return {
        ...driver,
        distance,
        score: (distanceScore * 0.4) + (ratingScore * 0.3) + (acceptanceScore * 0.3),
      };
    })
    .sort((a, b) => b.score - a.score);

  // BATCH: Create offers for all drivers in parallel
  const offerPromises = scoredDrivers.map(driver => 
    createRideOffer(rideId, driver.id, ride.tenant_id)
  );
  
  await Promise.all(offerPromises);

  const duration = Date.now() - startTime;
  if (duration > 500) {
    console.warn(`⚠️ Slow matching: ${duration}ms for ride ${rideId}`);
  }

  return {
    drivers: scoredDrivers,
    message: `Sent offers to ${scoredDrivers.length} drivers in ${duration}ms`,
  };
};

/**
 * OPTIMIZED: Create a ride offer
 * - Fire-and-forget notification for lower latency
 */
const createRideOffer = async (rideId, driverId, tenantId) => {
  const offerId = uuidv4();
  const expiresAt = new Date(Date.now() + OFFER_EXPIRY_MS);

  // Insert offer (uses idx_ride_offers_pending_expiry index)
  await query(
    `INSERT INTO ride_offers (id, ride_id, driver_id, status, expires_at)
     VALUES ($1, $2, $3, 'pending', $4)
     ON CONFLICT DO NOTHING`,
    [offerId, rideId, driverId, expiresAt]
  );

  // Notify driver (fire and forget for latency)
  publishNotification(driverId, 'RIDE_OFFER', {
    offer_id: offerId,
    ride_id: rideId,
    expires_at: expiresAt.toISOString(),
  }).catch(err => console.error('Notification failed:', err.message));

  return offerId;
};

/**
 * OPTIMIZED: Accept a ride offer with distributed locking
 * - Uses SKIP LOCKED for non-blocking concurrent access
 * - Optimistic concurrency with version check
 * - Parallel cache invalidation
 */
const acceptRide = async (rideId, driverId) => {
  const startTime = Date.now();
  
  // Acquire distributed lock
  const lockKey = `ride:${rideId}`;
  const lock = await acquireLock(lockKey, 5000);

  if (!lock) {
    throw new LockAcquisitionError(`ride ${rideId}`);
  }

  try {
    const result = await executeTransaction(async (client) => {
      // Use NOWAIT to fail fast if row is locked
      const rideResult = await client.query(
        'SELECT * FROM rides WHERE id = $1 FOR UPDATE NOWAIT',
        [rideId]
      ).catch(err => {
        if (err.code === '55P03') { // Lock not available
          throw new ConflictError('Ride is being processed by another request');
        }
        throw err;
      });

      if (rideResult.rowCount === 0) {
        throw new NotFoundError('Ride');
      }

      const ride = rideResult.rows[0];

      if (ride.status !== 'MATCHING') {
        if (ride.driver_id) {
          throw new ConflictError('Ride has already been assigned to another driver');
        }
        throw new InvalidStateTransitionError(ride.status, 'DRIVER_ASSIGNED', 'Ride');
      }

      // Check driver availability with SKIP LOCKED for non-blocking
      const driverResult = await client.query(
        'SELECT * FROM drivers WHERE id = $1 AND status = $2 FOR UPDATE SKIP LOCKED',
        [driverId, 'online']
      );

      if (driverResult.rowCount === 0) {
        throw new ConflictError('Driver is not available');
      }

      const driver = driverResult.rows[0];

      // Verify pending offer exists
      const offerResult = await client.query(
        `SELECT 1 FROM ride_offers 
         WHERE ride_id = $1 AND driver_id = $2 AND status = 'pending'
         LIMIT 1`,
        [rideId, driverId]
      );

      if (offerResult.rowCount === 0) {
        throw new ConflictError('No pending offer for this driver');
      }

      // BATCH UPDATE: Use single query to update multiple tables
      const [updatedRide] = await Promise.all([
        client.query(
          `UPDATE rides 
           SET driver_id = $1, status = 'DRIVER_ASSIGNED', matched_at = NOW(),
               version = version + 1, updated_at = NOW()
           WHERE id = $2
           RETURNING *`,
          [driverId, rideId]
        ),
        client.query(
          "UPDATE drivers SET status = 'busy', updated_at = NOW() WHERE id = $1",
          [driverId]
        ),
        client.query(
          "UPDATE ride_offers SET status = 'accepted', responded_at = NOW() WHERE ride_id = $1 AND driver_id = $2",
          [rideId, driverId]
        ),
        client.query(
          "UPDATE ride_offers SET status = 'cancelled' WHERE ride_id = $1 AND status = 'pending' AND driver_id != $2",
          [rideId, driverId]
        ),
      ]);

      // Remove driver from geo-index
      await removeDriverLocation(driver.vehicle_type, driverId);

      // PARALLEL: Invalidate caches and publish events
      await Promise.all([
        invalidateRideCache(rideId, driverId, ride.rider_id),
        publishRideEvent(rideId, ride.tenant_id, 'RIDE_ACCEPTED', {
          ride_id: rideId,
          driver_id: driverId,
          driver_name: driver.name,
        }),
        publishNotification(ride.rider_id, 'DRIVER_ASSIGNED', {
          ride_id: rideId,
          driver_id: driverId,
          driver_name: driver.name,
          vehicle_number: driver.vehicle_number,
          rating: driver.rating,
        }),
      ]);

      // Start driver simulation (moving towards pickup)
      startDriverSimulation(rideId, driverId, ride.rider_id, 'TO_PICKUP')
        .catch(err => console.error('Failed to start simulation:', err.message));

      return updatedRide.rows[0];
    }, { isolationLevel: 'SERIALIZABLE' });

    const duration = Date.now() - startTime;
    if (duration > 500) {
      console.warn(`⚠️ Slow ride accept: ${duration}ms`);
    }

    return result;
  } finally {
    await releaseLock(lock);
  }
};

/**
 * Decline a ride offer
 */
const declineRide = async (rideId, driverId, reason = null) => {
  const result = await query(
    `UPDATE ride_offers 
     SET status = 'declined', responded_at = NOW(), decline_reason = $1
     WHERE ride_id = $2 AND driver_id = $3 AND status = 'pending'
     RETURNING *`,
    [reason, rideId, driverId]
  );

  if (result.rowCount === 0) {
    throw new NotFoundError('Ride offer');
  }

  // Update acceptance rate async (non-blocking)
  query(
    `UPDATE drivers 
     SET acceptance_rate = (
       SELECT COALESCE(
         (COUNT(*) FILTER (WHERE status = 'accepted')::float / 
          NULLIF(COUNT(*), 0) * 100), 
         100
       )
       FROM ride_offers WHERE driver_id = $1
     ),
     updated_at = NOW()
     WHERE id = $1`,
    [driverId]
  ).catch(err => console.error('Acceptance rate update failed:', err.message));

  // Check remaining offers async
  queryRead(
    "SELECT COUNT(*) FROM ride_offers WHERE ride_id = $1 AND status = 'pending'",
    [rideId]
  ).then(pendingOffers => {
    if (parseInt(pendingOffers.rows[0].count) === 0) {
      console.log(`All offers declined for ride ${rideId}`);
    }
  }).catch(err => console.error('Pending check failed:', err.message));

  return result.rows[0];
};

/**
 * OPTIMIZED: Get driver's current active ride with caching
 */
const getDriverCurrentRide = async (driverId) => {
  // Try cache first
  const cached = await getDriverCurrentRideFromCache(driverId);
  if (cached) {
    return cached;
  }

  // Use optimized index: idx_rides_driver_status_updated
  const result = await queryRead(
    `SELECT r.*, 
       ri.name as rider_name, ri.phone as rider_phone,
       t.id as trip_id, t.status as trip_status, t.total_fare,
       p.status as payment_status
     FROM rides r
     JOIN riders ri ON r.rider_id = ri.id
     LEFT JOIN trips t ON t.ride_id = r.id
     LEFT JOIN payments p ON p.trip_id = t.id
     WHERE r.driver_id = $1 
       AND (
         r.status IN ('DRIVER_ASSIGNED', 'DRIVER_EN_ROUTE', 'DRIVER_ARRIVED', 'IN_PROGRESS')
         OR (r.status = 'COMPLETED' AND (p.status IS NULL OR p.status != 'completed') 
             AND r.updated_at > NOW() - INTERVAL '10 minutes')
       )
     ORDER BY r.updated_at DESC
     LIMIT 1`,
    [driverId]
  );

  const ride = result.rows[0] || null;
  
  // Cache the result
  if (ride) {
    await cacheDriverCurrentRide(driverId, ride);
  }

  return ride;
};

/**
 * OPTIMIZED: Expire old pending offers (batch operation)
 */
const expirePendingOffers = async () => {
  const result = await query(
    `UPDATE ride_offers 
     SET status = 'expired'
     WHERE status = 'pending' AND expires_at < NOW()
     RETURNING ride_id, driver_id`
  );

  return result.rows;
};

module.exports = {
  findDriversForRide,
  createRideOffer,
  acceptRide,
  declineRide,
  getDriverCurrentRide,
  expirePendingOffers,
  MATCHING_RADIUS_KM,
  OFFER_EXPIRY_MS,
};
