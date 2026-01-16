const paymentService = require('../services/paymentService');
const { asyncHandler } = require('../middleware/errorHandler');
const { BadRequestError } = require('../utils/errors');

/**
 * POST /v1/payments - Process payment
 */
const processPayment = asyncHandler(async (req, res) => {
  const { trip_id, payment_method, idempotency_key } = req.body;

  if (!idempotency_key) {
    throw new BadRequestError('idempotency_key is required');
  }

  const payment = await paymentService.processPayment(trip_id, payment_method, idempotency_key);

  res.status(payment.status === 'completed' ? 200 : 202).json({
    success: true,
    data: payment,
    message: payment.status === 'completed' ? 'Payment completed' : 'Payment processing',
  });
});

/**
 * GET /v1/payments/:id - Get payment by ID
 */
const getPayment = asyncHandler(async (req, res) => {
  const payment = await paymentService.getPaymentById(req.params.id);

  res.json({
    success: true,
    data: payment,
  });
});

/**
 * GET /v1/trips/:tripId/payment - Get payment for a trip
 */
const getPaymentByTrip = asyncHandler(async (req, res) => {
  const payment = await paymentService.getPaymentByTripId(req.params.tripId);

  res.json({
    success: true,
    data: payment,
  });
});

/**
 * POST /v1/payments/:id/retry - Retry failed payment
 */
const retryPayment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { idempotency_key } = req.body;

  if (!idempotency_key) {
    throw new BadRequestError('idempotency_key is required');
  }

  const payment = await paymentService.retryPayment(id, idempotency_key);

  res.json({
    success: true,
    data: payment,
    message: 'Payment retry initiated',
  });
});

/**
 * POST /v1/payments/:id/refund - Initiate refund
 */
const initiateRefund = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  const payment = await paymentService.initiateRefund(id, reason);

  res.json({
    success: true,
    data: payment,
    message: 'Refund initiated',
  });
});

module.exports = {
  processPayment,
  getPayment,
  getPaymentByTrip,
  retryPayment,
  initiateRefund,
};
