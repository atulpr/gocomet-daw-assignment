require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://gocomet:gocomet123@localhost:5432/ridehailing',
});

const migration = `
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tenants table (multi-tenant support)
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    region VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Riders table
CREATE TABLE IF NOT EXISTS riders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    phone VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(255),
    email VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_riders_tenant ON riders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_riders_phone ON riders(phone);

-- Drivers table
CREATE TABLE IF NOT EXISTS drivers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    phone VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(255),
    email VARCHAR(255),
    vehicle_number VARCHAR(20),
    vehicle_type VARCHAR(50), -- economy, premium, xl
    status VARCHAR(20) DEFAULT 'offline', -- online, offline, busy
    rating DECIMAL(3,2) DEFAULT 5.0,
    total_rides INTEGER DEFAULT 0,
    acceptance_rate DECIMAL(5,2) DEFAULT 100.0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_drivers_tenant ON drivers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_drivers_status ON drivers(status);
CREATE INDEX IF NOT EXISTS idx_drivers_tenant_status ON drivers(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_drivers_vehicle_type ON drivers(vehicle_type);

-- Rides table
CREATE TABLE IF NOT EXISTS rides (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    rider_id UUID NOT NULL REFERENCES riders(id),
    driver_id UUID REFERENCES drivers(id),
    
    -- Status tracking
    status VARCHAR(30) NOT NULL DEFAULT 'REQUESTED',
    -- REQUESTED, MATCHING, DRIVER_ASSIGNED, DRIVER_EN_ROUTE, 
    -- DRIVER_ARRIVED, IN_PROGRESS, COMPLETED, CANCELLED
    
    -- Location details
    pickup_lat DECIMAL(10,8) NOT NULL,
    pickup_lng DECIMAL(11,8) NOT NULL,
    pickup_address TEXT,
    dropoff_lat DECIMAL(10,8) NOT NULL,
    dropoff_lng DECIMAL(11,8) NOT NULL,
    dropoff_address TEXT,
    
    -- Ride configuration
    tier VARCHAR(20) NOT NULL DEFAULT 'economy', -- economy, premium, xl
    payment_method VARCHAR(20) DEFAULT 'cash', -- cash, card, wallet
    
    -- Pricing
    surge_multiplier DECIMAL(3,2) DEFAULT 1.0,
    estimated_fare DECIMAL(10,2),
    estimated_distance_km DECIMAL(10,2),
    estimated_duration_mins INTEGER,
    
    -- Optimistic locking
    version INTEGER DEFAULT 1,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    matched_at TIMESTAMP,
    cancelled_at TIMESTAMP,
    cancellation_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_rides_tenant ON rides(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rides_rider ON rides(rider_id);
CREATE INDEX IF NOT EXISTS idx_rides_driver ON rides(driver_id);
CREATE INDEX IF NOT EXISTS idx_rides_status ON rides(status);
CREATE INDEX IF NOT EXISTS idx_rides_tenant_status ON rides(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_rides_created_at ON rides(created_at DESC);

-- Active rides index (partial index for performance)
CREATE INDEX IF NOT EXISTS idx_rides_active 
ON rides(driver_id, status) 
WHERE status IN ('MATCHING', 'DRIVER_ASSIGNED', 'DRIVER_EN_ROUTE', 'DRIVER_ARRIVED', 'IN_PROGRESS');

-- Trips table (completed ride details)
CREATE TABLE IF NOT EXISTS trips (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
    
    -- Trip details
    started_at TIMESTAMP,
    ended_at TIMESTAMP,
    
    -- Route tracking
    actual_distance_km DECIMAL(10,2),
    actual_duration_mins INTEGER,
    route_polyline TEXT, -- Encoded polyline of actual route
    
    -- Fare breakdown
    base_fare DECIMAL(10,2),
    distance_fare DECIMAL(10,2),
    time_fare DECIMAL(10,2),
    surge_fare DECIMAL(10,2),
    taxes DECIMAL(10,2),
    total_fare DECIMAL(10,2),
    
    -- Status
    status VARCHAR(30) DEFAULT 'STARTED',
    -- STARTED, IN_PROGRESS, COMPLETED, DISPUTED
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trips_ride ON trips(ride_id);
CREATE INDEX IF NOT EXISTS idx_trips_status ON trips(status);

-- Payments table
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trip_id UUID NOT NULL REFERENCES trips(id),
    
    -- Payment details
    amount DECIMAL(10,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'INR',
    payment_method VARCHAR(20) NOT NULL, -- cash, card, wallet
    
    -- Status
    status VARCHAR(20) DEFAULT 'pending',
    -- pending, processing, completed, failed, refunded
    
    -- External PSP reference
    psp_reference VARCHAR(255),
    psp_response JSONB,
    
    -- Idempotency
    idempotency_key VARCHAR(255) UNIQUE,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payments_trip ON payments(trip_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_idempotency ON payments(idempotency_key);

-- Driver location history (for analytics, not real-time)
CREATE TABLE IF NOT EXISTS driver_locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    latitude DECIMAL(10,8) NOT NULL,
    longitude DECIMAL(11,8) NOT NULL,
    heading DECIMAL(5,2), -- Direction in degrees
    speed DECIMAL(6,2),   -- Speed in km/h
    accuracy DECIMAL(6,2), -- GPS accuracy in meters
    recorded_at TIMESTAMP DEFAULT NOW()
);

-- Partition by time for better query performance
CREATE INDEX IF NOT EXISTS idx_driver_locations_driver ON driver_locations(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_locations_recorded ON driver_locations(recorded_at DESC);

-- Ride offers table (track offers sent to drivers)
CREATE TABLE IF NOT EXISTS ride_offers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
    driver_id UUID NOT NULL REFERENCES drivers(id),
    
    -- Offer status
    status VARCHAR(20) DEFAULT 'pending',
    -- pending, accepted, declined, expired, cancelled
    
    -- Timestamps
    offered_at TIMESTAMP DEFAULT NOW(),
    responded_at TIMESTAMP,
    expires_at TIMESTAMP,
    
    -- Response details
    decline_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_ride_offers_ride ON ride_offers(ride_id);
CREATE INDEX IF NOT EXISTS idx_ride_offers_driver ON ride_offers(driver_id);
CREATE INDEX IF NOT EXISTS idx_ride_offers_status ON ride_offers(status);

-- =============================================
-- PERFORMANCE OPTIMIZATION INDEXES
-- =============================================

-- Composite index for driver current ride lookup (most critical query)
CREATE INDEX IF NOT EXISTS idx_rides_driver_status_updated 
ON rides(driver_id, status, updated_at DESC);

-- Composite index for rider current ride lookup
CREATE INDEX IF NOT EXISTS idx_rides_rider_status_created 
ON rides(rider_id, status, created_at DESC);

-- Pending offers with expiry for driver matching
CREATE INDEX IF NOT EXISTS idx_ride_offers_pending_expiry 
ON ride_offers(driver_id, status, expires_at) 
WHERE status = 'pending';

-- Payment lookup by trip with status
CREATE INDEX IF NOT EXISTS idx_payments_trip_status 
ON payments(trip_id, status);

-- Driver lookup by type and status for matching
CREATE INDEX IF NOT EXISTS idx_drivers_type_status_rating 
ON drivers(vehicle_type, status, rating DESC) 
WHERE status = 'online';

-- Trip lookup with ride join optimization
CREATE INDEX IF NOT EXISTS idx_trips_ride_status 
ON trips(ride_id, status);

-- Covering index for ride details (avoids table lookups)
CREATE INDEX IF NOT EXISTS idx_rides_covering 
ON rides(id) INCLUDE (tenant_id, rider_id, driver_id, status, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, tier, estimated_fare);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers to all tables with updated_at
DO $$
DECLARE
    t text;
BEGIN
    FOR t IN 
        SELECT table_name 
        FROM information_schema.columns 
        WHERE column_name = 'updated_at' 
        AND table_schema = 'public'
    LOOP
        EXECUTE format('
            DROP TRIGGER IF EXISTS update_%I_updated_at ON %I;
            CREATE TRIGGER update_%I_updated_at
                BEFORE UPDATE ON %I
                FOR EACH ROW
                EXECUTE FUNCTION update_updated_at_column();
        ', t, t, t, t);
    END LOOP;
END;
$$ language 'plpgsql';

-- Print success message
SELECT 'Migration completed successfully' as status;
`;

const runMigration = async () => {
  const client = await pool.connect();
  
  try {
    console.log('Running database migration...');
    await client.query(migration);
    console.log('✅ Migration completed successfully');
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
};

runMigration();
