const { Pool } = require('pg');

// Optimized connection pool configuration
const poolConfig = {
  connectionString: process.env.DATABASE_URL || 'postgresql://gocomet:gocomet123@localhost:5432/ridehailing',
  
  // Pool sizing - optimized for high concurrency
  max: parseInt(process.env.DB_POOL_MAX) || 50,        // Max connections
  min: parseInt(process.env.DB_POOL_MIN) || 10,        // Min connections (warm pool)
  
  // Timeouts
  idleTimeoutMillis: 30000,           // Close idle connections after 30s
  connectionTimeoutMillis: 3000,      // Fail if connection takes > 3s
  
  // Statement caching (reduces parse time)
  statement_timeout: 10000,           // 10s max query time
  query_timeout: 10000,
  
  // Keep connections alive
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
};

// Primary pool for writes
const pool = new Pool(poolConfig);

// Read replica pool (for read-heavy operations)
// In production, this would point to a read replica
const readPool = new Pool({
  ...poolConfig,
  connectionString: process.env.DATABASE_READ_URL || poolConfig.connectionString,
  max: parseInt(process.env.DB_READ_POOL_MAX) || 30,
});

// Pool metrics
let queryCount = 0;
let slowQueryCount = 0;
const SLOW_QUERY_THRESHOLD_MS = 50;

// Log pool errors
pool.on('error', (err) => {
  console.error('Primary pool error:', err);
});

readPool.on('error', (err) => {
  console.error('Read pool error:', err);
});

// Pool health check
pool.on('connect', () => {
  // Connection established
});

/**
 * Connect to the database and verify connection
 */
const connectDatabase = async () => {
  try {
    const client = await pool.connect();
    await client.query('SELECT NOW()');
    client.release();
    console.log('✅ Database connected successfully');
    
    // Warm up the read pool too
    const readClient = await readPool.connect();
    readClient.release();
    console.log('✅ Read replica pool ready');
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    throw error;
  }
};

/**
 * Disconnect from the database
 */
const disconnectDatabase = async () => {
  try {
    await pool.end();
    await readPool.end();
    console.log('Database disconnected');
  } catch (error) {
    console.error('Error disconnecting database:', error.message);
  }
};

/**
 * Execute a query with optional parameters (primary pool - for writes)
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise} Query result
 */
const query = async (text, params = []) => {
  const startTime = process.hrtime.bigint();
  queryCount++;
  
  try {
    const result = await pool.query(text, params);
    const duration = Number(process.hrtime.bigint() - startTime) / 1_000_000;
    
    // Log slow queries
    if (duration > SLOW_QUERY_THRESHOLD_MS) {
      slowQueryCount++;
      console.warn(`⚠️ Slow query (${duration.toFixed(2)}ms):`, text.substring(0, 100));
    }
    
    return result;
  } catch (error) {
    console.error('Query error:', error.message);
    throw error;
  }
};

/**
 * Execute a read-only query (uses read replica pool)
 * Use this for SELECT queries that don't need latest data
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise} Query result
 */
const queryRead = async (text, params = []) => {
  const startTime = process.hrtime.bigint();
  
  try {
    const result = await readPool.query(text, params);
    const duration = Number(process.hrtime.bigint() - startTime) / 1_000_000;
    
    if (duration > SLOW_QUERY_THRESHOLD_MS) {
      console.warn(`⚠️ Slow read query (${duration.toFixed(2)}ms):`, text.substring(0, 100));
    }
    
    return result;
  } catch (error) {
    console.error('Read query error:', error.message);
    throw error;
  }
};

/**
 * Execute multiple queries in a batch (reduces round trips)
 * @param {Array<{text: string, params: Array}>} queries - Array of queries
 * @returns {Promise<Array>} Array of results
 */
const queryBatch = async (queries) => {
  const client = await pool.connect();
  const results = [];
  
  try {
    for (const q of queries) {
      results.push(await client.query(q.text, q.params || []));
    }
    return results;
  } finally {
    client.release();
  }
};

/**
 * Get a client from the pool for transactions
 * @returns {Promise} Pool client
 */
const getClient = async () => {
  return pool.connect();
};

/**
 * Execute a database transaction with automatic retry on serialization failure
 * @param {Function} callback - Transaction callback function (receives client)
 * @param {Object} options - Transaction options
 * @returns {Promise} Transaction result
 */
const executeTransaction = async (callback, options = {}) => {
  const { 
    isolationLevel = 'READ COMMITTED',
    maxRetries = 3,
    retryDelay = 100
  } = options;
  
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const client = await pool.connect();
    
    try {
      await client.query(`BEGIN ISOLATION LEVEL ${isolationLevel}`);
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      lastError = error;
      
      // Retry on serialization failure or deadlock
      const isRetryable = error.code === '40001' || error.code === '40P01';
      if (isRetryable && attempt < maxRetries) {
        console.warn(`Transaction retry ${attempt}/${maxRetries}:`, error.message);
        await new Promise(r => setTimeout(r, retryDelay * attempt));
        continue;
      }
      
      throw error;
    } finally {
      client.release();
    }
  }
  
  throw lastError;
};

/**
 * Execute query with row-level locking (SELECT ... FOR UPDATE)
 * Use SKIP LOCKED for non-blocking concurrent access
 * @param {object} client - Pool client from transaction
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @param {Object} options - Lock options
 * @returns {Promise} Query result
 */
const queryForUpdate = async (client, text, params = [], options = {}) => {
  const { skipLocked = false, noWait = false } = options;
  
  let lockClause = 'FOR UPDATE';
  if (skipLocked) lockClause += ' SKIP LOCKED';
  else if (noWait) lockClause += ' NOWAIT';
  
  const lockQuery = text.includes('FOR UPDATE') ? text : `${text} ${lockClause}`;
  return client.query(lockQuery, params);
};

/**
 * Get pool statistics for monitoring
 */
const getPoolStats = () => ({
  primary: {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
  },
  read: {
    totalCount: readPool.totalCount,
    idleCount: readPool.idleCount,
    waitingCount: readPool.waitingCount,
  },
  queries: {
    total: queryCount,
    slow: slowQueryCount,
  },
});

module.exports = {
  pool,
  readPool,
  query,
  queryRead,
  queryBatch,
  getClient,
  connectDatabase,
  disconnectDatabase,
  executeTransaction,
  queryForUpdate,
  getPoolStats,
};
