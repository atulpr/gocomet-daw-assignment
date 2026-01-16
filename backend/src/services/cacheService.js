const { getRedisClient, invalidateCache } = require('../config/redis');

/**
 * Cache TTL configurations (in seconds)
 */
const CACHE_TTL = {
  RIDE: 30,                    // Ride details - short TTL for freshness
  DRIVER: 60,                  // Driver profile
  DRIVER_STATUS: 5,            // Driver status - very short for accuracy
  DRIVER_LOCATION: 3,          // Location - very short for real-time
  RIDER: 300,                  // Rider profile - longer TTL
  SURGE: 60,                   // Surge pricing
  RIDE_ESTIMATE: 300,          // Fare estimates
  NEARBY_DRIVERS: 2,           // Nearby driver list - very short
  PAYMENT: 60,                 // Payment status
  IDEMPOTENCY: 86400,          // 24 hours
};

/**
 * Cache key patterns
 */
const CACHE_KEYS = {
  RIDE: (id) => `ride:${id}`,
  RIDE_DETAILS: (id) => `ride:details:${id}`,
  DRIVER: (id) => `driver:${id}`,
  DRIVER_STATUS: (id) => `driver:status:${id}`,
  DRIVER_CURRENT_RIDE: (id) => `driver:current_ride:${id}`,
  RIDER: (id) => `rider:${id}`,
  RIDER_CURRENT_RIDE: (id) => `rider:current_ride:${id}`,
  SURGE: (region, tier) => `surge:${region}:${tier}`,
  NEARBY_DRIVERS: (tier, lat, lng, radius) => `nearby:${tier}:${lat.toFixed(3)}:${lng.toFixed(3)}:${radius}`,
  RIDE_ESTIMATE: (pickup, dropoff, tier) => `estimate:${pickup}:${dropoff}:${tier}`,
  PAYMENT: (tripId) => `payment:${tripId}`,
  IDEMPOTENCY: (key) => `idempotency:${key}`,
  LOCK: (resource) => `lock:${resource}`,
};

/**
 * Generic cache get with stats tracking
 */
let cacheHits = 0;
let cacheMisses = 0;

const cacheGet = async (key) => {
  try {
    const redis = getRedisClient();
    const cached = await redis.get(key);
    if (cached) {
      cacheHits++;
      return JSON.parse(cached);
    }
    cacheMisses++;
    return null;
  } catch (error) {
    console.error('Cache get error:', error.message);
    return null;
  }
};

/**
 * Generic cache set
 */
const cacheSet = async (key, data, ttl) => {
  try {
    const redis = getRedisClient();
    await redis.setex(key, ttl, JSON.stringify(data));
    return true;
  } catch (error) {
    console.error('Cache set error:', error.message);
    return false;
  }
};

/**
 * Cache-aside pattern: Get from cache or compute
 * @param {string} key - Cache key
 * @param {number} ttl - TTL in seconds
 * @param {Function} computeFn - Function to compute value if not cached
 * @param {Object} options - Additional options
 */
const getOrCompute = async (key, ttl, computeFn, options = {}) => {
  const { forceRefresh = false, lockTimeout = 5000 } = options;
  
  // Try cache first (unless force refresh)
  if (!forceRefresh) {
    const cached = await cacheGet(key);
    if (cached !== null) {
      return cached;
    }
  }
  
  // Compute and cache
  try {
    const data = await computeFn();
    if (data !== null && data !== undefined) {
      await cacheSet(key, data, ttl);
    }
    return data;
  } catch (error) {
    console.error('Compute error for key', key, ':', error.message);
    throw error;
  }
};

/**
 * Write-through cache update
 * Updates cache immediately after database write
 */
const writeThroughUpdate = async (key, data, ttl = 60) => {
  return cacheSet(key, data, ttl);
};

/**
 * Cache invalidation with pattern support
 */
const invalidatePattern = async (pattern) => {
  try {
    const redis = getRedisClient();
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    return keys.length;
  } catch (error) {
    console.error('Invalidate pattern error:', error.message);
    return 0;
  }
};

/**
 * Multi-key cache get (pipelining for batch reads)
 */
const cacheGetMulti = async (keys) => {
  try {
    const redis = getRedisClient();
    const pipeline = redis.pipeline();
    
    keys.forEach(key => pipeline.get(key));
    const results = await pipeline.exec();
    
    return results.map(([err, value]) => {
      if (err || !value) return null;
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    });
  } catch (error) {
    console.error('Multi-get error:', error.message);
    return keys.map(() => null);
  }
};

/**
 * Multi-key cache set (pipelining for batch writes)
 */
const cacheSetMulti = async (entries) => {
  try {
    const redis = getRedisClient();
    const pipeline = redis.pipeline();
    
    entries.forEach(({ key, data, ttl }) => {
      pipeline.setex(key, ttl, JSON.stringify(data));
    });
    
    await pipeline.exec();
    return true;
  } catch (error) {
    console.error('Multi-set error:', error.message);
    return false;
  }
};

// =============================================
// SPECIALIZED CACHE FUNCTIONS FOR CRITICAL APIs
// =============================================

/**
 * Cache driver's current ride (most frequently accessed)
 */
const cacheDriverCurrentRide = async (driverId, ride) => {
  const key = CACHE_KEYS.DRIVER_CURRENT_RIDE(driverId);
  return cacheSet(key, ride, CACHE_TTL.RIDE);
};

const getDriverCurrentRideFromCache = async (driverId) => {
  const key = CACHE_KEYS.DRIVER_CURRENT_RIDE(driverId);
  return cacheGet(key);
};

