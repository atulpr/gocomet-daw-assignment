const { z } = require('zod');
const { ValidationError } = require('../utils/errors');

/**
 * Validation schemas for API requests
 */

// Common schemas
const uuidSchema = z.string().uuid('Invalid UUID format');

const coordinateSchema = z.number().refine(
  (val) => val >= -180 && val <= 180,
  'Coordinate must be between -180 and 180'
);

const latitudeSchema = z.number().refine(
  (val) => val >= -90 && val <= 90,
  'Latitude must be between -90 and 90'
);

const longitudeSchema = z.number().refine(
  (val) => val >= -180 && val <= 180,
  'Longitude must be between -180 and 180'
);

// Ride schemas
const createRideSchema = z.object({
  tenant_id: uuidSchema,
  rider_id: uuidSchema,
  pickup_lat: latitudeSchema,
  pickup_lng: longitudeSchema,
  pickup_address: z.string().optional(),
  dropoff_lat: latitudeSchema,
  dropoff_lng: longitudeSchema,
  dropoff_address: z.string().optional(),
  tier: z.enum(['economy', 'premium', 'xl']).default('economy'),
  payment_method: z.enum(['cash', 'card', 'wallet']).default('cash'),
});

const getRideParamsSchema = z.object({
  id: uuidSchema,
});

// Driver schemas
const updateLocationSchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  heading: z.number().min(0).max(360).optional(),
  speed: z.number().min(0).optional(),
  accuracy: z.number().min(0).optional(),
});

const driverParamsSchema = z.object({
  id: uuidSchema,
});

const acceptRideSchema = z.object({
  ride_id: uuidSchema,
});

// Trip schemas
const tripParamsSchema = z.object({
  id: uuidSchema,
});

const endTripSchema = z.object({
  actual_distance_km: z.number().positive().optional(),
  actual_duration_mins: z.number().int().positive().optional(),
  route_polyline: z.string().optional(),
});

// Payment schemas
const createPaymentSchema = z.object({
  trip_id: uuidSchema,
  payment_method: z.enum(['cash', 'card', 'wallet']),
  idempotency_key: z.string().min(1).max(255),
});

/**
 * Validation middleware factory
 * @param {z.ZodSchema} schema - Zod schema to validate against
 * @param {string} source - Request property to validate ('body', 'params', 'query')
 */
const validate = (schema, source = 'body') => {
  return (req, res, next) => {
    try {
      const data = req[source];
      const result = schema.parse(data);
      req[source] = result; // Replace with parsed/transformed data
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errors = error.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        }));
        next(new ValidationError('Validation failed', errors));
      } else {
        next(error);
      }
    }
  };
};

/**
 * Validate multiple sources
 * @param {Object} schemas - Object with schema for each source
 */
const validateMultiple = (schemas) => {
  return (req, res, next) => {
    const allErrors = [];

    for (const [source, schema] of Object.entries(schemas)) {
      try {
        const data = req[source];
        const result = schema.parse(data);
        req[source] = result;
      } catch (error) {
        if (error instanceof z.ZodError) {
          const errors = error.errors.map((e) => ({
            field: `${source}.${e.path.join('.')}`,
            message: e.message,
          }));
          allErrors.push(...errors);
        } else {
          return next(error);
        }
      }
    }

    if (allErrors.length > 0) {
      return next(new ValidationError('Validation failed', allErrors));
    }

    next();
  };
};

module.exports = {
  // Schemas
  schemas: {
    createRide: createRideSchema,
    getRideParams: getRideParamsSchema,
    updateLocation: updateLocationSchema,
    driverParams: driverParamsSchema,
    acceptRide: acceptRideSchema,
    tripParams: tripParamsSchema,
    endTrip: endTripSchema,
    createPayment: createPaymentSchema,
  },
  // Middleware
  validate,
  validateMultiple,
  // Common schemas for reuse
  uuidSchema,
  latitudeSchema,
  longitudeSchema,
};
