# GoComet DAW - Ride Hailing Application

A scalable, multi-tenant ride-hailing system designed to handle real-time driver location updates, driver-rider matching, trip lifecycle management, and payments.

## Features

- **Real-time Driver Matching** - Match riders with nearby drivers within 1s (P95)
- **Location Tracking** - Handle 200k+ location updates per second
- **Trip Management** - Complete trip lifecycle with fare calculation
- **Payment Processing** - Idempotent payment flow with PSP integration
- **Real-time Updates** - WebSocket-based live updates for riders and drivers
- **Multi-tenant Support** - Region-based tenant isolation

## Tech Stack

### Backend
- **Runtime**: Node.js with Express
- **Database**: PostgreSQL with Prisma ORM
- **Cache**: Redis (caching + GeoSpatial indexing)
- **Message Queue**: Apache Kafka
- **Monitoring**: New Relic APM

### Frontend
- **Framework**: Next.js with TypeScript
- **Real-time**: Socket.io
- **Maps**: Leaflet

### Infrastructure
- **Containerization**: Docker & Docker Compose
- **Local Development**: All services run locally via Docker

## Project Structure

```
gocomet-daw-assignment/
├── backend/                 # Node.js Express API
│   ├── src/
│   │   ├── config/         # Database, Redis, Kafka configs
│   │   ├── controllers/    # API route handlers
│   │   ├── services/       # Business logic
│   │   ├── middleware/     # Auth, validation, idempotency
│   │   ├── models/         # Prisma models
│   │   └── utils/          # Helper functions
│   ├── prisma/             # Database schema & migrations
│   └── tests/              # Unit & integration tests
├── frontend/               # Next.js application
│   └── src/
│       ├── app/            # Next.js app router
│       ├── components/     # React components
│       └── lib/            # Utilities & API client
├── docs/                   # Documentation
│   ├── HLD.md             # High-level design
│   └── LLD.md             # Low-level design
└── docker-compose.yml      # Local development setup
```

## Quick Start

### Prerequisites
- Docker Desktop
- Node.js 18+
- npm or yarn

### Setup

1. Clone the repository
```bash
git clone <repository-url>
cd gocomet-daw-assignment
```

2. Start infrastructure services
```bash
docker-compose up -d
```

3. Install backend dependencies
```bash
cd backend
npm install
```

4. Run database migrations
```bash
npx prisma migrate dev
npx prisma db seed
```

5. Start the backend server
```bash
npm run dev
```

6. In a new terminal, start the frontend
```bash
cd frontend
npm install
npm run dev
```

7. Open http://localhost:3001 in your browser

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/rides` | POST | Create a ride request |
| `/v1/rides/:id` | GET | Get ride status |
| `/v1/drivers/:id/location` | POST | Update driver location |
| `/v1/drivers/:id/accept` | POST | Accept ride assignment |
| `/v1/trips/:id/end` | POST | End trip and calculate fare |
| `/v1/payments` | POST | Trigger payment flow |

## Architecture Highlights

### Scalability
- Stateless API servers for horizontal scaling
- Kafka partitioning by region for parallel processing
- Redis GeoSpatial for O(log N) driver lookups
- Connection pooling for database efficiency

### Consistency
- Distributed locking (Redlock) for driver assignment
- Optimistic locking with version columns
- Database transactions for multi-table operations
- Idempotency keys for safe retries

### Reliability
- Write-through cache invalidation
- Event-driven architecture with Kafka
- Graceful error handling and retries

## License

MIT
