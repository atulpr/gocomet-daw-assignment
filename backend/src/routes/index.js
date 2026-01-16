const express = require('express');
const rideController = require('../controllers/rideController');
const driverController = require('../controllers/driverController');
const tripController = require('../controllers/tripController');
const paymentController = require('../controllers/paymentController');
const authController = require('../controllers/authController');
const { validate, schemas } = require('../middleware/validation');
const { idempotency } = require('../middleware/idempotency');
const { rateLimiter } = require('../middleware/rateLimiter');
const { authenticate, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// =====================
// Auth Routes (Public)
// =====================

// Get available tenants
router.get('/auth/tenants', authController.getTenants);

// Send OTP
router.post(
  '/auth/send-otp',
  rateLimiter('login'),  // 5 requests per 5 minutes
  authController.sendOtp
);

// Verify OTP and login
router.post(
  '/auth/verify-otp',
  rateLimiter('login'),
  authController.verifyOtp
);

// =====================
// Auth Routes (Protected)
// =====================

// Get current user profile
router.get('/auth/me', authenticate, authController.getProfile);

// Update profile
router.patch('/auth/profile', authenticate, authController.updateProfile);

// Update vehicle (drivers only)
router.patch('/auth/vehicle', authenticate, authController.updateVehicle);

// Logout
router.post('/auth/logout', authenticate, authController.logout);

// =====================
// Ride Routes
// =====================

// Apply optional auth to track user
router.use(optionalAuth);

// Create a new ride request
router.post(
  '/rides',
  rateLimiter('createRide'),  // 10 requests per minute
  idempotency(),
  validate(schemas.createRide, 'body'),
  rideController.createRide
);

// Get ride by ID
router.get(
  '/rides/:id',
  validate(schemas.getRideParams, 'params'),
  rideController.getRide
);

// Update ride status
router.patch(
  '/rides/:id/status',
  validate(schemas.getRideParams, 'params'),
  rideController.updateRideStatus
);

// Cancel a ride
router.post(
  '/rides/:id/cancel',
  validate(schemas.getRideParams, 'params'),
  rideController.cancelRide
);

// Get rides by rider
router.get(
  '/riders/:riderId/rides',
  rideController.getRidesByRider
);

// Get rider's current active ride
router.get(
  '/riders/:riderId/current-ride',
  rideController.getRiderCurrentRide
);

// =====================
// Driver Routes
// =====================

// Update driver location (high frequency)
router.post(
  '/drivers/:id/location',
  rateLimiter('driverLocation'),  // 3 requests per second
  validate(schemas.driverParams, 'params'),
  validate(schemas.updateLocation, 'body'),
  driverController.updateLocation
);

// Get driver details
router.get(
  '/drivers/:id',
  validate(schemas.driverParams, 'params'),
  driverController.getDriver
);

// Update driver status (online/offline)
router.patch(
  '/drivers/:id/status',
  validate(schemas.driverParams, 'params'),
  driverController.updateStatus
);

// Accept a ride
router.post(
  '/drivers/:id/accept',
  rateLimiter('acceptRide'),  // 30 requests per minute
  validate(schemas.driverParams, 'params'),
  validate(schemas.acceptRide, 'body'),
  driverController.acceptRide
);

// Decline a ride
router.post(
  '/drivers/:id/decline',
  validate(schemas.driverParams, 'params'),
  driverController.declineRide
);

// Get driver's current ride
router.get(
  '/drivers/:id/current-ride',
  validate(schemas.driverParams, 'params'),
  driverController.getCurrentRide
);

// Get pending ride offers for driver
router.get(
  '/drivers/:id/pending-offers',
  validate(schemas.driverParams, 'params'),
  driverController.getPendingOffers
);

// =====================
// Trip Routes
// =====================

// Start a trip
router.post(
  '/trips/start',
  tripController.startTrip
);

// End a trip
router.post(
  '/trips/:id/end',
  validate(schemas.tripParams, 'params'),
  tripController.endTrip
);

// Get trip details
router.get(
  '/trips/:id',
  validate(schemas.tripParams, 'params'),
  tripController.getTrip
);

// Get fare estimate
router.get(
  '/trips/fare-estimate',
  tripController.getFareEstimate
);

// Update ride status (driver en route, arrived)
router.patch(
  '/trips/ride/:id/status',
  tripController.updateRideStatus
);

// =====================
// Payment Routes
// =====================

// Process payment
router.post(
  '/payments',
  rateLimiter('payment'),  // 10 requests per minute
  idempotency({ required: true }),
  validate(schemas.createPayment, 'body'),
  paymentController.processPayment
);

// Get payment by ID
router.get(
  '/payments/:id',
  paymentController.getPayment
);

// Get payment by trip
router.get(
  '/trips/:tripId/payment',
  paymentController.getPaymentByTrip
);

// Retry failed payment
router.post(
  '/payments/:id/retry',
  rateLimiter('payment'),
  idempotency({ required: true }),
  paymentController.retryPayment
);

// Initiate refund
router.post(
  '/payments/:id/refund',
  rateLimiter('payment'),
  paymentController.initiateRefund
);

module.exports = router;
