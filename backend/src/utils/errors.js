/**
 * Custom error classes for the API
 */

class AppError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    
    Error.captureStackTrace(this, this.constructor);
  }
}

class BadRequestError extends AppError {
  constructor(message = 'Bad Request', code = 'BAD_REQUEST') {
    super(message, 400, code);
  }
}

class ValidationError extends AppError {
  constructor(message = 'Validation Error', errors = []) {
    super(message, 400, 'VALIDATION_ERROR');
    this.errors = errors;
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
  }
}

class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
    this.resource = resource;
  }
}

class ConflictError extends AppError {
  constructor(message = 'Conflict') {
    super(message, 409, 'CONFLICT');
  }
}

class IdempotencyError extends AppError {
  constructor(message = 'Duplicate request') {
    super(message, 409, 'IDEMPOTENCY_CONFLICT');
  }
}

class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests') {
    super(message, 429, 'RATE_LIMITED');
  }
}

class InternalError extends AppError {
  constructor(message = 'Internal Server Error') {
    super(message, 500, 'INTERNAL_ERROR');
    this.isOperational = false;
  }
}

class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable') {
    super(message, 503, 'SERVICE_UNAVAILABLE');
  }
}

// State transition errors
class InvalidStateTransitionError extends AppError {
  constructor(currentState, targetState, entity = 'Entity') {
    super(
      `Cannot transition ${entity} from ${currentState} to ${targetState}`,
      400,
      'INVALID_STATE_TRANSITION'
    );
    this.currentState = currentState;
    this.targetState = targetState;
  }
}

// Lock acquisition errors
class LockAcquisitionError extends AppError {
  constructor(resource) {
    super(`Could not acquire lock for ${resource}`, 409, 'LOCK_FAILED');
    this.resource = resource;
  }
}

module.exports = {
  AppError,
  BadRequestError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  IdempotencyError,
  TooManyRequestsError,
  InternalError,
  ServiceUnavailableError,
  InvalidStateTransitionError,
  LockAcquisitionError,
};
