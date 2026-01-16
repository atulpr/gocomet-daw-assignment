const { createConsumer, TOPICS } = require('../config/kafka');
const { addDriverLocation } = require('../config/redis');
const { query } = require('../config/database');

let consumer = null;
const locationBuffer = new Map(); // Buffer for batch processing
const BATCH_SIZE = 100;
const BATCH_INTERVAL_MS = 1000;

/**
 * Start the location consumer
 */
const startLocationConsumer = async () => {
  consumer = await createConsumer(
    'location-processor',
    TOPICS.LOCATION_UPDATES,
    processLocationUpdate
  );

  // Start batch processing timer
  setInterval(flushLocationBuffer, BATCH_INTERVAL_MS);

  if (consumer) {
    console.log('✅ Location consumer started');
  }

  return consumer;
};

/**
 * Process incoming location update
 */
const processLocationUpdate = async (message) => {
  const { driverId, latitude, longitude, heading, speed, vehicle_type, status } = message;

  // Update Redis geo-index immediately for real-time matching
  if (status === 'online') {
    await addDriverLocation(vehicle_type, driverId, longitude, latitude);
  }

  // Buffer for batch database writes
  bufferLocationForDb(driverId, { latitude, longitude, heading, speed });
};

/**
 * Buffer location update for batch DB insert
 */
const bufferLocationForDb = (driverId, location) => {
  if (!locationBuffer.has(driverId)) {
    locationBuffer.set(driverId, []);
  }
  
  locationBuffer.get(driverId).push({
    ...location,
    timestamp: Date.now(),
  });

  // If buffer is full, flush immediately
  let totalEntries = 0;
  locationBuffer.forEach(locations => {
    totalEntries += locations.length;
  });

  if (totalEntries >= BATCH_SIZE) {
    flushLocationBuffer();
  }
};

/**
 * Flush buffered locations to database
 */
const flushLocationBuffer = async () => {
  if (locationBuffer.size === 0) return;

  const entries = [];
  
  locationBuffer.forEach((locations, driverId) => {
    // Only keep latest location per driver
    const latest = locations[locations.length - 1];
    entries.push({
      driver_id: driverId,
      latitude: latest.latitude,
      longitude: latest.longitude,
      heading: latest.heading,
      speed: latest.speed,
    });
  });

  locationBuffer.clear();

  if (entries.length === 0) return;

  try {
    // Batch insert using unnest
    const driverIds = entries.map(e => e.driver_id);
    const latitudes = entries.map(e => e.latitude);
    const longitudes = entries.map(e => e.longitude);
    const headings = entries.map(e => e.heading || null);
    const speeds = entries.map(e => e.speed || null);

    await query(
      `INSERT INTO driver_locations (driver_id, latitude, longitude, heading, speed)
       SELECT * FROM unnest($1::uuid[], $2::decimal[], $3::decimal[], $4::decimal[], $5::decimal[])`,
      [driverIds, latitudes, longitudes, headings, speeds]
    );

    console.log(`Flushed ${entries.length} location updates to database`);
  } catch (error) {
    console.error('Error flushing location buffer:', error.message);
  }
};

/**
 * Stop the location consumer
 */
const stopLocationConsumer = async () => {
  // Flush remaining buffer
  await flushLocationBuffer();
  
  if (consumer) {
    await consumer.disconnect();
    console.log('Location consumer stopped');
  }
};

module.exports = {
  startLocationConsumer,
  stopLocationConsumer,
  processLocationUpdate,
};
