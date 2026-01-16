'use strict'

/**
 * New Relic agent configuration.
 *
 * See lib/config/default.js in the agent distribution for a more complete
 * description of configuration variables and their potential values.
 */
exports.config = {
  /**
   * Array of application names.
   */
  app_name: [process.env.NEW_RELIC_APP_NAME || 'GoComet-RideHailing'],

  /**
   * Your New Relic license key.
   */
  license_key: process.env.NEW_RELIC_LICENSE_KEY || 'your_license_key_here',

  /**
   * This setting controls distributed tracing.
   * Distributed tracing lets you see the path that a request takes through your
   * distributed system. Enabling distributed tracing changes the behavior of some
   * New Relic features, so carefully consult the transition guide before you enable
   * this feature: https://docs.newrelic.com/docs/transition-guide-distributed-tracing
   */
  distributed_tracing: {
    enabled: true,
  },

  logging: {
    /**
     * Level at which to log. 'trace' is most useful to New Relic when diagnosing
     * issues with the agent, 'info' and higher will impose the least overhead on
     * production applications.
     */
    level: process.env.NODE_ENV === 'development' ? 'trace' : 'info',
    filepath: 'stdout', // Log to stdout so we can see it in Docker logs
  },

  /**
   * When true, all request headers except for those listed in attributes.exclude
   * will be captured for all traces, unless otherwise specified in a destination's
   * attributes include/exclude lists.
   */
  allow_all_headers: true,

  attributes: {
    /**
     * Prefix of attributes to exclude from all destinations. Allows * as wildcard
     * at end.
     *
     * NOTE: If excluding headers, they must be in camelCase form to be filtered.
     */
    exclude: [
      'request.headers.cookie',
      'request.headers.authorization',
      'request.headers.proxyAuthorization',
      'request.headers.setCookie*',
      'request.headers.x*',
      'response.headers.cookie',
      'response.headers.authorization',
      'response.headers.proxyAuthorization',
      'response.headers.setCookie*',
      'response.headers.x*',
    ],
  },

  /**
   * Transaction tracer captures deep information about slow transactions and
   * sends this to the New Relic service once a minute.
   */
  transaction_tracer: {
    enabled: true,
    transaction_threshold: 'apdex_f',
    record_sql: 'obfuscated',
    explain_threshold: 500,
  },

  /**
   * Error collector - captures errors that occur in your application.
   */
  error_collector: {
    enabled: true,
    ignore_status_codes: [404],
  },

  /**
   * Slow SQL - captures slow database queries.
   */
  slow_sql: {
    enabled: true,
    max_samples: 10,
  },

  /**
   * Application logging configuration
   */
  application_logging: {
    enabled: true,
    forwarding: {
      enabled: true,
      max_samples_stored: 10000,
    },
    metrics: {
      enabled: true,
    },
    local_decorating: {
      enabled: false,
    },
  },

  /**
   * Custom instrumentation for our specific endpoints
   */
  rules: {
    name: [
      // Group ride endpoints
      { pattern: '/v1/rides/*', name: '/v1/rides/:id' },
      // Group driver endpoints
      { pattern: '/v1/drivers/*/location', name: '/v1/drivers/:id/location' },
      { pattern: '/v1/drivers/*/accept', name: '/v1/drivers/:id/accept' },
      { pattern: '/v1/drivers/*', name: '/v1/drivers/:id' },
      // Group trip endpoints
      { pattern: '/v1/trips/*/end', name: '/v1/trips/:id/end' },
      { pattern: '/v1/trips/*', name: '/v1/trips/:id' },
    ],
  },
}
