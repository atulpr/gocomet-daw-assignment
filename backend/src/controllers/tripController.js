const tripService = require('../services/tripService');
const { asyncHandler } = require('../middleware/errorHandler');

/**
 * POST /v1/trips/start - Start a trip
 */
const startTrip = asyncHandler(async (req, res) => {
  const { ride_id } = req.body;
  const result = await tripService.startTrip(ride_id);

  res.status(201).json({
    success: true,
    data: result,
    message: 'Trip started successfully',
  });
});

/**
 * POST /v1/trips/:id/end - End a trip
 */
const endTrip = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await tripService.endTrip(id, req.body);

  res.json({
    success: true,
    data: result,
    message: 'Trip completed successfully',
  });
});

/**
 * GET /v1/trips/:id - Get trip details
 */
const getTrip = asyncHandler(async (req, res) => {
  const trip = await tripService.getTripById(req.params.id);

  res.json({
    success: true,
    data: trip,
  });
});

/**
 * PATCH /v1/rides/:id/status - Update ride status
 */
const updateRideStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const ride = await tripService.updateRideStatusForTrip(id, status);

  res.json({
    success: true,
    data: ride,
    message: `Ride status updated to ${status}`,
  });
});

/**
 * GET /v1/trips/fare-estimate - Calculate fare estimate
 */
const getFareEstimate = asyncHandler(async (req, res) => {
  const { tier, distance_km, duration_mins, surge_multiplier } = req.query;

  const fare = tripService.calculateFare(
    tier || 'economy',
    parseFloat(distance_km) || 5,
    parseInt(duration_mins) || 15,
    parseFloat(surge_multiplier) || 1
  );

  res.json({
    success: true,
    data: fare,
  });
});

module.exports = {
  startTrip,
  endTrip,
  getTrip,
  updateRideStatus,
  getFareEstimate,
};
