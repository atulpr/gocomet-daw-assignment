const { getRedisClient } = require('../config/redis');
const { IdempotencyError } = require('../utils/errors');

const IDEMPOTENCY_TTL = 24 * 60 * 60; // 24 hours in seconds

/**
 * Idempotency middleware
 * Ensures requests with the same idempotency key return the same response
 * 
 * Usage:
 * - Client sends Idempotency-Key header with a unique key
 * - First request is processed and response is cached
 * - Subsequent requests with same key return cached response
 */
const idempotency = (options = {}) => {
  const {
    keyHeader = 'idempotency-key',
    ttl = IDEMPOTENCY_TTL,
    required = false,
  } = options;

  return async (req, res, next) => {
    const idempotencyKey = req.headers[keyHeader] || req.body?.idempotency_key;

    // If no key provided
    if (!idempotencyKey) {
      if (required) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'IDEMPOTENCY_KEY_REQUIRED',
            message: `${keyHeader} header or idempotency_key in body is required`,
          },
        });
      }
      return next();
    }

    let redis;
    try {
      redis = getRedisClient();
    } catch (error) {
      // Redis not available, skip idempotency check
      console.warn('Redis not available, skipping idempotency check');
      return next();
    }

    const cacheKey = `idempotency:${req.method}:${req.originalUrl}:${idempotencyKey}`;

    try {
      // Check if request is already being processed (lock)
      const lockKey = `${cacheKey}:lock`;
      const lockAcquired = await redis.set(lockKey, '1', 'EX', 30, 'NX');

      if (!lockAcquired) {
        // Request with same key is currently being processed
        return res.status(409).json({
          success: false,
          error: {
            code: 'IDEMPOTENCY_IN_PROGRESS',
            message: 'A request with this idempotency key is currently being processed',
          },
        });
      }

      // Check for cached response
      const cachedResponse = await redis.get(cacheKey);

      if (cachedResponse) {
        // Release lock and return cached response
        await redis.del(lockKey);
        const parsed = JSON.parse(cachedResponse);
        return res.status(parsed.statusCode).json(parsed.body);
      }

      // Store original res.json to intercept response
      const originalJson = res.json.bind(res);

      res.json = async (body) => {
        try {
          // Cache the response
          const responseData = {
            statusCode: res.statusCode,
            body,
            timestamp: Date.now(),
          };

          await redis.setex(cacheKey, ttl, JSON.stringify(responseData));
        } catch (cacheError) {
          console.error('Failed to cache idempotency response:', cacheError.message);
        } finally {
          // Release lock
          await redis.del(lockKey).catch(() => {});
        }

        return originalJson(body);
      };

      // Store idempotency key in request for later use
      req.idempotencyKey = idempotencyKey;

      next();
    } catch (error) {
      console.error('Idempotency middleware error:', error.message);
      // On error, proceed without idempotency
      next();
    }
  };
};

/**
 * Check if a specific idempotency key has been used
 * @param {string} key - Idempotency key to check
 * @returns {Promise<Object|null>} Cached response or null
 */
const checkIdempotencyKey = async (key) => {
  try {
    const redis = getRedisClient();
    const cached = await redis.get(`idempotency:${key}`);
    return cached ? JSON.parse(cached) : null;
  } catch (error) {
    return null;
  }
};

/**
 * Store response for idempotency key
 * @param {string} key - Idempotency key
 * @param {Object} response - Response to cache
 * @param {number} ttl - TTL in seconds
 */
const storeIdempotencyResponse = async (key, response, ttl = IDEMPOTENCY_TTL) => {
  try {
    const redis = getRedisClient();
    await redis.setex(`idempotency:${key}`, ttl, JSON.stringify(response));
  } catch (error) {
    console.error('Failed to store idempotency response:', error.message);
  }
};

module.exports = {
  idempotency,
  checkIdempotencyKey,
  storeIdempotencyResponse,
  IDEMPOTENCY_TTL,
};
