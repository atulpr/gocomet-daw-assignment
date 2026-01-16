const { Server } = require('socket.io');
const { createConsumer, TOPICS, publishLocationUpdate } = require('../config/kafka');
const { addDriverLocation, getRedisClient } = require('../config/redis');
const { queryRead } = require('../config/database');

let io = null;
const connectedClients = new Map(); // userId -> Set of socket IDs

/**
 * Initialize WebSocket server
 */
const initializeSocketServer = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:3001',
      methods: ['GET', 'POST'],
    },
    pingInterval: 25000,
    pingTimeout: 60000,
  });

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // Handle user authentication/registration
    socket.on('register', ({ userId, userType }) => {
      if (!userId) return;

      // Store socket mapping
      if (!connectedClients.has(userId)) {
        connectedClients.set(userId, new Set());
      }
      connectedClients.get(userId).add(socket.id);

      // Join user-specific room
      socket.join(`user:${userId}`);
      socket.join(`type:${userType}`); // 'rider' or 'driver'

      socket.userId = userId;
      socket.userType = userType;

      console.log(`User ${userId} (${userType}) registered on socket ${socket.id}`);
      
      socket.emit('registered', { userId, socketId: socket.id });
    });

    // Handle ride subscription
    socket.on('subscribe:ride', ({ rideId }) => {
      socket.join(`ride:${rideId}`);
      console.log(`Socket ${socket.id} subscribed to ride ${rideId}`);
    });

    socket.on('unsubscribe:ride', ({ rideId }) => {
      socket.leave(`ride:${rideId}`);
    });

    // Handle driver location update (WebSocket-based, replaces HTTP API)
    socket.on('driver:location:update', async (data) => {
      if (socket.userType !== 'driver' || !socket.userId) return;

      const { latitude, longitude, heading, speed, accuracy } = data;
      const driverId = socket.userId;

      try {
        // Get driver status from Redis cache (fast path)
        const redis = getRedisClient();
        const statusKey = `driver:status:${driverId}`;
        let driverInfo = await redis.hgetall(statusKey);
        
        // If not in cache, fetch from DB and cache
        if (!driverInfo || !driverInfo.status) {
          const result = await queryRead(
            'SELECT id, status, vehicle_type, tenant_id FROM drivers WHERE id = $1',
            [driverId]
          );
          
          if (result.rows.length === 0) {
            console.warn(`Driver ${driverId} not found for location update`);
            return;
          }
          
          driverInfo = result.rows[0];
          
          // Cache driver info
          await redis.hmset(statusKey, {
            status: driverInfo.status,
            vehicle_type: driverInfo.vehicle_type,
            tenant_id: driverInfo.tenant_id,
          });
          await redis.expire(statusKey, 300); // 5 min TTL
        }

        // Update Redis geo-index if driver is online (for matching)
        if (driverInfo.status === 'online') {
          await addDriverLocation(driverInfo.vehicle_type, driverId, longitude, latitude);
        }

        // Publish to Kafka (async, fire and forget)
        publishLocationUpdate(driverId, driverInfo.tenant_id, {
          latitude,
          longitude,
          heading: heading || null,
          speed: speed || null,
          vehicle_type: driverInfo.vehicle_type,
          status: driverInfo.status,
        }).catch(err => console.error('Kafka publish failed:', err.message));

        // Broadcast to ride room if driver has active ride (for rider tracking)
        if (data.rideId) {
          io.to(`ride:${data.rideId}`).emit('driver:location:update', {
            driverId,
            latitude,
            longitude,
            heading,
            timestamp: Date.now(),
          });
        }

        // Acknowledge receipt
        socket.emit('driver:location:ack', { timestamp: Date.now() });
      } catch (error) {
        console.error('Error processing location update:', error.message);
        socket.emit('driver:location:error', { message: error.message });
      }
    });

    // Handle driver location broadcast (legacy, for backward compatibility)
    socket.on('driver:location', (data) => {
      if (socket.userType !== 'driver') return;

      // Broadcast to the ride room
      if (data.rideId) {
        io.to(`ride:${data.rideId}`).emit('driver:location:update', {
          driverId: socket.userId,
          latitude: data.latitude,
          longitude: data.longitude,
          heading: data.heading,
          timestamp: Date.now(),
        });
      }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);

      if (socket.userId) {
        const userSockets = connectedClients.get(socket.userId);
        if (userSockets) {
          userSockets.delete(socket.id);
          if (userSockets.size === 0) {
            connectedClients.delete(socket.userId);
          }
        }
      }
    });
  });

  console.log('✅ WebSocket server initialized');
  return io;
};

/**
 * Send notification to a specific user
 */
const sendToUser = (userId, event, data) => {
  if (!io) {
    console.warn('Socket.io not initialized');
    return;
  }

  io.to(`user:${userId}`).emit(event, {
    ...data,
    timestamp: Date.now(),
  });
};

/**
 * Send notification to all users of a type
 */
const sendToUserType = (userType, event, data) => {
  if (!io) return;

  io.to(`type:${userType}`).emit(event, {
    ...data,
    timestamp: Date.now(),
  });
};

/**
 * Send notification to ride room
 */
const sendToRide = (rideId, event, data) => {
  if (!io) return;

  io.to(`ride:${rideId}`).emit(event, {
    ...data,
    timestamp: Date.now(),
  });
};

/**
 * Broadcast to all connected clients
 */
const broadcast = (event, data) => {
  if (!io) return;

  io.emit(event, {
    ...data,
    timestamp: Date.now(),
  });
};

/**
 * Start Kafka consumer for notifications
 */
const startNotificationConsumer = async () => {
  const consumer = await createConsumer(
    'notification-service',
    TOPICS.NOTIFICATIONS,
    handleNotification
  );

  if (consumer) {
    console.log('✅ Notification consumer started');
  }

  return consumer;
};

/**
 * Handle incoming notification from Kafka
 */
const handleNotification = async (message) => {
  const { userId, type, payload } = message;

  console.log(`Processing notification: ${type} for user ${userId}`);

  // Map notification types to socket events
  const eventMap = {
    RIDE_OFFER: 'ride:offer',
    DRIVER_ASSIGNED: 'ride:driver_assigned',
    RIDE_DRIVER_EN_ROUTE: 'ride:driver_en_route',
    RIDE_DRIVER_ARRIVED: 'ride:driver_arrived',
    DRIVER_LOCATION: 'driver:location:update',  // Real-time driver location
    TRIP_STARTED: 'trip:started',
    TRIP_COMPLETED: 'trip:completed',
    PAYMENT_COMPLETED: 'payment:completed',
    PAYMENT_RECEIVED: 'payment:received',
  };

  const event = eventMap[type] || `notification:${type.toLowerCase()}`;
  
  sendToUser(userId, event, payload);

  // Also broadcast to ride room if ride_id is present
  if (payload.ride_id) {
    sendToRide(payload.ride_id, event, payload);
  }
};

/**
 * Get connection statistics
 */
const getStats = () => {
  return {
    totalConnections: io ? io.sockets.sockets.size : 0,
    uniqueUsers: connectedClients.size,
    users: Array.from(connectedClients.entries()).map(([userId, sockets]) => ({
      userId,
      connections: sockets.size,
    })),
  };
};

/**
 * Check if user is online
 */
const isUserOnline = (userId) => {
  return connectedClients.has(userId) && connectedClients.get(userId).size > 0;
};

module.exports = {
  initializeSocketServer,
  sendToUser,
  sendToUserType,
  sendToRide,
  broadcast,
  startNotificationConsumer,
  getStats,
  isUserOnline,
};
