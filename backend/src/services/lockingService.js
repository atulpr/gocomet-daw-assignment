const Redlock = require('redlock');
const { getRedisClient } = require('../config/redis');

let redlock = null;

/**
 * Initialize Redlock instance
 */
const initializeRedlock = () => {
  try {
    const redis = getRedisClient();
    
    redlock = new Redlock(
      [redis],
      {
        // Retry settings
        driftFactor: 0.01, // Multiplied by lock ttl to determine drift time
        retryCount: 3,
        retryDelay: 200, // Time in ms between retries
        retryJitter: 100, // Max random time added to retries
        automaticExtensionThreshold: 500, // Extend lock if less than this ms remaining
      }
    );

    redlock.on('error', (error) => {
      // Ignore resource locked errors (expected behavior)
      if (error.name === 'LockError') {
        return;
      }
      console.error('Redlock error:', error);
    });

    console.log('✅ Redlock initialized');
    return redlock;
  } catch (error) {
    console.warn('⚠️ Redlock initialization failed:', error.message);
    return null;
  }
};

/**
 * Acquire a distributed lock
 * @param {string} resource - Resource identifier to lock
 * @param {number} ttl - Lock TTL in milliseconds
 * @returns {Promise<Lock|null>} Lock object or null if failed
 */
const acquireLock = async (resource, ttl = 5000) => {
  if (!redlock) {
    redlock = initializeRedlock();
    if (!redlock) {
      console.warn('Redlock not available, proceeding without lock');
      return { resource, mockLock: true };
    }
  }

  try {
    const lock = await redlock.acquire([`lock:${resource}`], ttl);
    return lock;
  } catch (error) {
    if (error.name === 'LockError') {
      console.warn(`Could not acquire lock for ${resource}: resource is locked`);
      return null;
    }
    console.error(`Lock acquisition error for ${resource}:`, error.message);
    return null;
  }
};

/**
 * Release a distributed lock
 * @param {Lock} lock - Lock object to release
 */
const releaseLock = async (lock) => {
  if (!lock) return;
  
  // Handle mock lock (when Redis not available)
  if (lock.mockLock) return;

  try {
    await lock.release();
  } catch (error) {
    // Lock may have already expired
    if (error.name !== 'ExecutionError') {
      console.error('Lock release error:', error.message);
    }
  }
};

/**
 * Extend a lock's TTL
 * @param {Lock} lock - Lock object to extend
 * @param {number} ttl - New TTL in milliseconds
 */
const extendLock = async (lock, ttl = 5000) => {
  if (!lock || lock.mockLock) return lock;

  try {
    return await lock.extend(ttl);
  } catch (error) {
    console.error('Lock extension error:', error.message);
    return null;
  }
};

/**
 * Execute a function with a distributed lock
 * @param {string} resource - Resource identifier to lock
 * @param {Function} fn - Function to execute while holding lock
 * @param {number} ttl - Lock TTL in milliseconds
 * @returns {Promise<any>} Result of the function
 */
const withLock = async (resource, fn, ttl = 5000) => {
  const lock = await acquireLock(resource, ttl);
  
  if (!lock) {
    throw new Error(`Could not acquire lock for ${resource}`);
  }

  try {
    return await fn();
  } finally {
    await releaseLock(lock);
  }
};

/**
 * Check if a resource is locked
 * @param {string} resource - Resource identifier
 * @returns {Promise<boolean>} True if locked
 */
const isLocked = async (resource) => {
  try {
    const redis = getRedisClient();
    const exists = await redis.exists(`lock:${resource}`);
    return exists === 1;
  } catch (error) {
    return false;
  }
};

module.exports = {
  initializeRedlock,
  acquireLock,
  releaseLock,
  extendLock,
  withLock,
  isLocked,
};
