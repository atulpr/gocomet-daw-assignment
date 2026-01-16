const driverService = require('../services/driverService');
const matchingService = require('../services/matchingService');
const { asyncHandler } = require('../middleware/errorHandler');

/**
 * POST /v1/drivers/:id/location - Update driver location
 */
const updateLocation = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const location = await driverService.updateLocation(id, req.body);

  res.json({
    success: true,
    data: location,
  });
});

/**
 * GET /v1/drivers/:id - Get driver details
 */
const getDriver = asyncHandler(async (req, res) => {
  const driver = await driverService.getDriverById(req.params.id);

  res.json({
    success: true,
    data: driver,
  });
});

/**
 * PATCH /v1/drivers/:id/status - Update driver status
 */
const updateStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const driver = await driverService.updateDriverStatus(id, status);

  res.json({
    success: true,
    data: driver,
    message: `Driver status updated to ${status}`,
  });
});

/**
 * POST /v1/drivers/:id/accept - Accept a ride
 */
const acceptRide = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { ride_id } = req.body;

  const result = await matchingService.acceptRide(ride_id, id);

  res.json({
    success: true,
    data: result,
    message: 'Ride accepted successfully',
  });
});

/**
 * POST /v1/drivers/:id/decline - Decline a ride offer
 */
const declineRide = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { ride_id, reason } = req.body;

  await matchingService.declineRide(ride_id, id, reason);

  res.json({
    success: true,
    message: 'Ride offer declined',
  });
});

/**
 * GET /v1/drivers/:id/current-ride - Get driver's current active ride
 */
const getCurrentRide = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const ride = await matchingService.getDriverCurrentRide(id);

  res.json({
    success: true,
    data: ride,
  });
});

/**
 * GET /v1/drivers/:id/pending-offers - Get pending ride offers for driver
 */
const getPendingOffers = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const offers = await driverService.getPendingOffers(id);

  res.json({
    success: true,
    data: offers,
  });
});

module.exports = {
  updateLocation,
  getDriver,
  updateStatus,
  acceptRide,
  declineRide,
  getCurrentRide,
  getPendingOffers,
};