const invalidateDriverCurrentRide = async (driverId) => {
  const key = CACHE_KEYS.DRIVER_CURRENT_RIDE(driverId);
  return invalidateCache(key);
};

/**
 * Cache rider's current ride
 */
const cacheRiderCurrentRide = async (riderId, ride) => {
  const key = CACHE_KEYS.RIDER_CURRENT_RIDE(riderId);
  return cacheSet(key, ride, CACHE_TTL.RIDE);
};

const getRiderCurrentRideFromCache = async (riderId) => {
  const key = CACHE_KEYS.RIDER_CURRENT_RIDE(riderId);
  return cacheGet(key);
};

const invalidateRiderCurrentRide = async (riderId) => {
  const key = CACHE_KEYS.RIDER_CURRENT_RIDE(riderId);
  return invalidateCache(key);
};

/**
 * Invalidate ride cache and related caches
 */
const invalidateRideCache = async (rideId, driverId = null, riderId = null) => {
  const promises = [
    invalidateCache(CACHE_KEYS.RIDE(rideId)),
    invalidateCache(CACHE_KEYS.RIDE_DETAILS(rideId)),
  ];
  
  if (driverId) {
    promises.push(
      invalidateCache(CACHE_KEYS.DRIVER(driverId)),
      invalidateCache(CACHE_KEYS.DRIVER_STATUS(driverId)),
      invalidateCache(CACHE_KEYS.DRIVER_CURRENT_RIDE(driverId))
    );
  }
  
  if (riderId) {
    promises.push(invalidateCache(CACHE_KEYS.RIDER_CURRENT_RIDE(riderId)));
  }
  
  await Promise.all(promises);
};

/**
 * Invalidate driver cache
 */
const invalidateDriverCache = async (driverId) => {
  await Promise.all([
    invalidateCache(CACHE_KEYS.DRIVER(driverId)),
    invalidateCache(CACHE_KEYS.DRIVER_STATUS(driverId)),
    invalidateCache(CACHE_KEYS.DRIVER_CURRENT_RIDE(driverId)),
  ]);
};

/**
 * Cache payment status
 */
const cachePaymentStatus = async (tripId, payment) => {
  const key = CACHE_KEYS.PAYMENT(tripId);
  return cacheSet(key, payment, CACHE_TTL.PAYMENT);
};

const getPaymentFromCache = async (tripId) => {
  const key = CACHE_KEYS.PAYMENT(tripId);
  return cacheGet(key);
};

/**
 * Get or compute surge multiplier with caching
 */
const getSurgeMultiplier = async (region, tier, computeFn) => {
  const key = CACHE_KEYS.SURGE(region, tier);
  return getOrCompute(key, CACHE_TTL.SURGE, computeFn);
};

/**
 * Compute surge multiplier based on demand/supply
 */
const computeSurgeMultiplier = async (tenantId, tier, lat, lng) => {
  // In production, this would:
  // 1. Count active ride requests in the area
  // 2. Count available drivers in the area
  // 3. Calculate ratio and apply surge formula
  
  // For demo, return random surge occasionally
  const random = Math.random();
  if (random < 0.1) return 1.5;
  if (random < 0.05) return 2.0;
  return 1.0;
};

/**
 * Warm up cache with frequently accessed data
 */
const warmUpCache = async () => {
  try {
    const { query } = require('../config/database');
    const redis = getRedisClient();
    
    // Cache online driver counts by tier
    const driverCounts = await query(`
      SELECT tenant_id, vehicle_type, COUNT(*) as count 
      FROM drivers 
      WHERE status = 'online' 
      GROUP BY tenant_id, vehicle_type
    `);
    
    const pipeline = redis.pipeline();
    for (const row of driverCounts.rows) {
      pipeline.setex(
        `online_drivers:${row.tenant_id}:${row.vehicle_type}`,
        30,
        row.count.toString()
      );
    }
    await pipeline.exec();
    
    console.log('✅ Cache warmed up');
  } catch (error) {
    console.error('Cache warm-up failed:', error.message);
  }
};

/**
 * Clear all application caches
 */
const clearAllCaches = async () => {
  try {
    const redis = getRedisClient();
    const patterns = ['ride:*', 'driver:*', 'rider:*', 'surge:*', 'payment:*', 'nearby:*'];
    
    let totalCleared = 0;
    for (const pattern of patterns) {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
        totalCleared += keys.length;
      }
    }
    
    console.log(`Cleared ${totalCleared} cache entries`);
    return totalCleared;
  } catch (error) {
    console.error('Cache clear failed:', error.message);
    return 0;
  }
};

/**
 * Get cache statistics
 */
const getCacheStats = () => ({
  hits: cacheHits,
  misses: cacheMisses,
  hitRate: cacheHits + cacheMisses > 0 
    ? (cacheHits / (cacheHits + cacheMisses) * 100).toFixed(2) + '%' 
    : 'N/A',
});

module.exports = {
  CACHE_KEYS,
  CACHE_TTL,
  cacheGet,
  cacheSet,
  getOrCompute,
  writeThroughUpdate,
  invalidatePattern,
  cacheGetMulti,
  cacheSetMulti,
  cacheDriverCurrentRide,
  getDriverCurrentRideFromCache,
  invalidateDriverCurrentRide,
  cacheRiderCurrentRide,
  getRiderCurrentRideFromCache,
  invalidateRiderCurrentRide,
  invalidateRideCache,
  invalidateDriverCache,
  cachePaymentStatus,
  getPaymentFromCache,
  getSurgeMultiplier,
  computeSurgeMultiplier,
  warmUpCache,
  clearAllCaches,
  getCacheStats,
};
