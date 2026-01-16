const { v4: uuidv4 } = require('uuid');
const { query, executeTransaction } = require('../config/database');
const { invalidateCache, addDriverLocation } = require('../config/redis');
const { publishRideEvent, publishNotification } = require('../config/kafka');
const { NotFoundError, ConflictError, InvalidStateTransitionError } = require('../utils/errors');
const { switchToTripPhase, stopDriverSimulation } = require('./simulationService');

// Trip status transitions
const TRIP_STATUS_TRANSITIONS = {
  STARTED: ['IN_PROGRESS'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: ['DISPUTED'],
  DISPUTED: ['COMPLETED'],
};

// Fare calculation constants
const FARE_CONFIG = {
  economy: { baseFare: 50, perKm: 12, perMin: 1.5 },
  premium: { baseFare: 100, perKm: 18, perMin: 2.5 },
  xl: { baseFare: 150, perKm: 22, perMin: 3 },
};

/**
 * Start a trip (driver arrived, rider got in)
 */
const startTrip = async (rideId) => {
  return executeTransaction(async (client) => {
    // Lock and get the ride
    const rideResult = await client.query(
      'SELECT * FROM rides WHERE id = $1 FOR UPDATE',
      [rideId]
    );

    if (rideResult.rowCount === 0) {
      throw new NotFoundError('Ride');
    }

    const ride = rideResult.rows[0];

    if (ride.status !== 'DRIVER_ARRIVED') {
      throw new InvalidStateTransitionError(ride.status, 'IN_PROGRESS', 'Ride');
    }

    // Create trip record
    const tripId = uuidv4();
    await client.query(
      `INSERT INTO trips (id, ride_id, started_at, status)
       VALUES ($1, $2, NOW(), 'IN_PROGRESS')`,
      [tripId, rideId]
    );

    // Update ride status
    await client.query(
      `UPDATE rides SET status = 'IN_PROGRESS', version = version + 1, updated_at = NOW()
       WHERE id = $1`,
      [rideId]
    );

    // Invalidate caches
    await invalidateCache(`ride:${rideId}`);

    // Publish events
    await publishRideEvent(rideId, ride.tenant_id, 'TRIP_STARTED', {
      ride_id: rideId,
      trip_id: tripId,
      started_at: new Date().toISOString(),
    });

    await publishNotification(ride.rider_id, 'TRIP_STARTED', {
      ride_id: rideId,
      trip_id: tripId,
    });

    // Switch simulation to trip phase (driver going to dropoff)
    switchToTripPhase(rideId, ride.driver_id, ride.rider_id)
      .catch(err => console.error('Failed to switch simulation phase:', err.message));

    return { trip_id: tripId, ride_id: rideId, status: 'IN_PROGRESS' };
  });
};

/**
 * End a trip and calculate fare
 */
const endTrip = async (tripId, tripData = {}) => {
  const { actual_distance_km, actual_duration_mins, route_polyline } = tripData;

  return executeTransaction(async (client) => {
    // Get trip with lock
    const tripResult = await client.query(
      'SELECT * FROM trips WHERE id = $1 FOR UPDATE',
      [tripId]
    );

    if (tripResult.rowCount === 0) {
      throw new NotFoundError('Trip');
    }

    const trip = tripResult.rows[0];

    if (trip.status !== 'IN_PROGRESS') {
      throw new InvalidStateTransitionError(trip.status, 'COMPLETED', 'Trip');
    }

    // Get ride details
    const rideResult = await client.query(
      'SELECT * FROM rides WHERE id = $1 FOR UPDATE',
      [trip.ride_id]
    );

    const ride = rideResult.rows[0];

    // Calculate actual distance if not provided
    const distance = actual_distance_km || ride.estimated_distance_km || 5;
    const duration = actual_duration_mins || Math.ceil((Date.now() - new Date(trip.started_at).getTime()) / 60000);

    // Calculate fare
    const fareBreakdown = calculateFare(ride.tier, distance, duration, ride.surge_multiplier);

    // Update trip with fare details
    await client.query(
      `UPDATE trips SET
         ended_at = NOW(),
         actual_distance_km = $1,
         actual_duration_mins = $2,
         route_polyline = $3,
         base_fare = $4,
         distance_fare = $5,
         time_fare = $6,
         surge_fare = $7,
         taxes = $8,
         total_fare = $9,
         status = 'COMPLETED',
         updated_at = NOW()
       WHERE id = $10`,
      [
        distance, duration, route_polyline,
        fareBreakdown.baseFare, fareBreakdown.distanceFare, fareBreakdown.timeFare,
        fareBreakdown.surgeFare, fareBreakdown.taxes, fareBreakdown.total,
        tripId
      ]
    );

    // Update ride status
    await client.query(
      `UPDATE rides SET status = 'COMPLETED', version = version + 1, updated_at = NOW()
       WHERE id = $1`,
      [trip.ride_id]
    );

    // Update driver status back to online and add to geo-index
    const driverResult = await client.query(
      "UPDATE drivers SET status = 'online', total_rides = total_rides + 1, updated_at = NOW() WHERE id = $1 RETURNING *",
      [ride.driver_id]
    );

    const driver = driverResult.rows[0];

    // Get driver's last location to add back to geo-index
    const locationResult = await client.query(
      `SELECT latitude, longitude FROM driver_locations 
       WHERE driver_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
      [ride.driver_id]
    );

    if (locationResult.rows[0]) {
      const { latitude, longitude } = locationResult.rows[0];
      await addDriverLocation(driver.vehicle_type, driver.id, longitude, latitude);
    }

    // Invalidate caches
    await invalidateCache(`ride:${trip.ride_id}`);
    await invalidateCache(`driver:${ride.driver_id}`);
    await invalidateCache(`driver:status:${ride.driver_id}`);

    // Publish events
    await publishRideEvent(trip.ride_id, ride.tenant_id, 'TRIP_COMPLETED', {
      ride_id: trip.ride_id,
      trip_id: tripId,
      fare: fareBreakdown,
    });

    await publishNotification(ride.rider_id, 'TRIP_COMPLETED', {
      ride_id: trip.ride_id,
      trip_id: tripId,
      fare: fareBreakdown.total,
    });

    await publishNotification(ride.driver_id, 'TRIP_COMPLETED', {
      ride_id: trip.ride_id,
      trip_id: tripId,
      earnings: fareBreakdown.total * 0.8, // Driver gets 80%
    });

    // Stop driver simulation
    stopDriverSimulation(ride.driver_id);

    return {
      trip_id: tripId,
      ride_id: trip.ride_id,
      status: 'COMPLETED',
      fare: fareBreakdown,
    };
  });
};

/**
 * Get trip by ID
 */
const getTripById = async (id) => {
  const result = await query(
    `SELECT t.*, r.pickup_address, r.dropoff_address, r.tier, r.payment_method,
       d.name as driver_name, ri.name as rider_name
     FROM trips t
     JOIN rides r ON t.ride_id = r.id
     LEFT JOIN drivers d ON r.driver_id = d.id
     LEFT JOIN riders ri ON r.rider_id = ri.id
     WHERE t.id = $1`,
    [id]
  );

  if (result.rowCount === 0) {
    throw new NotFoundError('Trip');
  }

  return result.rows[0];
};

/**
 * Get trip by ride ID
 */
const getTripByRideId = async (rideId) => {
  const result = await query(
    'SELECT * FROM trips WHERE ride_id = $1 ORDER BY created_at DESC LIMIT 1',
    [rideId]
  );

  return result.rows[0] || null;
};

/**
 * Calculate fare breakdown
 */
const calculateFare = (tier, distanceKm, durationMins, surgeMultiplier = 1) => {
  const config = FARE_CONFIG[tier] || FARE_CONFIG.economy;

  const baseFare = config.baseFare;
  const distanceFare = Math.round(distanceKm * config.perKm * 100) / 100;
  const timeFare = Math.round(durationMins * config.perMin * 100) / 100;
  const subtotal = baseFare + distanceFare + timeFare;
  const surgeFare = surgeMultiplier > 1 ? Math.round(subtotal * (surgeMultiplier - 1) * 100) / 100 : 0;
  const taxes = Math.round((subtotal + surgeFare) * 0.05 * 100) / 100; // 5% tax
  const total = Math.round((subtotal + surgeFare + taxes) * 100) / 100;

  return {
    baseFare,
    distanceFare,
    timeFare,
    surgeFare,
    surgeMultiplier,
    taxes,
    subtotal,
    total,
    currency: 'INR',
  };
};

/**
 * Update ride status (for intermediate states)
 */
const updateRideStatusForTrip = async (rideId, newStatus) => {
  const validStatuses = ['DRIVER_EN_ROUTE', 'DRIVER_ARRIVED'];
  if (!validStatuses.includes(newStatus)) {
    throw new ConflictError(`Invalid status transition: ${newStatus}`);
  }

  const result = await query(
    `UPDATE rides 
     SET status = $1, version = version + 1, updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [newStatus, rideId]
  );

  if (result.rowCount === 0) {
    throw new NotFoundError('Ride');
  }

  const ride = result.rows[0];
  await invalidateCache(`ride:${rideId}`);

  // Publish notification
  await publishNotification(ride.rider_id, `RIDE_${newStatus}`, {
    ride_id: rideId,
    status: newStatus,
  });

  return result.rows[0];
};

module.exports = {
  startTrip,
  endTrip,
  getTripById,
  getTripByRideId,
  calculateFare,
  updateRideStatusForTrip,
  FARE_CONFIG,
};
