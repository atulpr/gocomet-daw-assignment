const crypto = require('crypto');
const { UnauthorizedError, ForbiddenError } = require('../utils/errors');

/**
 * Simple JWT-like token handling
 * In production, use a proper JWT library like jsonwebtoken
 */

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';
const TOKEN_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Generate a simple token
 * @param {Object} payload - Token payload
 * @returns {string} Token
 */
const generateToken = (payload) => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const data = Buffer.from(JSON.stringify({
    ...payload,
    iat: Date.now(),
    exp: Date.now() + TOKEN_EXPIRY,
  })).toString('base64url');
  
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${data}`)
    .digest('base64url');
  
  return `${header}.${data}.${signature}`;
};

/**
 * Verify and decode a token
 * @param {string} token - Token to verify
 * @returns {Object} Decoded payload
 */
const verifyToken = (token) => {
  if (!token) {
    throw new UnauthorizedError('No token provided');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new UnauthorizedError('Invalid token format');
  }

  const [header, data, signature] = parts;

  // Verify signature
  const expectedSignature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${data}`)
    .digest('base64url');

  if (signature !== expectedSignature) {
    throw new UnauthorizedError('Invalid token signature');
  }

  // Decode payload
  const payload = JSON.parse(Buffer.from(data, 'base64url').toString());

  // Check expiry
  if (payload.exp && payload.exp < Date.now()) {
    throw new UnauthorizedError('Token expired');
  }

  return payload;
};

/**
 * Authentication middleware
 * Extracts and verifies JWT from Authorization header
 */
const authenticate = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      throw new UnauthorizedError('Authorization header required');
    }

    // Support both "Bearer <token>" and just "<token>"
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : authHeader;

    const payload = verifyToken(token);

    // Attach user info to request
    req.user = {
      id: payload.userId,
      type: payload.userType, // 'rider' or 'driver'
      tenantId: payload.tenantId,
    };

    next();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: error.message,
        },
      });
    }
    next(error);
  }
};

/**
 * Optional authentication - doesn't fail if no token
 */
const optionalAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader) {
      const token = authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : authHeader;

      const payload = verifyToken(token);
      req.user = {
        id: payload.userId,
        type: payload.userType,
        tenantId: payload.tenantId,
      };
    }

    next();
  } catch (error) {
    // Ignore auth errors for optional auth
    next();
  }
};

/**
 * Role-based authorization middleware
 * @param {string[]} allowedRoles - Roles allowed to access
 */
const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      });
    }

    if (!allowedRoles.includes(req.user.type)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: `Access denied. Required role: ${allowedRoles.join(' or ')}`,
        },
      });
    }

    next();
  };
};

/**
 * Verify resource ownership
 * Ensures user can only access their own resources
 */
const verifyOwnership = (resourceUserIdField = 'userId') => {
  return (req, res, next) => {
    const resourceUserId = req.params[resourceUserIdField] || req.params.id;

    if (req.user && req.user.id !== resourceUserId && req.user.type !== 'admin') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'You can only access your own resources',
        },
      });
    }

    next();
  };
};

/**
 * Tenant isolation middleware
 * Ensures users can only access data from their tenant
 */
const tenantIsolation = (req, res, next) => {
  if (!req.user?.tenantId) {
    return next();
  }

  // Add tenant filter to all queries
  req.tenantId = req.user.tenantId;
  next();
};

/**
 * API Key authentication for service-to-service calls
 */
const apiKeyAuth = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'API key required',
      },
    });
  }

  // In production, validate against stored API keys
  const validApiKeys = (process.env.API_KEYS || '').split(',');

  if (!validApiKeys.includes(apiKey)) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid API key',
      },
    });
  }

  req.isServiceCall = true;
  next();
};

module.exports = {
  generateToken,
  verifyToken,
  authenticate,
  optionalAuth,
  authorize,
  verifyOwnership,
  tenantIsolation,
  apiKeyAuth,
};
