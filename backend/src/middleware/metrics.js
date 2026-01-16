/**
 * Custom metrics middleware for New Relic
 * Records custom metrics for monitoring and alerting
 */

let newrelic = null;

try {
  // Only load New Relic if license key is provided
  if (process.env.NEW_RELIC_LICENSE_KEY) {
    newrelic = require('newrelic');
    console.log('✅ New Relic agent loaded');
  }
} catch (error) {
  console.warn('New Relic not available:', error.message);
}

/**
 * Record a custom metric
 * @param {string} name - Metric name
 * @param {number} value - Metric value
 */
const recordMetric = (name, value) => {
  if (newrelic) {
    newrelic.recordMetric(`Custom/${name}`, value);
  }
};

/**
 * Record custom event
 * @param {string} eventType - Event type
 * @param {Object} attributes - Event attributes
 */
const recordCustomEvent = (eventType, attributes) => {
  if (newrelic) {
    newrelic.recordCustomEvent(eventType, attributes);
  }
};

/**
 * Add custom attribute to current transaction
 * @param {string} name - Attribute name
 * @param {any} value - Attribute value
 */
const addCustomAttribute = (name, value) => {
  if (newrelic) {
    newrelic.addCustomAttribute(name, value);
  }
};

/**
 * Start a custom segment for detailed tracing
 * @param {string} name - Segment name
 * @param {Function} callback - Function to execute
 */
const startSegment = async (name, callback) => {
  if (newrelic) {
    return newrelic.startSegment(name, true, callback);
  }
  return callback();
};

/**
 * Notice an error
 * @param {Error} error - Error object
 * @param {Object} customAttributes - Custom attributes
 */
const noticeError = (error, customAttributes = {}) => {
  if (newrelic) {
    newrelic.noticeError(error, customAttributes);
  }
};

/**
 * Middleware to track API response times
 */
const apiMetricsMiddleware = (req, res, next) => {
  const startTime = Date.now();

  // Add request ID for tracing
  const requestId = req.headers['x-request-id'] || `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  req.requestId = requestId;
  addCustomAttribute('requestId', requestId);

  // Track response
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const endpoint = `${req.method} ${req.route?.path || req.path}`;

    // Record response time metric
    recordMetric(`API/ResponseTime/${endpoint}`, duration);

    // Record status code metric
    recordMetric(`API/StatusCode/${res.statusCode}`, 1);

    // Log slow requests
    if (duration > 1000) {
      console.warn(`Slow request: ${endpoint} took ${duration}ms`);
      recordCustomEvent('SlowRequest', {
        endpoint,
        duration,
        statusCode: res.statusCode,
        requestId,
      });
    }

    // Record custom event for API call
    recordCustomEvent('APICall', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration,
      requestId,
    });
  });

  next();
};

/**
 * Record matching metrics
 */
const recordMatchingMetrics = (data) => {
  recordCustomEvent('DriverMatching', {
    rideId: data.rideId,
    driversFound: data.driversFound,
    matchingDuration: data.duration,
    tier: data.tier,
  });

  recordMetric('Matching/DriversFound', data.driversFound);
  recordMetric('Matching/Duration', data.duration);
};

/**
 * Record ride lifecycle metrics
 */
const recordRideMetrics = (data) => {
  recordCustomEvent('RideLifecycle', {
    rideId: data.rideId,
    status: data.status,
    duration: data.duration,
    tier: data.tier,
  });

  recordMetric(`Ride/Status/${data.status}`, 1);
};

/**
 * Record payment metrics
 */
const recordPaymentMetrics = (data) => {
  recordCustomEvent('Payment', {
    tripId: data.tripId,
    amount: data.amount,
    method: data.method,
    status: data.status,
    duration: data.duration,
  });

  recordMetric(`Payment/${data.status}`, data.amount);
};

module.exports = {
  recordMetric,
  recordCustomEvent,
  addCustomAttribute,
  startSegment,
  noticeError,
  apiMetricsMiddleware,
  recordMatchingMetrics,
  recordRideMetrics,
  recordPaymentMetrics,
};
