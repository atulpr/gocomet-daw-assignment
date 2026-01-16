# Low-Level Design (LLD) - GoComet Ride Hailing System

## 1. Database Schema

**Note**: Database uses raw SQL with `pg` driver. Migrations are in `backend/src/db/migrate.js`.

### 1.1 Entity Relationship Diagram

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│   TENANTS   │       │   RIDERS    │       │   DRIVERS   │
├─────────────┤       ├─────────────┤       ├─────────────┤
│ id (PK)     │◄──────│ tenant_id   │       │ tenant_id   │──────►│
│ name        │       │ id (PK)     │       │ id (PK)     │
│ region      │       │ phone       │       │ phone       │
│ created_at  │       │ name        │       │ name        │
└─────────────┘       │ email       │       │ vehicle_no  │
                      └──────┬──────┘       │ vehicle_type│
                             │              │ status      │
                             │              │ rating      │
                             │              └──────┬──────┘
                             │                     │
                      ┌──────▼─────────────────────▼──────┐
                      │              RIDES                 │
                      ├───────────────────────────────────┤
                      │ id (PK)                           │
                      │ tenant_id (FK)                    │
                      │ rider_id (FK)                     │
                      │ driver_id (FK)                    │
                      │ status                            │
                      │ pickup_lat, pickup_lng            │
                      │ dropoff_lat, dropoff_lng          │
                      │ tier, payment_method              │
                      │ surge_multiplier                  │
                      │ estimated_fare                    │
                      │ version (optimistic lock)         │
                      └───────────────┬───────────────────┘
                                      │
                      ┌───────────────▼───────────────────┐
                      │              TRIPS                 │
                      ├───────────────────────────────────┤
                      │ id (PK)                           │
                      │ ride_id (FK)                      │
                      │ started_at, ended_at              │
                      │ actual_distance_km                │
                      │ actual_duration_mins              │
                      │ base_fare, distance_fare          │
                      │ time_fare, surge_fare, taxes      │
                      │ total_fare                        │
                      │ status                            │
                      └───────────────┬───────────────────┘
                                      │
                      ┌───────────────▼───────────────────┐
                      │            PAYMENTS                │
                      ├───────────────────────────────────┤
                      │ id (PK)                           │
                      │ trip_id (FK)                      │
                      │ amount, currency                  │
                      │ payment_method                    │
                      │ status                            │
                      │ psp_reference                     │
                      │ idempotency_key (UNIQUE)          │
                      └───────────────────────────────────┘
```

### 1.2 Key Indexes

```sql
-- Active rides lookup (partial index)
CREATE INDEX idx_rides_active 
ON rides(driver_id, status) 
WHERE status IN ('MATCHING', 'DRIVER_ASSIGNED', 'IN_PROGRESS');

-- Driver availability lookup
CREATE INDEX idx_drivers_tenant_status ON drivers(tenant_id, status);

-- Payment idempotency
CREATE INDEX idx_payments_idempotency ON payments(idempotency_key);
```

## 2. Authentication Flow

### 2.1 Phone + OTP Authentication

```
1. User enters phone number → POST /v1/auth/send-otp
   - Validates phone format (10 digits for India)
   - Generates 6-digit OTP
   - Stores OTP in Redis with 5-minute expiry
   - Returns OTP in development mode for testing

2. User enters OTP → POST /v1/auth/verify-otp
   - Validates OTP against Redis
   - Creates user if doesn't exist (rider/driver)
   - Generates JWT token with user info
   - Returns token and user profile

3. Subsequent requests use JWT token in Authorization header
   - Token contains: userId, userType, tenantId, phone
   - Frontend stores token in localStorage (separate keys for rider/driver)
```

**Demo OTP**: In development, use `123456` for any phone number.

### 2.2 Multi-Session Support

Frontend supports simultaneous rider and driver sessions:
- Rider session: `localStorage.getItem('gocomet_auth_rider')`
- Driver session: `localStorage.getItem('gocomet_auth_driver')`
- Allows testing both sides in same browser

## 3. API Specifications

### 3.1 Authentication Endpoints

```
POST /v1/auth/send-otp
Request: { "phone": "+919876543210", "user_type": "rider" }
Response: { "success": true, "data": { "message": "OTP sent", "otp": "123456" } }

POST /v1/auth/verify-otp
Request: { "phone": "+919876543210", "otp": "123456", "user_type": "rider", "tenant_id": "uuid" }
Response: { "success": true, "data": { "token": "jwt...", "user": {...} } }
```

### 3.2 Create Ride Request

```
POST /v1/rides
Headers:
  Content-Type: application/json
  Idempotency-Key: <unique-key>

