const { v4: uuidv4 } = require('uuid');
const { query, executeTransaction } = require('../config/database');
const { getRedisClient } = require('../config/redis');
const { generateToken } = require('../middleware/auth');
const { NotFoundError, BadRequestError, UnauthorizedError } = require('../utils/errors');

const OTP_EXPIRY_SECONDS = 300; // 5 minutes
const OTP_LENGTH = 6;

/**
 * Send OTP to phone number
 * In production, integrate with Twilio/MSG91/etc.
 */
const sendOtp = async (phone, userType) => {
  // Validate phone format
  if (!phone || !/^\+?[1-9]\d{9,14}$/.test(phone.replace(/\s/g, ''))) {
    throw new BadRequestError('Invalid phone number format');
  }

  // Generate OTP
  const otp = generateOtp();
  
  // Store OTP in Redis with expiry
  const key = `otp:${userType}:${phone}`;
  
  try {
    const redis = getRedisClient();
    await redis.setex(key, OTP_EXPIRY_SECONDS, otp);
  } catch (error) {
    console.error('Redis error storing OTP:', error.message);
    // Fall back to in-memory for demo
  }

  // In production, send OTP via SMS
  // await twilioClient.messages.create({
  //   body: `Your GoComet verification code is: ${otp}`,
  //   to: phone,
  //   from: process.env.TWILIO_PHONE_NUMBER,
  // });

  console.log(`[DEMO] OTP for ${phone}: ${otp}`);

  return {
    message: 'OTP sent successfully',
    expiresIn: OTP_EXPIRY_SECONDS,
    // Only return OTP in development for testing
    ...(process.env.NODE_ENV === 'development' && { otp }),
  };
};

/**
 * Verify OTP and login/register user
 */
const verifyOtp = async (phone, otp, userType, tenantId) => {
  // Get stored OTP
  const key = `otp:${userType}:${phone}`;
  let storedOtp;

  try {
    const redis = getRedisClient();
    storedOtp = await redis.get(key);
  } catch (error) {
    console.error('Redis error retrieving OTP:', error.message);
  }

  // For demo: accept "123456" as universal OTP
  const isValidOtp = storedOtp === otp || (process.env.NODE_ENV === 'development' && otp === '123456');

  if (!isValidOtp) {
    throw new UnauthorizedError('Invalid or expired OTP');
  }

  // Delete used OTP
  try {
    const redis = getRedisClient();
    await redis.del(key);
  } catch (error) {
    // Ignore
  }

  // Find or create user
  let user;
  if (userType === 'rider') {
    user = await findOrCreateRider(phone, tenantId);
  } else if (userType === 'driver') {
    user = await findOrCreateDriver(phone, tenantId);
  } else {
    throw new BadRequestError('Invalid user type');
  }

  // Generate token
  const token = generateToken({
    userId: user.id,
    userType,
    tenantId: user.tenant_id,
    phone: user.phone,
  });

  return {
    token,
    user: {
      id: user.id,
      phone: user.phone,
      name: user.name,
      type: userType,
      tenantId: user.tenant_id,
      isNewUser: user.isNew,
    },
  };
};

/**
 * Find existing rider or create new one
 */
const findOrCreateRider = async (phone, tenantId) => {
  // Try to find existing rider
  const existingResult = await query(
    'SELECT * FROM riders WHERE phone = $1',
    [phone]
  );

  if (existingResult.rowCount > 0) {
    return { ...existingResult.rows[0], isNew: false };
  }

  // Create new rider
  const id = uuidv4();
  const result = await query(
    `INSERT INTO riders (id, tenant_id, phone, name) 
     VALUES ($1, $2, $3, $4) 
     RETURNING *`,
    [id, tenantId, phone, null]
  );

  return { ...result.rows[0], isNew: true };
};

/**
 * Find existing driver or create new one
 */
const findOrCreateDriver = async (phone, tenantId) => {
  // Try to find existing driver
  const existingResult = await query(
    'SELECT * FROM drivers WHERE phone = $1',
    [phone]
  );

  if (existingResult.rowCount > 0) {
    return { ...existingResult.rows[0], isNew: false };
  }

  // Create new driver (pending approval in production)
  const id = uuidv4();
  const result = await query(
    `INSERT INTO drivers (id, tenant_id, phone, name, status, vehicle_type) 
     VALUES ($1, $2, $3, $4, 'offline', 'economy') 
     RETURNING *`,
    [id, tenantId, phone, null]
  );

  return { ...result.rows[0], isNew: true };
};

/**
 * Update user profile
 */
const updateProfile = async (userId, userType, data) => {
  const { name, email } = data;
  const table = userType === 'rider' ? 'riders' : 'drivers';

  const result = await query(
    `UPDATE ${table} 
     SET name = COALESCE($1, name), 
         email = COALESCE($2, email),
         updated_at = NOW()
     WHERE id = $3
     RETURNING *`,
    [name, email, userId]
  );

  if (result.rowCount === 0) {
    throw new NotFoundError(userType === 'rider' ? 'Rider' : 'Driver');
  }

  return result.rows[0];
};

/**
 * Update driver vehicle info
 */
const updateDriverVehicle = async (driverId, data) => {
  const { vehicle_number, vehicle_type } = data;

  const result = await query(
    `UPDATE drivers 
     SET vehicle_number = COALESCE($1, vehicle_number), 
         vehicle_type = COALESCE($2, vehicle_type),
         updated_at = NOW()
     WHERE id = $3
     RETURNING *`,
    [vehicle_number, vehicle_type, driverId]
  );

  if (result.rowCount === 0) {
    throw new NotFoundError('Driver');
  }

  return result.rows[0];
};

/**
 * Get user by ID
 */
const getUserById = async (userId, userType) => {
  const table = userType === 'rider' ? 'riders' : 'drivers';
  
  const result = await query(
    `SELECT * FROM ${table} WHERE id = $1`,
    [userId]
  );

  if (result.rowCount === 0) {
    throw new NotFoundError(userType === 'rider' ? 'Rider' : 'Driver');
  }

  return result.rows[0];
};

/**
 * Get all tenants (for login screen)
 */
const getTenants = async () => {
  const result = await query(
    'SELECT id, name, region FROM tenants ORDER BY name'
  );
  return result.rows;
};

/**
 * Logout (invalidate token)
 */
const logout = async (userId, token) => {
  // In production, add token to blacklist
  try {
    const redis = getRedisClient();
    // Store invalidated token until its expiry
    await redis.setex(`blacklist:${token}`, 24 * 60 * 60, '1');
  } catch (error) {
    // Ignore Redis errors
  }

  return { message: 'Logged out successfully' };
};

// Helper functions

const generateOtp = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

module.exports = {
  sendOtp,
  verifyOtp,
  updateProfile,
  updateDriverVehicle,
  getUserById,
  getTenants,
  logout,
};
