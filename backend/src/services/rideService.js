const { v4: uuidv4 } = require('uuid');
const { query, queryRead, executeTransaction } = require('../config/database');
const { cacheGetOrSet, invalidateCache } = require('../config/redis');
const { publishRideEvent } = require('../config/kafka');
const { NotFoundError, ConflictError, InvalidStateTransitionError } = require('../utils/errors');
const {
  cacheGet,
  cacheSet,
  getOrCompute,
  CACHE_KEYS,
  CACHE_TTL,
  invalidateRideCache,
  invalidateDriverCache,
  cacheRiderCurrentRide,
  getRiderCurrentRideFromCache,
  invalidateRiderCurrentRide,
} = require('./cacheService');

// Valid status transitions
const STATUS_TRANSITIONS = {
  REQUESTED: ['MATCHING', 'CANCELLED'],
  MATCHING: ['DRIVER_ASSIGNED', 'CANCELLED'],
  DRIVER_ASSIGNED: ['DRIVER_EN_ROUTE', 'CANCELLED'],
  DRIVER_EN_ROUTE: ['DRIVER_ARRIVED', 'CANCELLED'],
  DRIVER_ARRIVED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

/**
 * OPTIMIZED: Create a new ride request
 */
const createRide = async (rideData) => {
  const {
    tenant_id,
    rider_id,
    pickup_lat,
    pickup_lng,
    pickup_address,
    dropoff_lat,
    dropoff_lng,
    dropoff_address,
    tier,
    payment_method,
  } = rideData;

  const id = uuidv4();

  // Calculate fare and distance synchronously (no DB needed)
  const distance = calculateDistance(pickup_lat, pickup_lng, dropoff_lat, dropoff_lng);
  const estimatedFare = calculateEstimatedFare(distance, tier);
  const estimatedDuration = Math.ceil(distance * 3);
  const surgeMultiplier = 1.0; // Cache lookup could be added here

  const result = await query(
    `INSERT INTO rides (
      id, tenant_id, rider_id, status,
      pickup_lat, pickup_lng, pickup_address,
      dropoff_lat, dropoff_lng, dropoff_address,
      tier, payment_method,
      surge_multiplier, estimated_fare, estimated_distance_km, estimated_duration_mins
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    RETURNING *`,
    [
      id, tenant_id, rider_id, 'REQUESTED',
      pickup_lat, pickup_lng, pickup_address,
      dropoff_lat, dropoff_lng, dropoff_address,
      tier, payment_method,
      surgeMultiplier, estimatedFare * surgeMultiplier, distance, estimatedDuration,
    ]
  );

  const ride = result.rows[0];

  // Cache the new ride and invalidate rider's current ride cache
  await Promise.all([
    cacheSet(CACHE_KEYS.RIDE(ride.id), ride, CACHE_TTL.RIDE),
    cacheRiderCurrentRide(rider_id, ride),
    publishRideEvent(ride.id, tenant_id, 'RIDE_CREATED', {
      ride_id: ride.id,
      rider_id,
      pickup: { lat: pickup_lat, lng: pickup_lng },
      tier,
    }),
  ]);

  return ride;
};

/**
 * OPTIMIZED: Get ride by ID with caching
 */
const getRideById = async (id) => {
  const cacheKey = CACHE_KEYS.RIDE(id);
  
  const ride = await getOrCompute(cacheKey, CACHE_TTL.RIDE, async () => {
    const result = await queryRead(
      `SELECT r.*, 
        d.name as driver_name, d.phone as driver_phone, 
        d.vehicle_number, d.vehicle_type, d.rating as driver_rating
      FROM rides r
      LEFT JOIN drivers d ON r.driver_id = d.id
      WHERE r.id = $1`,
      [id]
    );
    return result.rows[0] || null;
  });

  if (!ride) {
    throw new NotFoundError('Ride');
  }

  return ride;
};

/**
 * OPTIMIZED: Update ride status with optimistic locking
 */
const updateRideStatus = async (id, newStatus, expectedVersion = null) => {
  // Get current status from cache if available
  let currentRide = await cacheGet(CACHE_KEYS.RIDE(id));
  if (!currentRide) {
    const result = await queryRead('SELECT status, version FROM rides WHERE id = $1', [id]);
    if (result.rowCount === 0) throw new NotFoundError('Ride');
    currentRide = result.rows[0];
  }

  // Validate status transition
  const validTransitions = STATUS_TRANSITIONS[currentRide.status] || [];
  if (!validTransitions.includes(newStatus)) {
    throw new InvalidStateTransitionError(currentRide.status, newStatus, 'Ride');
  }

  // Update with optional version check (optimistic locking)
  let updateQuery;
  let params;

  if (expectedVersion !== null) {
    updateQuery = `
      UPDATE rides 
      SET status = $1, version = version + 1, updated_at = NOW()
      WHERE id = $2 AND version = $3
      RETURNING *
    `;
    params = [newStatus, id, expectedVersion];
  } else {
    updateQuery = `
      UPDATE rides 
      SET status = $1, version = version + 1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `;
    params = [newStatus, id];
  }

  const result = await query(updateQuery, params);

  if (result.rowCount === 0) {
    if (expectedVersion !== null) {
      throw new ConflictError('Ride was modified by another request. Please retry.');
    }
    throw new NotFoundError('Ride');
  }

  const updatedRide = result.rows[0];

  // PARALLEL: Cache update and event publishing
  await Promise.all([
    cacheSet(CACHE_KEYS.RIDE(id), updatedRide, CACHE_TTL.RIDE),
    invalidateRiderCurrentRide(updatedRide.rider_id),
    publishRideEvent(id, updatedRide.tenant_id, 'RIDE_STATUS_CHANGED', {
      ride_id: id,
      old_status: currentRide.status,
      new_status: newStatus,
    }),
  ]);

  return updatedRide;
};

/**
 * OPTIMIZED: Assign driver to ride with row-level locking
 */
const assignDriver = async (rideId, driverId, expectedVersion = null) => {
  return executeTransaction(async (client) => {
    // Lock ride row with NOWAIT for fast failure
    const rideResult = await client.query(
      'SELECT * FROM rides WHERE id = $1 FOR UPDATE NOWAIT',
      [rideId]
    ).catch(err => {
      if (err.code === '55P03') {
        throw new ConflictError('Ride is being processed');
      }
      throw err;
    });

    if (rideResult.rowCount === 0) {
      throw new NotFoundError('Ride');
    }

    const ride = rideResult.rows[0];

    // Version check for optimistic locking
    if (expectedVersion !== null && ride.version !== expectedVersion) {
      throw new ConflictError('Ride was modified by another request');
    }

    if (ride.status !== 'MATCHING') {
      throw new InvalidStateTransitionError(ride.status, 'DRIVER_ASSIGNED', 'Ride');
    }

    // PARALLEL: Update ride and driver
    const [updateResult] = await Promise.all([
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
    ]);

    const updatedRide = updateResult.rows[0];

    // PARALLEL: Cache invalidation and event publishing
    await Promise.all([
      invalidateRideCache(rideId, driverId, ride.rider_id),
      publishRideEvent(rideId, ride.tenant_id, 'DRIVER_ASSIGNED', {
        ride_id: rideId,
        driver_id: driverId,
      }),
    ]);

    return updatedRide;
  }, { isolationLevel: 'SERIALIZABLE' });
};

/**
 * Cancel ride
 */
const cancelRide = async (id, reason = null) => {
  const result = await query(
    `UPDATE rides 
     SET status = 'CANCELLED', cancelled_at = NOW(), cancellation_reason = $1,
         version = version + 1, updated_at = NOW()
     WHERE id = $2 AND status NOT IN ('COMPLETED', 'CANCELLED')
     RETURNING *`,
    [reason, id]
  );

  if (result.rowCount === 0) {
    throw new ConflictError('Ride cannot be cancelled');
  }

  const ride = result.rows[0];

  // Free up driver if assigned
  const promises = [
    invalidateRideCache(id, ride.driver_id, ride.rider_id),
  ];

  if (ride.driver_id) {
    promises.push(
      query(
        "UPDATE drivers SET status = 'online', updated_at = NOW() WHERE id = $1",
        [ride.driver_id]
      ),
      invalidateDriverCache(ride.driver_id)
    );
  }

  await Promise.all(promises);

  return ride;
};

/**
 * OPTIMIZED: Get rides by rider with pagination
 */
const getRidesByRider = async (riderId, options = {}) => {
  const { limit = 20, offset = 0, status = null } = options;

  let queryStr = `
    SELECT r.*, d.name as driver_name, d.vehicle_number
    FROM rides r
    LEFT JOIN drivers d ON r.driver_id = d.id
    WHERE r.rider_id = $1
  `;
  const params = [riderId];

  if (status) {
    queryStr += ` AND r.status = $${params.length + 1}`;
    params.push(status);
  }

  queryStr += ` ORDER BY r.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const result = await queryRead(queryStr, params);
  return result.rows;
};

// Helper functions

/**
 * Calculate distance between two points (Haversine formula)
 */
const calculateDistance = (lat1, lng1, lat2, lng2) => {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100;
};

const toRad = (deg) => deg * (Math.PI / 180);

/**
 * Calculate estimated fare
 */
const calculateEstimatedFare = (distanceKm, tier) => {
  const baseFares = { economy: 50, premium: 100, xl: 150 };
  const perKmRates = { economy: 12, premium: 18, xl: 22 };

  const base = baseFares[tier] || baseFares.economy;
  const perKm = perKmRates[tier] || perKmRates.economy;

  return Math.round(base + (distanceKm * perKm));
};

/**
 * Get surge multiplier for area (cached)
 */
const getSurgeMultiplier = async (tenantId, tier, lat, lng) => {
  return 1.0; // Could be cached surge value
};

/**
 * OPTIMIZED: Get rider's current active ride with caching
 */
const getRiderCurrentRide = async (riderId) => {
  // Try cache first
  const cached = await getRiderCurrentRideFromCache(riderId);
  if (cached) {
    // Verify it's still active
    const isActive = ['REQUESTED', 'MATCHING', 'DRIVER_ASSIGNED', 'DRIVER_EN_ROUTE', 'DRIVER_ARRIVED', 'IN_PROGRESS'].includes(cached.status);
    const isCompletedUnpaid = cached.status === 'COMPLETED' && cached.payment_status !== 'completed';
    if (isActive || isCompletedUnpaid) {
      return cached;
    }
  }

  // Use optimized index: idx_rides_rider_status_created
  const result = await queryRead(
    `SELECT r.*, 
       d.name as driver_name, d.phone as driver_phone, 
       d.vehicle_number, d.rating as driver_rating,
       t.id as trip_id, t.status as trip_status, t.total_fare,
       p.status as payment_status
     FROM rides r
     LEFT JOIN drivers d ON r.driver_id = d.id
     LEFT JOIN trips t ON t.ride_id = r.id
     LEFT JOIN payments p ON p.trip_id = t.id
     WHERE r.rider_id = $1 
       AND r.status NOT IN ('CANCELLED')
     ORDER BY r.created_at DESC
     LIMIT 1`,
    [riderId]
  );

  const ride = result.rows[0];
  
  if (ride) {
    const isActive = ['REQUESTED', 'MATCHING', 'DRIVER_ASSIGNED', 'DRIVER_EN_ROUTE', 'DRIVER_ARRIVED', 'IN_PROGRESS'].includes(ride.status);
    const isCompletedUnpaid = ride.status === 'COMPLETED' && ride.payment_status !== 'completed';
    
    if (isActive || isCompletedUnpaid) {
      // Cache for quick access
      await cacheRiderCurrentRide(riderId, ride);
      return ride;
    }
  }
  
  return null;
};

module.exports = {
  createRide,
  getRideById,
  updateRideStatus,
  assignDriver,
  cancelRide,
  getRidesByRider,
  getRiderCurrentRide,
  calculateDistance,
  calculateEstimatedFare,
  STATUS_TRANSITIONS,
};
