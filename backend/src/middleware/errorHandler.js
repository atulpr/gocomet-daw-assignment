const { AppError, ValidationError } = require('../utils/errors');

/**
 * Global error handler middleware
 */
const errorHandler = (err, req, res, next) => {
  // Log error
  console.error('Error:', {
    message: err.message,
    code: err.code,
    statusCode: err.statusCode,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    path: req.path,
    method: req.method,
  });

  // Handle known operational errors
  if (err instanceof AppError) {
    const response = {
      success: false,
      error: {
        code: err.code,
        message: err.message,
      },
    };

    // Add validation errors if present
    if (err instanceof ValidationError && err.errors.length > 0) {
      response.error.details = err.errors;
    }

    // Add resource info for NotFoundError
    if (err.resource) {
      response.error.resource = err.resource;
    }

    return res.status(err.statusCode).json(response);
  }

  // Handle Zod validation errors
  if (err.name === 'ZodError') {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: err.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      },
    });
  }

  // Handle PostgreSQL errors
  if (err.code) {
    // Unique constraint violation
    if (err.code === '23505') {
      return res.status(409).json({
        success: false,
        error: {
          code: 'DUPLICATE_ENTRY',
          message: 'A record with this value already exists',
        },
      });
    }

    // Foreign key violation
    if (err.code === '23503') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'FOREIGN_KEY_VIOLATION',
          message: 'Referenced record does not exist',
        },
      });
    }

    // Check constraint violation
    if (err.code === '23514') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'CHECK_VIOLATION',
          message: 'Value does not meet constraints',
        },
      });
    }
  }

  // Handle unknown errors
  const statusCode = err.statusCode || 500;
  const message =
    process.env.NODE_ENV === 'development'
      ? err.message
      : 'An unexpected error occurred';

  res.status(statusCode).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message,
    },
  });
};

/**
 * Async handler wrapper to catch errors
 */
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Not found handler for undefined routes
 */
const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Cannot ${req.method} ${req.path}`,
    },
  });
};

module.exports = {
  errorHandler,
  asyncHandler,
  notFoundHandler,
};
