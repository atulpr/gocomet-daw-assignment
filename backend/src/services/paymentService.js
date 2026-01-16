const { v4: uuidv4 } = require('uuid');
const { query, queryRead, executeTransaction } = require('../config/database');
const { getRedisClient, invalidateCache } = require('../config/redis');
const { publishNotification } = require('../config/kafka');
const { NotFoundError, ConflictError, IdempotencyError } = require('../utils/errors');
const {
  cacheGet,
  cacheSet,
  getOrCompute,
  CACHE_KEYS,
  CACHE_TTL,
  cachePaymentStatus,
  getPaymentFromCache,
  invalidateRideCache,
  invalidateDriverCurrentRide,
  invalidateRiderCurrentRide,
} = require('./cacheService');

const IDEMPOTENCY_TTL = 24 * 60 * 60; // 24 hours
const PAYMENT_LOCK_TTL = 30000; // 30 seconds

/**
 * OPTIMIZED: Process payment for a trip (idempotent with distributed locking)
 * - Uses Redis for idempotency check (sub-ms)
 * - Distributed lock to prevent double processing
 * - Parallel cache invalidation
 */
const processPayment = async (tripId, paymentMethod, idempotencyKey) => {
  const startTime = Date.now();
  const redis = getRedisClient();
  
  // FAST PATH: Check idempotency in Redis first
  const existingPayment = await checkIdempotencyKey(idempotencyKey);
  if (existingPayment) {
    return existingPayment;
  }

  // Acquire distributed lock on payment processing
  const lockKey = `payment_lock:${tripId}`;
  const lockValue = uuidv4();
  const lockAcquired = await redis.set(lockKey, lockValue, 'PX', PAYMENT_LOCK_TTL, 'NX');
  
  if (!lockAcquired) {
    // Another process is handling this payment
    // Wait briefly and check idempotency again
    await new Promise(r => setTimeout(r, 100));
    const retryCheck = await checkIdempotencyKey(idempotencyKey);
    if (retryCheck) return retryCheck;
    
    throw new ConflictError('Payment is being processed. Please try again.');
  }

  try {
    const result = await executeTransaction(async (client) => {
      // Check if payment already exists
      const existingResult = await client.query(
        'SELECT * FROM payments WHERE trip_id = $1',
        [tripId]
      );

      if (existingResult.rowCount > 0) {
        const existing = existingResult.rows[0];
        if (existing.status === 'completed') {
          return existing;
        }
      }

      // Get trip details with rider/driver info in single query
      const tripResult = await client.query(
        `SELECT t.*, r.rider_id, r.driver_id, r.tenant_id, r.id as ride_id
         FROM trips t
         JOIN rides r ON t.ride_id = r.id
         WHERE t.id = $1`,
        [tripId]
      );

      if (tripResult.rowCount === 0) {
        throw new NotFoundError('Trip');
      }

      const trip = tripResult.rows[0];

      if (trip.status !== 'COMPLETED') {
        throw new ConflictError('Trip must be completed before payment');
      }

      const amount = trip.total_fare;
      const paymentId = uuidv4();

      // Create or update payment record
      if (existingResult.rowCount > 0) {
        await client.query(
          `UPDATE payments 
           SET status = 'processing', idempotency_key = $1, updated_at = NOW()
           WHERE trip_id = $2`,
          [idempotencyKey, tripId]
        );
      } else {
        await client.query(
          `INSERT INTO payments (id, trip_id, amount, currency, payment_method, status, idempotency_key)
           VALUES ($1, $2, $3, 'INR', $4, 'processing', $5)`,
          [paymentId, tripId, amount, paymentMethod, idempotencyKey]
        );
      }

      // Process payment (mock PSP)
      let paymentResult;
      switch (paymentMethod) {
        case 'cash':
          paymentResult = await processCashPayment(tripId, amount);
          break;
        case 'card':
          paymentResult = await processCardPayment(tripId, amount);
          break;
        case 'wallet':
          paymentResult = await processWalletPayment(tripId, amount);
          break;
        default:
          throw new ConflictError(`Invalid payment method: ${paymentMethod}`);
      }

      // Update payment with result
      const isCompleted = paymentResult.status === 'completed';
      const finalResult = await client.query(
        `UPDATE payments 
         SET status = $1, psp_reference = $2, psp_response = $3, 
             completed_at = CASE WHEN $4 THEN NOW() ELSE NULL END,
             updated_at = NOW()
         WHERE trip_id = $5
         RETURNING *`,
        [paymentResult.status, paymentResult.reference, JSON.stringify(paymentResult), isCompleted, tripId]
      );

      const payment = finalResult.rows[0];

      // Store idempotency result
      await storeIdempotencyResult(idempotencyKey, payment);

      // PARALLEL: Cache payment and invalidate related caches
      const cachePromises = [
        cachePaymentStatus(tripId, payment),
        invalidateRideCache(trip.ride_id, trip.driver_id, trip.rider_id),
        invalidateDriverCurrentRide(trip.driver_id),
        invalidateRiderCurrentRide(trip.rider_id),
      ];

      // PARALLEL: Send notifications if completed
      if (payment.status === 'completed') {
        cachePromises.push(
          publishNotification(trip.rider_id, 'PAYMENT_COMPLETED', {
            trip_id: tripId,
            amount: amount,
            payment_method: paymentMethod,
          }),
          publishNotification(trip.driver_id, 'PAYMENT_RECEIVED', {
            trip_id: tripId,
            amount: amount * 0.8,
          })
        );
      }

      await Promise.all(cachePromises);

      return payment;
    }, { isolationLevel: 'SERIALIZABLE', maxRetries: 3 });

    const duration = Date.now() - startTime;
    if (duration > 500) {
      console.warn(`⚠️ Slow payment processing: ${duration}ms`);
    }

    return result;
  } finally {
    // Release lock only if we own it
    const currentValue = await redis.get(lockKey);
    if (currentValue === lockValue) {
      await redis.del(lockKey);
    }
  }
};

