const authService = require('../services/authService');
const { asyncHandler } = require('../middleware/errorHandler');

/**
 * POST /v1/auth/send-otp - Send OTP to phone
 */
const sendOtp = asyncHandler(async (req, res) => {
  const { phone, user_type } = req.body;

  const result = await authService.sendOtp(phone, user_type);

  res.json({
    success: true,
    data: result,
  });
});

/**
 * POST /v1/auth/verify-otp - Verify OTP and login
 */
const verifyOtp = asyncHandler(async (req, res) => {
  const { phone, otp, user_type, tenant_id } = req.body;

  const result = await authService.verifyOtp(phone, otp, user_type, tenant_id);

  res.json({
    success: true,
    data: result,
    message: result.user.isNewUser ? 'Account created successfully' : 'Login successful',
  });
});

/**
 * GET /v1/auth/me - Get current user profile
 */
const getProfile = asyncHandler(async (req, res) => {
  const user = await authService.getUserById(req.user.id, req.user.type);

  res.json({
    success: true,
    data: {
      ...user,
      type: req.user.type,
    },
  });
});

/**
 * PATCH /v1/auth/profile - Update user profile
 */
const updateProfile = asyncHandler(async (req, res) => {
  const user = await authService.updateProfile(req.user.id, req.user.type, req.body);

  res.json({
    success: true,
    data: user,
    message: 'Profile updated successfully',
  });
});

/**
 * PATCH /v1/auth/vehicle - Update driver vehicle info
 */
const updateVehicle = asyncHandler(async (req, res) => {
  if (req.user.type !== 'driver') {
    return res.status(403).json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Only drivers can update vehicle info',
      },
    });
  }

  const driver = await authService.updateDriverVehicle(req.user.id, req.body);

  res.json({
    success: true,
    data: driver,
    message: 'Vehicle info updated successfully',
  });
});

/**
 * GET /v1/auth/tenants - Get available tenants
 */
const getTenants = asyncHandler(async (req, res) => {
  const tenants = await authService.getTenants();

  res.json({
    success: true,
    data: tenants,
  });
});

/**
 * POST /v1/auth/logout - Logout user
 */
const logout = asyncHandler(async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const result = await authService.logout(req.user.id, token);

  res.json({
    success: true,
    ...result,
  });
});

module.exports = {
  sendOtp,
  verifyOtp,
  getProfile,
  updateProfile,
  updateVehicle,
  getTenants,
  logout,
};
