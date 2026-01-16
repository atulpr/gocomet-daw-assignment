const { getRedisClient } = require('../config/redis');
const { TooManyRequestsError } = require('../utils/errors');

/**
 * Rate limiter configuration
 */
const RATE_LIMITS = {
  // General API rate limits
  default: { windowMs: 60000, max: 100 },           // 100 requests per minute
  
  // Endpoint-specific limits
  createRide: { windowMs: 60000, max: 10 },         // 10 ride requests per minute
  driverLocation: { windowMs: 1000, max: 3 },       // 3 location updates per second
  acceptRide: { windowMs: 60000, max: 30 },         // 30 accepts per minute
  payment: { windowMs: 60000, max: 10 },            // 10 payment attempts per minute
  
  // Auth limits (stricter)
  login: { windowMs: 300000, max: 5 },              // 5 login attempts per 5 minutes
  register: { windowMs: 3600000, max: 3 },          // 3 registrations per hour
};

/**
 * Create rate limiter middleware
 * @param {string} limitType - Type of rate limit to apply
 * @param {Object} options - Override options
 */
const rateLimiter = (limitType = 'default', options = {}) => {
  const config = { ...RATE_LIMITS[limitType] || RATE_LIMITS.default, ...options };
  const { windowMs, max } = config;

  return async (req, res, next) => {
    // Generate key based on IP and optional user ID
    const identifier = req.user?.id || req.ip || 'anonymous';
    const key = `ratelimit:${limitType}:${identifier}`;

    let redis;
    try {
      redis = getRedisClient();
    } catch (error) {
      // Redis not available, allow request (fail open)
      console.warn('Rate limiter: Redis not available, allowing request');
      return next();
    }

    try {
      const now = Date.now();
      const windowStart = now - windowMs;

      // Use Redis sorted set for sliding window
      const multi = redis.multi();
      
      // Remove old entries outside the window
      multi.zremrangebyscore(key, 0, windowStart);
      
      // Count requests in current window
      multi.zcard(key);
      
      // Add current request
      multi.zadd(key, now, `${now}-${Math.random()}`);
      
      // Set expiry on the key
      multi.expire(key, Math.ceil(windowMs / 1000));

      const results = await multi.exec();
      const requestCount = results[1][1]; // zcard result

      // Set rate limit headers
      res.set({
        'X-RateLimit-Limit': max,
        'X-RateLimit-Remaining': Math.max(0, max - requestCount - 1),
        'X-RateLimit-Reset': new Date(now + windowMs).toISOString(),
      });

      if (requestCount >= max) {
        const retryAfter = Math.ceil(windowMs / 1000);
        res.set('Retry-After', retryAfter);
        
        return res.status(429).json({
          success: false,
          error: {
            code: 'RATE_LIMITED',
            message: `Too many requests. Please try again in ${retryAfter} seconds.`,
            retryAfter,
          },
        });
      }

      next();
    } catch (error) {
      console.error('Rate limiter error:', error.message);
      // Fail open - allow request if rate limiting fails
      next();
    }
  };
};

/**
 * IP-based rate limiter (for unauthenticated endpoints)
 */
const ipRateLimiter = (windowMs = 60000, max = 100) => {
  return rateLimiter('default', { windowMs, max });
};

/**
 * User-based rate limiter (for authenticated endpoints)
 */
const userRateLimiter = (limitType = 'default') => {
  return rateLimiter(limitType);
};

/**
 * Strict rate limiter for sensitive operations
 */
const strictRateLimiter = (windowMs = 60000, max = 5) => {
  return rateLimiter('default', { windowMs, max });
};

module.exports = {
  rateLimiter,
  ipRateLimiter,
  userRateLimiter,
  strictRateLimiter,
  RATE_LIMITS,
};
