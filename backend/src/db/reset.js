require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://gocomet:gocomet123@localhost:5432/ridehailing',
});

const resetDatabase = async () => {
  const client = await pool.connect();
  
  try {
    console.log('Resetting database...');
    
    // Drop all tables in correct order (respecting foreign keys)
    const dropTables = `
      DROP TABLE IF EXISTS driver_locations CASCADE;
      DROP TABLE IF EXISTS ride_offers CASCADE;
      DROP TABLE IF EXISTS payments CASCADE;
      DROP TABLE IF EXISTS trips CASCADE;
      DROP TABLE IF EXISTS rides CASCADE;
      DROP TABLE IF EXISTS drivers CASCADE;
      DROP TABLE IF EXISTS riders CASCADE;
      DROP TABLE IF EXISTS tenants CASCADE;
    `;
    
    await client.query(dropTables);
    console.log('✅ All tables dropped');
    
    console.log('Run "npm run db:migrate" to recreate tables');
    console.log('Run "npm run db:seed" to add test data');
    
  } catch (error) {
    console.error('❌ Reset failed:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
};

resetDatabase();