Request Body:
{
  "tenant_id": "uuid",
  "rider_id": "uuid",
  "pickup_lat": 12.9716,
  "pickup_lng": 77.5946,
  "pickup_address": "MG Road, Bangalore",
  "dropoff_lat": 12.9352,
  "dropoff_lng": 77.6245,
  "dropoff_address": "Koramangala, Bangalore",
  "tier": "economy",
  "payment_method": "cash"
}

Response (201):
{
  "success": true,
  "data": {
    "id": "ride-uuid",
    "status": "REQUESTED",
    "estimated_fare": 170,
    "estimated_distance_km": 5.2,
    "surge_multiplier": 1.0
  }
}
```

### 3.3 Accept Ride (Driver)

```
POST /v1/drivers/:id/accept
Request Body:
{
  "ride_id": "uuid"
}

Response (200):
{
  "success": true,
  "data": {
    "id": "ride-uuid",
    "status": "DRIVER_ASSIGNED",
    "rider_name": "Rahul",
    "pickup_lat": 12.9716,
    "pickup_lng": 77.5946
  }
}

Error Response (409 - Race Condition):
{
  "success": false,
  "error": {
    "code": "CONFLICT",
    "message": "Ride has already been assigned to another driver"
  }
}
```

### 3.4 End Trip

```
POST /v1/trips/:id/end
Request Body:
{
  "actual_distance_km": 5.5,
  "actual_duration_mins": 22
}

Response (200):
{
  "success": true,
  "data": {
    "trip_id": "uuid",
    "status": "COMPLETED",
    "fare": {
      "baseFare": 50,
      "distanceFare": 66,
      "timeFare": 33,
      "surgeFare": 0,
      "taxes": 7.45,
      "total": 156.45
    }
  }
}
```

## 4. WebSocket Events

### 4.1 Client → Server Events

```javascript
// Register user on connection
socket.emit('register', { userId: 'uuid', userType: 'rider' | 'driver' })

// Subscribe to ride updates
socket.emit('subscribe:ride', { rideId: 'uuid' })

// Driver location update (replaces HTTP API)
socket.emit('driver:location', {
  rideId: 'uuid',
  latitude: 12.9716,
  longitude: 77.5946,
  heading: 45,
  speed: 40,
  accuracy: 10,
  phase: 'TO_PICKUP' | 'TO_DROPOFF'
})
```

### 4.2 Server → Client Events

```javascript
// Ride offer (driver)
socket.on('ride:offer', (data) => {
  // { offer_id, ride_id, expires_at, pickup, dropoff, fare, ... }
})

// Driver assigned (rider)
socket.on('ride:driver_assigned', (data) => {
  // { ride_id, driver_id, driver_name, vehicle_number, rating }
})

// Driver location update (rider)
socket.on('driver:location:update', (data) => {
  // { driverId, latitude, longitude, heading, distance, eta_minutes, phase }
})

// Trip started
socket.on('trip:started', (data) => {
  // { ride_id, trip_id }
})

// Payment completed
socket.on('payment:completed', (data) => {
  // { trip_id, amount }
})
```

## 5. State Machine Diagrams

### 5.1 Ride Status Flow

```
                    ┌──────────────┐
                    │   REQUESTED  │
                    └──────┬───────┘
                           │ findDrivers()
                           ▼
                    ┌──────────────┐
          ┌────────│   MATCHING   │────────┐
          │        └──────┬───────┘        │
          │               │ driverAccepts()│ timeout/noDrivers
          │               ▼                │
          │        ┌──────────────┐        │
          │        │DRIVER_ASSIGNED│       │
          │        └──────┬───────┘        │
          │               │ startNavigation()
          │               ▼                │
          │        ┌──────────────┐        │
          │        │DRIVER_EN_ROUTE│       │
          │        └──────┬───────┘        │
          │               │ arrivedAtPickup()
          │               ▼                │
          │        ┌──────────────┐        │
          │        │DRIVER_ARRIVED │       │
          │        └──────┬───────┘        │
          │               │ startTrip()    │
          │               ▼                │
          │        ┌──────────────┐        │
          │        │  IN_PROGRESS  │       │
          │        └──────┬───────┘        │
          │               │ endTrip()      │
          │               ▼                │
          │        ┌──────────────┐        │
          └───────►│  COMPLETED   │◄───────┘
                   └──────────────┘
                          │
       (any state)        │
          │               │
          ▼               │
   ┌──────────────┐       │
   │  CANCELLED   │◄──────┘
   └──────────────┘
