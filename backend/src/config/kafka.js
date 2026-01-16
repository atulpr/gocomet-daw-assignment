const { Kafka, logLevel } = require('kafkajs');

let kafka = null;
let producer = null;
let consumer = null;

// Kafka topics
const TOPICS = {
  LOCATION_UPDATES: 'location-updates',
  RIDE_EVENTS: 'ride-events',
  NOTIFICATIONS: 'notifications',
};

/**
 * Get Kafka instance
 */
const getKafka = () => {
  if (!kafka) {
    throw new Error('Kafka not connected. Call connectKafka() first.');
  }
  return kafka;
};

/**
 * Get Kafka producer
 */
const getProducer = () => {
  if (!producer) {
    throw new Error('Kafka producer not connected.');
  }
  return producer;
};

/**
 * Connect to Kafka
 */
const connectKafka = async () => {
  try {
    const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
    
    kafka = new Kafka({
      clientId: process.env.KAFKA_CLIENT_ID || 'gocomet-ridehailing',
      brokers,
      logLevel: logLevel.ERROR,
      retry: {
        initialRetryTime: 100,
        retries: 3,
      },
    });

    // Initialize producer
    producer = kafka.producer({
      allowAutoTopicCreation: true,
      transactionTimeout: 30000,
    });

    await producer.connect();
    console.log('✅ Kafka producer connected successfully');
  } catch (error) {
    console.error('❌ Kafka connection failed:', error.message);
    // Don't throw - Kafka is optional for some operations
    console.warn('Continuing without Kafka...');
  }
};

/**
 * Disconnect from Kafka
 */
const disconnectKafka = async () => {
  try {
    if (producer) {
      await producer.disconnect();
      console.log('Kafka producer disconnected');
    }
    if (consumer) {
      await consumer.disconnect();
      console.log('Kafka consumer disconnected');
    }
  } catch (error) {
    console.error('Error disconnecting Kafka:', error.message);
  }
};

/**
 * Publish message to topic
 * @param {string} topic - Topic name
 * @param {string} key - Message key (for partitioning)
 * @param {Object} value - Message value
 */
const publishMessage = async (topic, key, value) => {
  if (!producer) {
    console.warn('Kafka producer not available, skipping message');
    return;
  }

  try {
    await producer.send({
      topic,
      messages: [
        {
          key,
          value: JSON.stringify(value),
          timestamp: Date.now().toString(),
        },
      ],
    });
  } catch (error) {
    console.error('Failed to publish message:', error.message);
    throw error;
  }
};

/**
 * Publish location update
 * @param {string} driverId - Driver ID
 * @param {string} regionId - Region ID for partitioning
 * @param {Object} location - Location data
 */
const publishLocationUpdate = async (driverId, regionId, location) => {
  await publishMessage(
    TOPICS.LOCATION_UPDATES,
    regionId, // Partition by region for locality
    {
      driverId,
      regionId,
      ...location,
      timestamp: Date.now(),
    }
  );
};

/**
 * Publish ride event
 * @param {string} rideId - Ride ID
 * @param {string} tenantId - Tenant ID for partitioning
 * @param {string} eventType - Event type
 * @param {Object} data - Event data
 */
const publishRideEvent = async (rideId, tenantId, eventType, data) => {
  await publishMessage(
    TOPICS.RIDE_EVENTS,
    tenantId, // Partition by tenant
    {
      rideId,
      tenantId,
      eventType,
      data,
      timestamp: Date.now(),
    }
  );
};

/**
 * Publish notification
 * @param {string} userId - User ID
 * @param {string} type - Notification type
 * @param {Object} payload - Notification payload
 */
const publishNotification = async (userId, type, payload) => {
  await publishMessage(
    TOPICS.NOTIFICATIONS,
    userId,
    {
      userId,
      type,
      payload,
      timestamp: Date.now(),
    }
  );
};

/**
 * Create consumer for a topic
 * @param {string} groupId - Consumer group ID
 * @param {string} topic - Topic to consume
 * @param {Function} handler - Message handler
 */
const createConsumer = async (groupId, topic, handler) => {
  if (!kafka) {
    console.warn('Kafka not available, skipping consumer creation');
    return null;
  }

  try {
    const consumerInstance = kafka.consumer({ groupId });
    await consumerInstance.connect();
    await consumerInstance.subscribe({ topic, fromBeginning: false });

    await consumerInstance.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          const value = JSON.parse(message.value.toString());
          await handler(value, { topic, partition, offset: message.offset });
        } catch (error) {
          console.error('Error processing message:', error.message);
        }
      },
    });

    console.log(`Consumer subscribed to ${topic}`);
    return consumerInstance;
  } catch (error) {
    console.error('Failed to create consumer:', error.message);
    return null;
  }
};

module.exports = {
  TOPICS,
  getKafka,
  getProducer,
  connectKafka,
  disconnectKafka,
  publishMessage,
  publishLocationUpdate,
  publishRideEvent,
  publishNotification,
  createConsumer,
};
