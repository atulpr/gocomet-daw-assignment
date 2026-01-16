// Load New Relic first (if configured)
if (process.env.NEW_RELIC_LICENSE_KEY) {
  try {
    require('newrelic');
    console.log('✅ New Relic agent initialized');
  } catch (error) {
    console.warn('⚠️ New Relic failed to load:', error.message);
  }
} else {
  console.log('ℹ️ New Relic not configured (NEW_RELIC_LICENSE_KEY not set)');
}

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const http = require('http');

const { connectDatabase, disconnectDatabase } = require('./config/database');
const { connectRedis, disconnectRedis } = require('./config/redis');
const { connectKafka, disconnectKafka } = require('./config/kafka');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { sanitizeInput, requestId, securityHeaders, getCorsOptions } = require('./middleware/security');
const { ipRateLimiter } = require('./middleware/rateLimiter');
const { apiMetricsMiddleware } = require('./middleware/metrics');
const routes = require('./routes');
const { initializeSocketServer, startNotificationConsumer } = require('./services/notificationService');
const { startLocationConsumer, stopLocationConsumer } = require('./consumers/locationConsumer');

const app = express();
const server = http.createServer(app);

// Trust proxy (for rate limiting behind load balancer)
app.set('trust proxy', 1);

// Security middleware (order matters!)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(securityHeaders);
app.use(requestId);
app.use(cors(getCorsOptions()));

// Body parsing with size limits
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// Input sanitization
app.use(sanitizeInput);

// Request logging
app.use(morgan(':method :url :status :res[content-length] - :response-time ms [:req[x-request-id]]'));

// New Relic metrics middleware (tracks API calls, response times, errors)
app.use(apiMetricsMiddleware);

// Global rate limiting (100 requests per minute per IP)
app.use(ipRateLimiter(60000, 100));

// Health check endpoint (no rate limit)
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    requestId: req.requestId,
  });
});

// New Relic test endpoint
app.get('/test/newrelic', (req, res) => {
  let newrelic = null;
  try {
    newrelic = require('newrelic');
  } catch (e) {
    return res.json({ error: 'New Relic not available', message: e.message });
  }

  // Record a test custom metric
  newrelic.recordMetric('Custom/Test/Metric', 1);
  newrelic.recordCustomEvent('TestEvent', {
    test: true,
    timestamp: Date.now(),
  });

  res.json({
    status: 'success',
    newrelic: {
      agent: newrelic.agent ? 'loaded' : 'not loaded',
      app_name: newrelic.agent?.config?.app_name,
      license_key_set: !!process.env.NEW_RELIC_LICENSE_KEY,
      license_key_length: process.env.NEW_RELIC_LICENSE_KEY?.length || 0,
    },
    message: 'Test metric and event recorded. Check New Relic dashboard in 1-2 minutes.',
  });
});

// API routes
app.use('/v1', routes);

// API info
app.get('/', (req, res) => {
  res.json({
    message: 'GoComet Ride Hailing API',
    version: '1.0.0',
    docs: '/v1',
    health: '/health',
  });
});

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

const PORT = process.env.PORT || 3000;

// Graceful shutdown
const shutdown = async (signal) => {
  console.log(`\n${signal} received. Starting graceful shutdown...`);
  
  server.close(async () => {
    console.log('HTTP server closed');
    
    await stopLocationConsumer();
    await disconnectDatabase();
    await disconnectRedis();
    await disconnectKafka();
    
    console.log('All connections closed. Exiting.');
    process.exit(0);
  });
  
  // Force exit after 10 seconds
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start server
const startServer = async () => {
  try {
    // Connect to all services
    await connectDatabase();
    await connectRedis();
    await connectKafka();
    
    // Initialize WebSocket server
    initializeSocketServer(server);
    
    // Start Kafka consumers
    await startNotificationConsumer();
    await startLocationConsumer();
    
    server.listen(PORT, () => {
      console.log(`\n🚀 Server running on port ${PORT}`);
      console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`💚 Health check: http://localhost:${PORT}/health`);
      console.log(`📡 API base: http://localhost:${PORT}/v1`);
      console.log(`🔌 WebSocket: ws://localhost:${PORT}`);
      console.log(`🔒 Security: Helmet, CORS, Rate Limiting enabled\n`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

module.exports = { app, server };