```

### 5.2 Trip Status Flow

```
   startTrip()        IN_PROGRESS        endTrip()
       │                  │                  │
       ▼                  ▼                  ▼
  ┌─────────┐       ┌───────────┐      ┌───────────┐
  │ STARTED │──────►│IN_PROGRESS│─────►│ COMPLETED │
  └─────────┘       └───────────┘      └─────┬─────┘
                                             │
                                    dispute()│
                                             ▼
                                       ┌───────────┐
                                       │ DISPUTED  │
                                       └───────────┘
```

## 6. Sequence Diagrams

### 6.1 Ride Booking Flow

```
Rider          API           RideService    MatchingEngine    Redis         Kafka        Driver
  │             │                │               │              │             │            │
  │ POST /rides │                │               │              │             │            │
  │────────────►│                │               │              │             │            │
  │             │ createRide()   │               │              │             │            │
  │             │───────────────►│               │              │             │            │
  │             │                │               │              │             │            │
  │             │                │ INSERT ride   │              │             │            │
  │             │                │──────────────►│              │             │            │
  │             │                │               │              │             │            │
  │             │                │ findDrivers() │              │             │            │
  │             │                │──────────────►│              │             │            │
  │             │                │               │ GEORADIUS    │             │            │
  │             │                │               │─────────────►│             │            │
  │             │                │               │◄─────────────│             │            │
  │             │                │               │              │             │            │
  │             │                │               │ Score & Rank │             │            │
  │             │                │               │──────────────│             │            │
  │             │                │               │              │             │            │
  │             │                │               │ Publish offers             │            │
  │             │                │               │─────────────────────────►│            │
  │             │                │               │              │             │ Notify     │
  │             │                │               │              │             │───────────►│
  │◄────────────│                │               │              │             │            │
  │ 201 Created │                │               │              │             │            │
```

### 6.2 Driver Accept Flow (with Locking)

```
Driver         API           MatchingService    Redlock        PostgreSQL      Rider
  │             │                  │               │               │             │
  │ POST /accept│                  │               │               │             │
  │────────────►│                  │               │               │             │
  │             │ acceptRide()     │               │               │             │
  │             │─────────────────►│               │               │             │
  │             │                  │ ACQUIRE LOCK  │               │             │
  │             │                  │──────────────►│               │             │
  │             │                  │◄──────────────│               │             │
  │             │                  │               │               │             │
  │             │                  │ BEGIN TRANSACTION             │             │
  │             │                  │──────────────────────────────►│             │
  │             │                  │               │               │             │
  │             │                  │ SELECT ride FOR UPDATE        │             │
  │             │                  │──────────────────────────────►│             │
  │             │                  │               │               │             │
  │             │                  │ Check status == MATCHING      │             │
  │             │                  │               │               │             │
  │             │                  │ UPDATE ride SET driver_id     │             │
  │             │                  │──────────────────────────────►│             │
  │             │                  │               │               │             │
  │             │                  │ UPDATE driver SET status=busy │             │
  │             │                  │──────────────────────────────►│             │
  │             │                  │               │               │             │
  │             │                  │ COMMIT        │               │             │
  │             │                  │──────────────────────────────►│             │
  │             │                  │               │               │             │
  │             │                  │ RELEASE LOCK  │               │             │
  │             │                  │──────────────►│               │             │
  │             │                  │               │               │             │
  │             │                  │ Notify Rider  │               │             │
  │             │                  │───────────────────────────────────────────►│
  │◄────────────│                  │               │               │             │
  │ 200 OK      │                  │               │               │             │
