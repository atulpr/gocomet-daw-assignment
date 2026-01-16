require('dotenv').config();
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://gocomet:gocomet123@localhost:5432/ridehailing',
});

const seedData = async () => {
  const client = await pool.connect();
  
  try {
    console.log('Seeding database...');
    
    await client.query('BEGIN');
    
    // Create tenants
    const tenants = [
      { id: uuidv4(), name: 'GoComet Bangalore', region: 'bangalore' },
      { id: uuidv4(), name: 'GoComet Mumbai', region: 'mumbai' },
      { id: uuidv4(), name: 'GoComet Delhi', region: 'delhi' },
    ];
    
    for (const tenant of tenants) {
      await client.query(
        'INSERT INTO tenants (id, name, region) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [tenant.id, tenant.name, tenant.region]
      );
    }
    console.log(`Created ${tenants.length} tenants`);
    
    // Create riders for first tenant (Bangalore)
    const tenantId = tenants[0].id;
    const riders = [
      { phone: '+919876543210', name: 'Rahul Kumar', email: 'rahul@example.com' },
      { phone: '+919876543211', name: 'Priya Sharma', email: 'priya@example.com' },
      { phone: '+919876543212', name: 'Amit Patel', email: 'amit@example.com' },
      { phone: '+919876543213', name: 'Sneha Reddy', email: 'sneha@example.com' },
      { phone: '+919876543214', name: 'Vikram Singh', email: 'vikram@example.com' },
    ];
    
    const riderIds = [];
    for (const rider of riders) {
      const id = uuidv4();
      riderIds.push(id);
      await client.query(
        `INSERT INTO riders (id, tenant_id, phone, name, email) 
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (phone) DO NOTHING`,
        [id, tenantId, rider.phone, rider.name, rider.email]
      );
    }
    console.log(`Created ${riders.length} riders`);
    
    // Create drivers for first tenant (Bangalore)
    // Locations around Bangalore city center (12.9716° N, 77.5946° E)
    const drivers = [
      { 
        phone: '+919900000001', 
        name: 'Raju Driver', 
        vehicle_number: 'KA01AB1234',
        vehicle_type: 'economy',
        status: 'online',
        rating: 4.8
      },
      { 
        phone: '+919900000002', 
        name: 'Suresh Kumar', 
        vehicle_number: 'KA01CD5678',
        vehicle_type: 'economy',
        status: 'online',
        rating: 4.5
      },
      { 
        phone: '+919900000003', 
        name: 'Mohammed Ali', 
        vehicle_number: 'KA01EF9012',
        vehicle_type: 'premium',
        status: 'online',
        rating: 4.9
      },
      { 
        phone: '+919900000004', 
        name: 'Venkat Rao', 
        vehicle_number: 'KA01GH3456',
        vehicle_type: 'economy',
        status: 'offline',
        rating: 4.3
      },
      { 
        phone: '+919900000005', 
        name: 'Prakash Shetty', 
        vehicle_number: 'KA01IJ7890',
        vehicle_type: 'xl',
        status: 'online',
        rating: 4.7
      },
      { 
        phone: '+919900000006', 
        name: 'Ganesh Nayak', 
        vehicle_number: 'KA01KL1234',
        vehicle_type: 'economy',
        status: 'online',
        rating: 4.6
      },
      { 
        phone: '+919900000007', 
        name: 'Kiran Hegde', 
        vehicle_number: 'KA01MN5678',
        vehicle_type: 'premium',
        status: 'busy',
        rating: 4.8
      },
      { 
        phone: '+919900000008', 
        name: 'Ashok Gowda', 
        vehicle_number: 'KA01OP9012',
        vehicle_type: 'economy',
        status: 'online',
        rating: 4.4
      },
      { 
        phone: '+919900000009', 
        name: 'Ramesh Babu', 
        vehicle_number: 'KA01QR3456',
        vehicle_type: 'xl',
        status: 'online',
        rating: 4.5
      },
      { 
        phone: '+919900000010', 
        name: 'Santosh Yadav', 
        vehicle_number: 'KA01ST7890',
        vehicle_type: 'economy',
        status: 'online',
        rating: 4.7
      },
    ];
    
    const driverIds = [];
    // Random locations around Bangalore for drivers
    const driverLocations = [
      { lat: 12.9352, lng: 77.6245 },  // Koramangala
      { lat: 12.9698, lng: 77.7500 },  // Whitefield
      { lat: 12.9716, lng: 77.5946 },  // MG Road
      { lat: 13.0358, lng: 77.5970 },  // Hebbal
      { lat: 12.9279, lng: 77.6271 },  // HSR Layout
      { lat: 12.9141, lng: 77.6411 },  // BTM Layout
      { lat: 12.9783, lng: 77.6408 },  // Indiranagar
      { lat: 12.9568, lng: 77.7011 },  // Marathahalli
      { lat: 12.8456, lng: 77.6603 },  // Electronic City
      { lat: 13.0206, lng: 77.6400 },  // Nagavara
    ];

    for (let i = 0; i < drivers.length; i++) {
      const driver = drivers[i];
      const id = uuidv4();
      const location = driverLocations[i % driverLocations.length];
      driverIds.push({ id, ...driver, ...location });
      await client.query(
        `INSERT INTO drivers (id, tenant_id, phone, name, vehicle_number, vehicle_type, status, rating) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (phone) DO NOTHING`,
        [id, tenantId, driver.phone, driver.name, driver.vehicle_number, driver.vehicle_type, driver.status, driver.rating]
      );
    }
    console.log(`Created ${drivers.length} drivers`);
    
    await client.query('COMMIT');

    // Add online drivers to Redis GeoSpatial index
    console.log('Adding driver locations to Redis...');
    try {
      const Redis = require('ioredis');
      const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
      
      for (const driver of driverIds) {
        if (driver.status === 'online') {
          const geoKey = `drivers:geo:${driver.vehicle_type}`;
          await redis.geoadd(geoKey, driver.lng, driver.lat, driver.id);
          console.log(`  Added ${driver.name} to ${geoKey}`);
        }
      }
      
      await redis.quit();
      console.log('✅ Driver locations added to Redis');
    } catch (redisError) {
      console.log('⚠️ Could not add to Redis (may not be running):', redisError.message);
    }
    
    console.log('✅ Database seeded successfully');
    console.log('\nTest data summary:');
    console.log(`  Tenant ID (Bangalore): ${tenantId}`);
    console.log(`  Riders: ${riders.length}`);
    console.log(`  Drivers: ${drivers.length} (${drivers.filter(d => d.status === 'online').length} online)`);
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Seeding failed:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
};

seedData();
