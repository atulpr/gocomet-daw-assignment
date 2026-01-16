/**
 * Additional security middleware
 */

/**
 * Request sanitization middleware
 * Removes potentially dangerous characters from inputs
 */
const sanitizeInput = (req, res, next) => {
  const sanitize = (obj) => {
    if (typeof obj === 'string') {
      // Remove null bytes and other control characters
      return obj.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    }
    if (Array.isArray(obj)) {
      return obj.map(sanitize);
    }
    if (obj && typeof obj === 'object') {
      const sanitized = {};
      for (const [key, value] of Object.entries(obj)) {
        // Skip prototype pollution attempts
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
          continue;
        }
        sanitized[key] = sanitize(value);
      }
      return sanitized;
    }
    return obj;
  };

  if (req.body) {
    req.body = sanitize(req.body);
  }
  if (req.query) {
    req.query = sanitize(req.query);
  }
  if (req.params) {
    req.params = sanitize(req.params);
  }

  next();
};

/**
 * Request ID middleware
 * Adds unique request ID for tracing
 */
const requestId = (req, res, next) => {
  const id = req.headers['x-request-id'] || 
    `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  req.requestId = id;
  res.set('X-Request-Id', id);
  next();
};

/**
 * Security headers middleware (supplements Helmet)
 */
const securityHeaders = (req, res, next) => {
  // Prevent clickjacking
  res.set('X-Frame-Options', 'DENY');
  
  // Prevent MIME type sniffing
  res.set('X-Content-Type-Options', 'nosniff');
  
  // XSS Protection
  res.set('X-XSS-Protection', '1; mode=block');
  
  // Referrer Policy
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Remove powered-by header
  res.removeHeader('X-Powered-By');
  
  next();
};

/**
 * Request size limiter
 * Prevents large payload attacks
 */
const requestSizeLimit = (maxSizeKb = 100) => {
  return (req, res, next) => {
    const contentLength = parseInt(req.headers['content-length'] || '0');
    const maxBytes = maxSizeKb * 1024;

    if (contentLength > maxBytes) {
      return res.status(413).json({
        success: false,
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: `Request body exceeds ${maxSizeKb}KB limit`,
        },
      });
    }

    next();
  };
};

/**
 * SQL injection prevention check
 * Additional layer beyond parameterized queries
 */
const sqlInjectionCheck = (req, res, next) => {
  const sqlPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER)\b)/i,
    /(--|#|\/\*|\*\/)/,
    /(\bOR\b\s*\d+\s*=\s*\d+)/i,
    /(\bAND\b\s*\d+\s*=\s*\d+)/i,
  ];

  const checkValue = (value) => {
    if (typeof value !== 'string') return false;
    return sqlPatterns.some(pattern => pattern.test(value));
  };

  const checkObject = (obj) => {
    if (!obj) return false;
    for (const value of Object.values(obj)) {
      if (typeof value === 'object') {
        if (checkObject(value)) return true;
      } else if (checkValue(value)) {
        return true;
      }
    }
    return false;
  };

  // Only check query params and body (not paths which may contain UUIDs)
  if (checkObject(req.query) || checkObject(req.body)) {
    console.warn('Potential SQL injection attempt detected:', {
      ip: req.ip,
      path: req.path,
      requestId: req.requestId,
    });

    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_INPUT',
        message: 'Request contains invalid characters',
      },
    });
  }

  next();
};

/**
 * CORS configuration helper
 */
const getCorsOptions = () => {
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3001')
    .split(',')
    .map(origin => origin.trim());

  return {
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, Postman, etc.)
      if (!origin) return callback(null, true);
      
      if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Request-Id',
      'X-Api-Key',
      'Idempotency-Key',
    ],
    exposedHeaders: [
      'X-Request-Id',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
    ],
    maxAge: 86400, // 24 hours
  };
};

/**
 * Log suspicious activity
 */
const logSuspiciousActivity = (req, reason) => {
  console.warn('Suspicious activity detected:', {
    reason,
    ip: req.ip,
    path: req.path,
    method: req.method,
    userAgent: req.headers['user-agent'],
    requestId: req.requestId,
    userId: req.user?.id,
    timestamp: new Date().toISOString(),
  });
};

module.exports = {
  sanitizeInput,
  requestId,
  securityHeaders,
  requestSizeLimit,
  sqlInjectionCheck,
  getCorsOptions,
  logSuspiciousActivity,
};