```

## 7. Class Diagrams

### 5.1 Service Layer Classes

```
┌─────────────────────────────────────────┐
│            RideService                   │
├─────────────────────────────────────────┤
│ + createRide(data): Ride                │
│ + getRideById(id): Ride                 │
│ + updateRideStatus(id, status): Ride    │
│ + assignDriver(rideId, driverId): Ride  │
│ + cancelRide(id, reason): Ride          │
├─────────────────────────────────────────┤
│ - calculateDistance(): number           │
│ - calculateEstimatedFare(): number      │
│ - getSurgeMultiplier(): number          │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│          MatchingService                 │
├─────────────────────────────────────────┤
│ + findDriversForRide(rideId): Driver[]  │
│ + acceptRide(rideId, driverId): Ride    │
│ + declineRide(rideId, driverId): void   │
│ + getDriverCurrentRide(driverId): Ride  │
├─────────────────────────────────────────┤
│ - scoreDrivers(drivers): ScoredDriver[] │
│ - createRideOffer(rideId, driverId)     │
│ - expirePendingOffers(): void           │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│           TripService                    │
├─────────────────────────────────────────┤
│ + startTrip(rideId): Trip               │
│ + endTrip(tripId, data): Trip           │
│ + getTripById(id): Trip                 │
│ + calculateFare(tier, dist, dur): Fare  │
├─────────────────────────────────────────┤
│ - updateRideStatusForTrip(): void       │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│          PaymentService                  │
├─────────────────────────────────────────┤
│ + processPayment(tripId, method): Pay   │
│ + getPaymentByTripId(tripId): Payment   │
│ + retryPayment(paymentId): Payment      │
│ + initiateRefund(paymentId): Payment    │
├─────────────────────────────────────────┤
│ - processCashPayment(): PaymentResult   │
│ - processCardPayment(): PaymentResult   │
│ - checkIdempotencyKey(): Payment|null   │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│          LockingService                  │
├─────────────────────────────────────────┤
│ + acquireLock(resource, ttl): Lock      │
│ + releaseLock(lock): void               │
│ + extendLock(lock, ttl): Lock           │
│ + withLock(resource, fn): any           │
│ + isLocked(resource): boolean           │
└─────────────────────────────────────────┘
```

## 8. Error Handling

### 8.1 Error Classes Hierarchy

```
AppError (base)
├── BadRequestError (400)
├── ValidationError (400)
├── UnauthorizedError (401)
├── ForbiddenError (403)
├── NotFoundError (404)
├── ConflictError (409)
├── IdempotencyError (409)
├── TooManyRequestsError (429)
├── InvalidStateTransitionError (400)
├── LockAcquisitionError (409)
├── InternalError (500)
└── ServiceUnavailableError (503)
```

### 8.2 Error Response Format

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      {
        "field": "pickup_lat",
        "message": "Latitude must be between -90 and 90"
      }
    ]
  }
}
```

## 9. Caching Strategy

### 9.1 Cache Key Patterns

| Pattern | Purpose | TTL |
|---------|---------|-----|
| `ride:{id}` | Ride details | 60s |
| `driver:{id}` | Driver details | 300s |
| `driver:status:{id}` | Driver availability | 30s |
| `drivers:online:{tier}` | GeoSpatial index | No TTL |
| `surge:{region}:{tier}` | Surge multiplier | 60s |
| `idempotency:{key}` | Request deduplication | 24h |
| `lock:{resource}` | Distributed lock | 5s |

### 9.2 Cache Invalidation

```javascript
// Write-through: Update cache after DB write
await db.query('UPDATE rides SET status = $1 WHERE id = $2', [status, id]);
await redis.del(`ride:${id}`);

// Event-driven: Kafka consumer updates cache
kafkaConsumer.on('ride-status-changed', async (event) => {
  await redis.del(`ride:${event.rideId}`);
});
```

## 10. Concurrency Control

### 10.1 Optimistic Locking

```sql
-- Add version column
ALTER TABLE rides ADD COLUMN version INTEGER DEFAULT 1;

-- Update with version check
UPDATE rides 
SET status = $1, version = version + 1 
WHERE id = $2 AND version = $3
RETURNING *;

-- If rowCount = 0, concurrent modification detected
```

### 10.2 Distributed Locking (Redlock)

```javascript
const lock = await redlock.acquire([`lock:driver:${driverId}`], 5000);
try {
  // Critical section - only one process can execute
  await assignDriverToRide(rideId, driverId);
} finally {
  await lock.release();
}
```

## 11. Driver Simulation Service

### 11.1 Overview
Backend simulates driver movement during active rides to provide real-time location updates:
- **TO_PICKUP**: Driver moves towards pickup location
- **TO_DROPOFF**: Driver moves towards dropoff location
- Updates sent via WebSocket every 1-2 seconds
- Calculates distance and ETA in real-time

### 11.2 Implementation
```javascript
// Start simulation when driver accepts ride
startDriverSimulation(rideId, driverId, riderId, pickupLat, pickupLng, dropoffLat, dropoffLng, vehicleType)

// Switch phase when trip starts
switchToTripPhase(rideId, driverId, riderId)

// Stop when trip ends
stopDriverSimulation(rideId)
```

## 12. Performance Optimizations

### 12.1 Database Optimizations
- Connection pooling (20 connections per instance)
- Prepared statements for frequent queries
- Partial indexes for active records only
- EXPLAIN ANALYZE for slow query identification

### 12.2 Redis Optimizations
- Pipeline commands for batch operations
- Lua scripts for atomic multi-key operations
- TTL on all cache keys to prevent memory bloat

### 12.3 Kafka Optimizations
- Partition by region for locality
- Batch consumers for high-throughput
- Compression for network efficiency
