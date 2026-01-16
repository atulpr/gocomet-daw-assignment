/**
 * Driver Location Simulation Service
 * Simulates driver movement towards pickup/dropoff locations
 */

const { publishNotification } = require('../config/kafka');
const { query } = require('../config/database');
const { addDriverLocation } = require('../config/redis');

// Active simulations storage
const activeSimulations = new Map();

// Simulation configuration
const SIMULATION_INTERVAL_MS = 2000; // Update every 2 seconds
const SPEED_KM_PER_HOUR = 30; // Average speed in city traffic

/**
 * Calculate distance between two points (Haversine formula)
 */
const calculateDistance = (lat1, lng1, lat2, lng2) => {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const toRad = (deg) => deg * (Math.PI / 180);

/**
 * Calculate bearing between two points
 */
const calculateBearing = (lat1, lng1, lat2, lng2) => {
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
            Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
};

/**
 * Move point towards destination by a certain distance
 */
const moveTowards = (fromLat, fromLng, toLat, toLng, distanceKm) => {
  const R = 6371;
  const bearing = calculateBearing(fromLat, fromLng, toLat, toLng);
  const bearingRad = toRad(bearing);
  
  const lat1 = toRad(fromLat);
  const lng1 = toRad(fromLng);
  const d = distanceKm / R;
  
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) +
    Math.cos(lat1) * Math.sin(d) * Math.cos(bearingRad)
  );
  
  const lng2 = lng1 + Math.atan2(
    Math.sin(bearingRad) * Math.sin(d) * Math.cos(lat1),
    Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
  );
  
  return {
    lat: lat2 * 180 / Math.PI,
    lng: lng2 * 180 / Math.PI,
  };
};

/**
 * Start simulating driver movement towards a destination
 */
