# GoComet DAW - Ride Hailing Application

A scalable, multi-tenant ride-hailing system designed to handle real-time driver location updates, driver-rider matching, trip lifecycle management, and payments.

## Features

- **Phone + OTP Authentication** - Secure login using phone number and one-time password
- **Real-time Driver Matching** - Match riders with nearby drivers within 1s (P95) using Redis GeoSpatial
- **WebSocket Location Updates** - Real-time driver location via WebSocket (replaces HTTP overhead)
- **Driver Simulation** - Backend simulates driver movement during active rides
- **Trip Management** - Complete trip lifecycle with fare calculation
- **Payment Processing** - Idempotent payment flow with PSP integration
- **Real-time Updates** - WebSocket-based live updates for riders and drivers
- **Multi-Session Support** - Test rider and driver simultaneously in same browser
- **Distributed Locking** - Redlock for preventing race conditions in driver assignment
- **New Relic Monitoring** - Comprehensive APM and custom metrics tracking
- **Multi-tenant Support** - Region-based tenant isolation

## Tech Stack

### Backend
- **Runtime**: Node.js with Express
- **Database**: PostgreSQL (raw SQL with `pg` driver)
- **Cache**: Redis (caching + GeoSpatial indexing)
- **Message Queue**: Apache Kafka
- **Monitoring**: New Relic APM

### Frontend
- **Framework**: Next.js 14 with TypeScript
- **Styling**: Tailwind CSS
- **Real-time**: Socket.io
- **Maps**: Leaflet

### Infrastructure
- **Containerization**: Docker & Docker Compose
- **All services run locally** via Docker

## Project Structure

```
gocomet-daw-assignment/
├── backend/
│   ├── src/
│   │   ├── config/           # Database, Redis, Kafka configs
│   │   ├── controllers/      # API route handlers
│   │   ├── services/         # Business logic
│   │   │   ├── rideService.js
│   │   │   ├── driverService.js
│   │   │   ├── matchingService.js
│   │   │   ├── tripService.js
│   │   │   ├── paymentService.js
│   │   │   ├── authService.js
│   │   │   ├── simulationService.js
│   │   │   ├── lockingService.js
│   │   │   ├── notificationService.js
│   │   │   └── cacheService.js
│   │   ├── middleware/       # Auth, validation, idempotency
│   │   ├── consumers/        # Kafka consumers
│   │   ├── routes/           # API routes
│   │   ├── db/               # Migrations and seeds
│   │   └── utils/            # Helper functions
│   ├── tests/                # Unit & integration tests
│   ├── newrelic.js           # New Relic configuration
│   └── package.json
├── frontend/
│   └── src/
│       ├── app/              # Next.js app router
│       │   ├── rider/        # Rider dashboard
│       │   └── driver/       # Driver dashboard
│       ├── components/       # React components
│       └── lib/              # API client, socket
├── docs/
│   ├── HLD.md                # High-level design
│   ├── LLD.md                # Low-level design
│   └── SETUP.md              # Setup instructions
├── docker-compose.yml
└── README.md
```

## Quick Start

### Prerequisites
- Docker Desktop (required)
- Node.js 18+ (for local development)
- npm or yarn

### Option 1: Docker Compose (Recommended)

```bash
# Clone the repository
git clone <repository-url>
cd gocomet-daw-assignment

# Start all services
docker-compose up -d

# Wait for services to be healthy (~30 seconds)
docker-compose ps

# Access the application
# Frontend: http://localhost:3001
# Backend API: http://localhost:3000
# Kafka UI: http://localhost:8080
```

### Option 2: Local Development

```bash
# 1. Start infrastructure only
docker-compose up -d postgres redis zookeeper kafka

# 2. Setup backend
cd backend
npm install
npm run db:migrate
npm run db:seed
npm run dev

# 3. In a new terminal, setup frontend
cd frontend
npm install
npm run dev

# Access:
# Frontend: http://localhost:3001
# Backend: http://localhost:3000
```

## API Endpoints

### Authentication
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/auth/send-otp` | POST | Send OTP to phone number |
| `/v1/auth/verify-otp` | POST | Verify OTP and login/register |
| `/v1/auth/tenants` | GET | Get available tenants |
| `/v1/auth/profile` | GET | Get current user profile |
| `/v1/auth/logout` | POST | Logout current session |

### Rides
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/rides` | POST | Create a ride request |
| `/v1/rides/:id` | GET | Get ride status |
| `/v1/rides/:id/cancel` | POST | Cancel a ride |
| `/v1/riders/:id/current-ride` | GET | Get rider's current active ride |

### Drivers
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/drivers/:id/accept` | POST | Accept ride assignment |
| `/v1/drivers/:id/decline` | POST | Decline ride offer |
| `/v1/drivers/:id/status` | PATCH | Update driver status (online/offline) |
| `/v1/drivers/:id/pending-offers` | GET | Get pending ride offers |
| `/v1/drivers/:id/current-ride` | GET | Get driver's current active ride |

### Trips & Payments
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/trips/start` | POST | Start a trip |
| `/v1/trips/:id/end` | POST | End trip and calculate fare |
| `/v1/payments` | POST | Process payment (idempotent) |

**Note**: Driver location updates are sent via WebSocket (`driver:location` event), not HTTP API.

## Architecture Highlights

### Scalability
- **Stateless API servers** - Horizontal scaling via load balancer
- **WebSocket connections** - Efficient real-time updates (replaces HTTP polling)
- **Kafka partitioning** - By region for parallel processing (200k loc/sec)
- **Redis GeoSpatial** - O(log N) driver lookups for 100k+ drivers
- **Connection pooling** - 20 connections per instance
- **Batch location writes** - PostgreSQL writes batched every 1 second

