const rideService = require('../services/rideService');
const matchingService = require('../services/matchingService');
const { asyncHandler } = require('../middleware/errorHandler');

/**
 * POST /v1/rides - Create a new ride request
 */
const createRide = asyncHandler(async (req, res) => {
  const ride = await rideService.createRide(req.body);

  // Automatically start matching drivers
  try {
    const matchResult = await matchingService.findDriversForRide(ride.id);
    console.log(`Matching started for ride ${ride.id}: ${matchResult.message}`);
  } catch (matchError) {
    console.error(`Matching error for ride ${ride.id}:`, matchError.message);
    // Don't fail the ride creation, matching can be retried
  }

  res.status(201).json({
    success: true,
    data: ride,
    message: 'Ride request created successfully',
  });
});

/**
 * GET /v1/rides/:id - Get ride by ID
 */
const getRide = asyncHandler(async (req, res) => {
  const ride = await rideService.getRideById(req.params.id);

  res.json({
    success: true,
    data: ride,
  });
});

/**
 * PATCH /v1/rides/:id/status - Update ride status
 */
const updateRideStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const { version } = req.query;

  const ride = await rideService.updateRideStatus(
    req.params.id,
    status,
    version ? parseInt(version) : null
  );

  res.json({
    success: true,
    data: ride,
    message: `Ride status updated to ${status}`,
  });
});

/**
 * POST /v1/rides/:id/cancel - Cancel a ride
 */
const cancelRide = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  const ride = await rideService.cancelRide(req.params.id, reason);

  res.json({
    success: true,
    data: ride,
    message: 'Ride cancelled successfully',
  });
});

/**
 * GET /v1/riders/:riderId/rides - Get rides by rider
 */
const getRidesByRider = asyncHandler(async (req, res) => {
  const { riderId } = req.params;
  const { limit, offset, status } = req.query;

  const rides = await rideService.getRidesByRider(riderId, {
    limit: limit ? parseInt(limit) : 20,
    offset: offset ? parseInt(offset) : 0,
    status,
  });

  res.json({
    success: true,
    data: rides,
    meta: {
      limit: parseInt(limit) || 20,
      offset: parseInt(offset) || 0,
    },
  });
});

/**
 * GET /v1/riders/:riderId/current-ride - Get rider's current active ride
 */
const getRiderCurrentRide = asyncHandler(async (req, res) => {
  const { riderId } = req.params;
  const ride = await rideService.getRiderCurrentRide(riderId);

  res.json({
    success: true,
    data: ride,
  });
});

module.exports = {
  createRide,
  getRide,
  updateRideStatus,
  cancelRide,
  getRidesByRider,
  getRiderCurrentRide,
};