const startDriverSimulation = async (rideId, driverId, riderId, phase = 'TO_PICKUP') => {
  // Stop any existing simulation for this driver
  stopDriverSimulation(driverId);
  
  // Get ride details
  const rideResult = await query(
    'SELECT * FROM rides WHERE id = $1',
    [rideId]
  );
  
  if (rideResult.rowCount === 0) {
    console.error('Ride not found for simulation:', rideId);
    return;
  }
  
  const ride = rideResult.rows[0];
  
  // Get driver's current location (use last known or pickup area)
  const locationResult = await query(
    `SELECT latitude, longitude FROM driver_locations 
     WHERE driver_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
    [driverId]
  );
  
  let currentLat, currentLng;
  
  if (locationResult.rows[0]) {
    currentLat = parseFloat(locationResult.rows[0].latitude);
    currentLng = parseFloat(locationResult.rows[0].longitude);
  } else {
    // Start from a random position near pickup (1-3 km away)
    const randomAngle = Math.random() * 2 * Math.PI;
    const randomDistance = 1 + Math.random() * 2; // 1-3 km
    const offset = moveTowards(
      parseFloat(ride.pickup_lat),
      parseFloat(ride.pickup_lng),
      parseFloat(ride.pickup_lat) + 0.1, // Just for direction
      parseFloat(ride.pickup_lng) + 0.1,
      randomDistance
    );
    currentLat = parseFloat(ride.pickup_lat) + (offset.lat - parseFloat(ride.pickup_lat));
    currentLng = parseFloat(ride.pickup_lng) + (offset.lng - parseFloat(ride.pickup_lng));
  }
  
  // Determine destination based on phase
  let destLat, destLng;
  if (phase === 'TO_PICKUP') {
    destLat = parseFloat(ride.pickup_lat);
    destLng = parseFloat(ride.pickup_lng);
  } else {
    destLat = parseFloat(ride.dropoff_lat);
    destLng = parseFloat(ride.dropoff_lng);
  }
  
  console.log(`🚗 Starting ${phase} simulation for driver ${driverId}`);
  console.log(`   From: ${currentLat.toFixed(4)}, ${currentLng.toFixed(4)}`);
  console.log(`   To: ${destLat.toFixed(4)}, ${destLng.toFixed(4)}`);
  
  // Calculate distance per update
  const distancePerUpdate = (SPEED_KM_PER_HOUR / 3600) * (SIMULATION_INTERVAL_MS / 1000);
  
  // Create simulation state
  const simulation = {
    rideId,
    driverId,
    riderId,
    phase,
    currentLat,
    currentLng,
    destLat,
    destLng,
    distancePerUpdate,
    vehicleType: ride.tier,
    interval: null,
  };
  
  // Start the simulation interval
  simulation.interval = setInterval(async () => {
    await updateDriverPosition(simulation);
  }, SIMULATION_INTERVAL_MS);
  
  // Store simulation
  activeSimulations.set(driverId, simulation);
  
  // Send initial position
  await sendLocationUpdate(simulation);
};

/**
 * Update driver position in simulation
 */
const updateDriverPosition = async (simulation) => {
  const {
    driverId,
    riderId,
    rideId,
    phase,
    currentLat,
    currentLng,
    destLat,
    destLng,
    distancePerUpdate,
    vehicleType,
  } = simulation;
  
  // Calculate remaining distance
  const remainingDistance = calculateDistance(currentLat, currentLng, destLat, destLng);
  
  // Check if arrived
  if (remainingDistance < 0.05) { // Within 50 meters
    console.log(`✅ Driver ${driverId} arrived at ${phase === 'TO_PICKUP' ? 'pickup' : 'dropoff'}`);
    
    // Stop simulation
    stopDriverSimulation(driverId);
    
    // Send arrival notification
    await publishNotification(riderId, 'DRIVER_LOCATION', {
      ride_id: rideId,
      latitude: destLat,
      longitude: destLng,
      distance: 0,
      eta_minutes: 0,
      phase,
      arrived: true,
    });
    
    return;
  }
  
  // Move towards destination
  const newPosition = moveTowards(currentLat, currentLng, destLat, destLng, distancePerUpdate);
  
  // Add some random variation for realistic movement
  const variation = 0.0001 * (Math.random() - 0.5);
  simulation.currentLat = newPosition.lat + variation;
  simulation.currentLng = newPosition.lng + variation;
  
  // Update Redis geo-index
  await addDriverLocation(vehicleType, driverId, simulation.currentLng, simulation.currentLat);
  
  // Store location in DB (fire and forget)
  query(
    `INSERT INTO driver_locations (driver_id, latitude, longitude, heading, speed)
     VALUES ($1, $2, $3, $4, $5)`,
    [driverId, simulation.currentLat, simulation.currentLng, 
     calculateBearing(currentLat, currentLng, destLat, destLng),
     SPEED_KM_PER_HOUR]
  ).catch(err => console.error('Failed to store location:', err.message));
  
  // Send location update
  await sendLocationUpdate(simulation);
};

/**
 * Send location update to rider
 */
const sendLocationUpdate = async (simulation) => {
  const {
    rideId,
    riderId,
    driverId,
    phase,
    currentLat,
    currentLng,
    destLat,
    destLng,
  } = simulation;
  
  const distance = calculateDistance(currentLat, currentLng, destLat, destLng);
  const etaMinutes = Math.ceil((distance / SPEED_KM_PER_HOUR) * 60);
  
  console.log(`📍 Driver ${driverId}: ${distance.toFixed(2)}km away, ETA ${etaMinutes}min`);
  
  // Send to rider via Kafka/WebSocket
  await publishNotification(riderId, 'DRIVER_LOCATION', {
    ride_id: rideId,
    driver_id: driverId,
    latitude: currentLat,
    longitude: currentLng,
    heading: calculateBearing(currentLat, currentLng, destLat, destLng),
    distance: parseFloat(distance.toFixed(2)),
    eta_minutes: etaMinutes,
    phase,
    arrived: false,
  });
};

/**
 * Stop driver simulation
 */
const stopDriverSimulation = (driverId) => {
  const simulation = activeSimulations.get(driverId);
  if (simulation) {
    clearInterval(simulation.interval);
    activeSimulations.delete(driverId);
    console.log(`🛑 Stopped simulation for driver ${driverId}`);
  }
};

/**
 * Switch simulation to trip phase (driver going to dropoff)
 */
const switchToTripPhase = async (rideId, driverId, riderId) => {
  await startDriverSimulation(rideId, driverId, riderId, 'TO_DROPOFF');
};

/**
 * Get active simulation for a driver
 */
const getSimulation = (driverId) => {
  return activeSimulations.get(driverId);
};

/**
 * Stop all simulations (cleanup)
 */
const stopAllSimulations = () => {
  for (const [driverId] of activeSimulations) {
    stopDriverSimulation(driverId);
  }
};

module.exports = {
  startDriverSimulation,
  stopDriverSimulation,
  switchToTripPhase,
  getSimulation,
  stopAllSimulations,
  calculateDistance,
};