/**
 * Process cash payment (immediate completion)
 */
const processCashPayment = async (tripId, amount) => {
  return {
    status: 'completed',
    reference: `CASH-${Date.now()}`,
    method: 'cash',
    amount,
    message: 'Cash payment collected by driver',
  };
};

/**
 * Process card payment (mock PSP integration)
 */
const processCardPayment = async (tripId, amount) => {
  await simulateApiDelay(50, 150); // Reduced delay for demo

  // 95% success rate
  const success = Math.random() < 0.95;

  if (success) {
    return {
      status: 'completed',
      reference: `CARD-${uuidv4().substring(0, 8).toUpperCase()}`,
      method: 'card',
      amount,
      psp: 'mock_gateway',
      transaction_id: uuidv4(),
    };
  } else {
    return {
      status: 'failed',
      reference: null,
      method: 'card',
      amount,
      error: 'Card declined',
      error_code: 'CARD_DECLINED',
    };
  }
};

/**
 * Process wallet payment
 */
const processWalletPayment = async (tripId, amount) => {
  await simulateApiDelay(30, 100);

  return {
    status: 'completed',
    reference: `WALLET-${Date.now()}`,
    method: 'wallet',
    amount,
    wallet_balance_after: Math.random() * 1000,
  };
};

/**
 * OPTIMIZED: Get payment by trip ID (cached)
 */
const getPaymentByTripId = async (tripId) => {
  // Try cache first
  const cached = await getPaymentFromCache(tripId);
  if (cached) {
    return cached;
  }

  const result = await queryRead(
    'SELECT * FROM payments WHERE trip_id = $1',
    [tripId]
  );

  const payment = result.rows[0] || null;
  
  if (payment) {
    await cachePaymentStatus(tripId, payment);
  }

  return payment;
};

/**
 * Get payment by ID
 */
const getPaymentById = async (id) => {
  const result = await queryRead(
    'SELECT * FROM payments WHERE id = $1',
    [id]
  );

  if (result.rowCount === 0) {
    throw new NotFoundError('Payment');
  }

  return result.rows[0];
};

/**
 * Retry failed payment
 */
const retryPayment = async (paymentId, idempotencyKey) => {
  const payment = await getPaymentById(paymentId);

  if (payment.status !== 'failed') {
    throw new ConflictError('Only failed payments can be retried');
  }

  await query(
    "UPDATE payments SET status = 'pending', updated_at = NOW() WHERE id = $1",
    [paymentId]
  );

  return processPayment(payment.trip_id, payment.payment_method, idempotencyKey);
};

/**
 * Initiate refund
 */
const initiateRefund = async (paymentId, reason) => {
  const payment = await getPaymentById(paymentId);

  if (payment.status !== 'completed') {
    throw new ConflictError('Only completed payments can be refunded');
  }

  if (payment.payment_method === 'cash') {
    throw new ConflictError('Cash payments cannot be refunded through the system');
  }

  await simulateApiDelay(50, 150);

  const result = await query(
    `UPDATE payments 
     SET status = 'refunded', 
         psp_response = psp_response || $1::jsonb,
         updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [JSON.stringify({ refund_reason: reason, refunded_at: new Date().toISOString() }), paymentId]
  );

  // Invalidate cache
  await invalidateCache(CACHE_KEYS.PAYMENT(payment.trip_id));

  return result.rows[0];
};

// Helper functions

const checkIdempotencyKey = async (key) => {
  try {
    const redis = getRedisClient();
    const cached = await redis.get(`payment:idempotency:${key}`);
    return cached ? JSON.parse(cached) : null;
  } catch (error) {
    return null;
  }
};

const storeIdempotencyResult = async (key, result) => {
  try {
    const redis = getRedisClient();
    await redis.setex(
      `payment:idempotency:${key}`,
      IDEMPOTENCY_TTL,
      JSON.stringify(result)
    );
  } catch (error) {
    console.error('Failed to store idempotency result:', error.message);
  }
};

const simulateApiDelay = (minMs, maxMs) => {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise(resolve => setTimeout(resolve, delay));
};

module.exports = {
  processPayment,
  getPaymentByTripId,
  getPaymentById,
  retryPayment,
  initiateRefund,
};
