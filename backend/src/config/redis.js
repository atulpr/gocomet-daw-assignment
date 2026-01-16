const Redis = require('ioredis');

let redis = null;

/**
 * Get Redis client instance
 * @returns {Redis} Redis client
 */
const getRedisClient = () => {
  if (!redis) {
    throw new Error('Redis not connected. Call connectRedis() first.');
  }
  return redis;
};

/**
 * Connect to Redis
 */
const connectRedis = async () => {
  try {
    redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      enableReadyCheck: true,
      lazyConnect: true,
    });

    redis.on('error', (error) => {
      console.error('Redis error:', error.message);
    });

    redis.on('connect', () => {
      console.log('✅ Redis connected successfully');
    });

    redis.on('ready', () => {
      console.log('Redis ready');
    });

    await redis.connect();
  } catch (error) {
    console.error('❌ Redis connection failed:', error.message);
    // Don't throw - Redis is optional for some operations
    console.warn('Continuing without Redis...');
  }
};

/**
 * Disconnect from Redis
 */
const disconnectRedis = async () => {
  if (redis) {
    try {
      await redis.quit();
      console.log('Redis disconnected');
    } catch (error) {
      console.error('Error disconnecting Redis:', error.message);
    }
  }
};

/**
 * Cache helper - get or set with callback
 * @param {string} key - Cache key
 * @param {number} ttlSeconds - TTL in seconds
 * @param {Function} fetchCallback - Callback to fetch data if not cached
 * @returns {Promise} Cached or fresh data
 */
const cacheGetOrSet = async (key, ttlSeconds, fetchCallback) => {
  if (!redis) {
    return fetchCallback();
  }

  try {
    const cached = await redis.get(key);
    if (cached) {
      return JSON.parse(cached);
    }

    const data = await fetchCallback();
    await redis.setex(key, ttlSeconds, JSON.stringify(data));
    return data;
  } catch (error) {
    console.error('Cache error:', error.message);
    return fetchCallback();
  }
};

/**
 * Invalidate cache by key pattern
 * @param {string} pattern - Key pattern to invalidate
 */
const invalidateCache = async (pattern) => {
  if (!redis) return;

  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch (error) {
    console.error('Cache invalidation error:', error.message);
  }
};

// GeoSpatial helpers for driver locations

/**
 * Add driver location to geo index
 * @param {string} tier - Vehicle tier (economy, premium, xl)
 * @param {string} driverId - Driver ID
 * @param {number} longitude - Longitude
 * @param {number} latitude - Latitude
 */
const addDriverLocation = async (tier, driverId, longitude, latitude) => {
  if (!redis) return;
  
  const key = `drivers:geo:${tier}`;
  await redis.geoadd(key, longitude, latitude, driverId);
};

/**
 * Remove driver from geo index
 * @param {string} tier - Vehicle tier
 * @param {string} driverId - Driver ID
 */
const removeDriverLocation = async (tier, driverId) => {
  if (!redis) return;
  
  const key = `drivers:geo:${tier}`;
  await redis.zrem(key, driverId);
};

/**
 * Find nearby drivers
 * @param {string} tier - Vehicle tier
 * @param {number} longitude - Pickup longitude
 * @param {number} latitude - Pickup latitude
 * @param {number} radiusKm - Search radius in km
 * @param {number} count - Max results
 * @returns {Promise<Array>} Array of {driverId, distance}
 */
const findNearbyDrivers = async (tier, longitude, latitude, radiusKm = 5, count = 10) => {
  if (!redis) return [];
  
  const key = `drivers:geo:${tier}`;
  const results = await redis.georadius(
    key,
    longitude,
    latitude,
    radiusKm,
    'km',
    'WITHDIST',
    'ASC',
    'COUNT',
    count
  );
  
  return results.map(([driverId, distance]) => ({
    driverId,
    distance: parseFloat(distance),
  }));
};

module.exports = {
  getRedisClient,
  connectRedis,
  disconnectRedis,
  cacheGetOrSet,
  invalidateCache,
  addDriverLocation,
  removeDriverLocation,
  findNearbyDrivers,
};