### Consistency
- **Distributed locking (Redlock)** - Prevents double-booking of drivers
- **Optimistic locking** - Version columns for concurrent ride updates
- **Database transactions** - SERIALIZABLE isolation for multi-table operations
- **Idempotency keys** - Safe retries for payments and ride creation

### Reliability
- **Write-through cache** - Immediate invalidation on writes
- **Event-driven** - Kafka for async processing, WebSocket for real-time
- **Driver simulation** - Backend handles movement simulation for demo/testing
- **Graceful degradation** - Works without Kafka/Redis (reduced features)
- **Idempotent operations** - Safe retries for payments and ride creation

## Demo Flow

### Authentication
- **Demo OTP**: Use `123456` for any phone number in development mode
- Phone number format: 10 digits (e.g., `9876543210`)
- Select tenant (city) before login

### As a Rider:
1. Go to http://localhost:3001/login?type=rider (or http://localhost:3001/rider)
2. Enter phone number and verify with OTP `123456`
3. Click on the map to set pickup location (green marker)
4. Click again to set dropoff location (red marker)
5. Select vehicle tier (Economy/Premium/XL) and payment method
6. Click "Request Ride"
7. Watch real-time status updates as driver accepts and approaches
8. See live driver location, distance, and ETA on map
9. After trip ends, complete payment and rate driver

### As a Driver:
1. Go to http://localhost:3001/login?type=driver (or http://localhost:3001/driver)
2. Enter phone number and verify with OTP `123456`
3. Click the power button to go "Online"
4. Wait for ride offers (polled every 5 seconds)
5. Accept a ride to see pickup/dropoff locations
6. Progress through: Navigate → Arrived → Start Trip → End Trip
7. Wait for payment after trip completion
8. View earnings in dashboard

### Multi-Session Testing
- Open two browser tabs: one for rider, one for driver
- Both can be logged in simultaneously (separate localStorage keys)
- Test complete ride flow end-to-end

## Monitoring

### New Relic Integration
1. Sign up for New Relic (100GB free tier)
2. Get your APM license key (40 characters)
3. Set `NEW_RELIC_LICENSE_KEY` in `docker-compose.yml` or `.env`
4. Restart API service: `docker-compose restart api`
5. View APM dashboard for:
   - API latency metrics (P95, P99)
   - Database query performance
   - Custom metrics (matching duration, payment success)
   - Error tracking and alerting

### Key Metrics Tracked
- `API/ResponseTime/*` - Per-endpoint latency (P95, P99)
- `API/StatusCode/*` - HTTP status code distribution
- `Matching/Duration` - Time to find and score drivers
- `Matching/DriversFound` - Available driver count per request
- `Payment/completed` - Successful payment amounts
- `Payment/failed` - Failed payment tracking
- `Ride/Status/*` - Ride state distribution
- `SlowRequest` - Requests exceeding 1s threshold

### Test New Relic
```bash
# Test endpoint to verify New Relic is working
curl http://localhost:3000/test/newrelic
```

## Testing

```bash
cd backend

# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

## Documentation

- [High-Level Design (HLD)](docs/HLD.md) - Architecture overview, key decisions
- [Low-Level Design (LLD)](docs/LLD.md) - Database schema, API specs, sequence diagrams
- [Setup Guide](docs/SETUP.md) - Detailed setup instructions

## Environment Variables

See `.env.example` for all available configuration options:

```bash
# Core
DATABASE_URL=postgresql://gocomet:gocomet123@localhost:5432/ridehailing
REDIS_URL=redis://localhost:6379
KAFKA_BROKERS=localhost:9092

# Server
PORT=3000
NODE_ENV=development

# New Relic (optional)
NEW_RELIC_LICENSE_KEY=your_key_here
NEW_RELIC_APP_NAME=GoComet-RideHailing

# Matching
MATCHING_RADIUS_KM=100  # Increased for demo purposes
MATCHING_TIMEOUT_MS=30000

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:3000
NEXT_PUBLIC_WS_URL=http://localhost:3000
```

## Troubleshooting

### Services not starting
```bash
# Check service logs
docker-compose logs -f api
docker-compose logs -f postgres

# Reset everything
docker-compose down -v
docker-compose up -d
```

### Database connection issues
```bash
# Ensure PostgreSQL is ready
docker-compose logs postgres | grep "ready to accept"

# Run migrations manually
cd backend && npm run db:migrate

# Seed database
cd backend && npm run db:seed
```

### Authentication issues
- **OTP not working**: Use demo OTP `123456` in development
- **Phone format**: Must be 10 digits (e.g., `9876543210`)
- **Session issues**: Clear browser localStorage if stuck

### WebSocket connection issues
```bash
# Check if WebSocket server is running
docker-compose logs api | grep "Socket"

# Verify frontend WebSocket URL
# Should be: http://localhost:3000 (same as API)
```

### Kafka issues
```bash
# Check Kafka UI at http://localhost:8080
# Verify topics are created

# Check Kafka logs
docker-compose logs kafka

# Verify Zookeeper is healthy first
docker-compose logs zookeeper
```

### New Relic not showing data
- Verify license key is correct (40 characters for APM)
- Check API logs for New Relic connection status
- Wait 1-2 minutes for data to appear in dashboard
- Test with: `curl http://localhost:3000/test/newrelic`

## License

MIT
