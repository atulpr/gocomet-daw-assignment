# High-Level Design (HLD) - GoComet Ride Hailing System

## 1. System Overview

GoComet is a scalable, multi-tenant ride-hailing platform designed to handle:
- **100,000+ drivers** across multiple regions
- **10,000 ride requests/minute** peak load
- **200,000 location updates/second** from active drivers
- **<1 second P95 latency** for driver-rider matching

## 2. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENTS                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│   ┌──────────────┐    ┌──────────────┐                                      │
│   │  Rider App   │    │  Driver App  │                                      │
│   │  (Next.js)   │    │  (Next.js)   │                                      │
│   └──────┬───────┘    └──────┬───────┘                                      │
│          │                   │                                              │
│          └───────────────────┼                                              │
│                                                                             │
│                                                                             │
│                                                                             │
│                                                                             │
└──────────────────────────────┼──────────────────────────────────────────────┘

┌──────────────────────────────┼──────────────────────────────────────────────┐
│                       API GATEWAY LAYER                                      │
├──────────────────────────────┼──────────────────────────────────────────────┤
│   ┌──────────────────────────▼──────────────────────────┐                   │
│   │              Express.js API Server                   │                   │
│   │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌───────────┐  │                   │
│   │  │  Auth   │ │  Rate   │ │Idempot- │ │Validation │  │                   │
│   │  │Middleware│ │ Limiter │ │  ency   │ │Middleware │  │                   │
│   │  └─────────┘ └─────────┘ └─────────┘ └───────────┘  │                   │
│   └──────────────────────────┬──────────────────────────┘                   │
└──────────────────────────────┼──────────────────────────────────────────────┘

┌──────────────────────────────┼──────────────────────────────────────────────┐
│                       SERVICE LAYER                                          │
├──────────────────────────────┼──────────────────────────────────────────────┤
│   ┌──────────┐  ┌───────────▼──────────┐  ┌──────────┐  ┌──────────┐        │
│   │  Ride    │  │     Matching         │  │   Trip   │  │ Payment  │        │
│   │ Service  │◄─┤      Engine          │  │ Service  │  │ Service  │        │
│   └────┬─────┘  │  (Driver Selection)  │  └────┬─────┘  └────┬─────┘        │
│        │        └──────────┬───────────┘       │             │              │
│        │                   │                   │             │              │
│   ┌────▼─────┐  ┌──────────▼───────────┐  ┌────▼─────┐  ┌────▼─────┐        │
│   │ Location │  │    Locking Service   │  │  Cache   │  │Notific-  │        │
│   │ Service  │  │     (Redlock)        │  │ Service  │  │  ation   │        │
│   └──────────┘  └──────────────────────┘  └──────────┘  └──────────┘        │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                       MESSAGING LAYER (KAFKA)                                │
├─────────────────────────────────────────────────────────────────────────────┤
│   ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐    │
│   │  location-updates  │  │    ride-events     │  │   notifications    │    │
│   │   (Partitioned)    │  │   (Partitioned)    │  │                    │    │
│   └─────────┬──────────┘  └─────────┬──────────┘  └─────────┬──────────┘    │
│             │                       │                       │               │
│   ┌─────────▼──────────┐  ┌─────────▼──────────┐  ┌─────────▼──────────┐    │
│   │ Location Consumer  │  │   Event Consumer   │  │Notification Consumer│   │
│   └────────────────────┘  └────────────────────┘  └────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                       DATA LAYER                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│   ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐    │
│   │    PostgreSQL      │  │       Redis        │  │     WebSocket      │    │
│   │   (Transactional)  │  │ (Cache + GeoIndex) │  │   (Real-time)      │    │
│   │                    │  │                    │  │                    │    │
│   │ - Rides            │  │ - Driver Locations │  │ - Location Updates │    │
│   │ - Trips            │  │ - Ride Cache       │  │ - Ride Status      │    │
│   │ - Payments         │  │ - Idempotency Keys │  │ - Notifications    │    │
│   │ - Drivers/Riders   │  │ - Distributed Locks│  │                    │    │
│   └────────────────────┘  └────────────────────┘  └────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 3. Key Components

### 3.1 API Gateway Layer
- **Express.js Server**: Stateless REST API handling all HTTP requests
- **Authentication**: Phone number + OTP authentication (JWT tokens for session management)
- **WebSocket Server**: Socket.io for real-time bidirectional communication
- **Rate Limiting**: Per-tenant and per-user rate limits (Redis-based)
- **Idempotency**: Redis-backed idempotency keys for safe retries
- **Validation**: Zod schemas for request validation
- **Monitoring**: New Relic APM for performance tracking

### 3.2 Service Layer
- **Ride Service**: Handles ride lifecycle (create, status, cancel)
- **Matching Engine**: Finds and scores nearby drivers using GeoSpatial queries
- **Trip Service**: Manages active trips and fare calculation
- **Payment Service**: Idempotent payment processing with PSP integration
- **Driver Service**: Driver location updates, status management, earnings tracking
- **Simulation Service**: Simulates driver movement towards pickup/dropoff locations
- **Notification Service**: Real-time push notifications via WebSocket and Kafka
- **Auth Service**: Phone + OTP authentication, user management

### 3.3 Data Layer
- **PostgreSQL**: Primary transactional database (raw SQL with `pg` driver)
- **Redis**: Multi-purpose cache, GeoSpatial index, distributed locks, OTP storage
- **Kafka**: Async messaging for location updates and events
- **WebSocket**: Real-time bidirectional communication for live updates

## 4. Key Design Decisions

### 4.1 Driver Matching Strategy
```
1. Rider requests ride → Create ride in REQUESTED status
2. Matching Engine queries Redis GEORADIUS for nearby online drivers
3. Score drivers by: distance (40%) + rating (30%) + acceptance_rate (30%)
4. Send ride offers to top 5 drivers via Kafka notifications
5. First driver to accept wins (distributed lock ensures no double-booking)
```

### 4.2 Location Update Pipeline
```
Driver App → WebSocket → Backend → Redis GeoSpatial (immediate)
                        ↓
                    Kafka (location-updates) → Consumer → PostgreSQL (batch)
```
- **Real-time**: WebSocket for instant updates, Redis GEOADD for matching
- **Historical**: Kafka consumer batches writes to PostgreSQL every 1 second
- **Simulation**: Backend simulates driver movement during active rides

### 4.3 Consistency Guarantees
- **Driver Assignment**: Redlock distributed locking prevents double-booking
- **Ride Status**: Optimistic locking with version column
- **Payments**: Idempotency keys ensure exactly-once processing
- **Multi-table Updates**: PostgreSQL transactions with SERIALIZABLE isolation

## 5. Scalability Patterns

### 5.1 Horizontal Scaling
- Stateless API servers behind load balancer
- Kafka consumer groups for parallel message processing
- Redis cluster for cache and geo-index distribution

### 5.2 Database Scaling
- Read replicas for read-heavy queries
- Connection pooling (20 connections per API instance)
- Partial indexes for active rides

### 5.3 Caching Strategy
| Data | Cache Location | TTL | Invalidation |
|------|---------------|-----|--------------|
| Driver Locations | Redis GeoSpatial | None | Real-time updates |
| Ride Details | Redis | 60s | Write-through |
| Driver Status | Redis | 30s | TTL-based |
| Surge Pricing | Redis | 60s | TTL-based |

## 6. Non-Functional Requirements

### 6.1 Performance Targets
- API Latency: <200ms P95
- Matching Latency: <1s P95
- Location Update: <50ms P95
- Throughput: 10k requests/minute

### 6.2 Reliability
- 99.9% uptime SLA
- Graceful degradation when Kafka/Redis unavailable
- Automatic retry with exponential backoff

### 6.3 Security
- HTTPS everywhere
- JWT authentication
- Rate limiting per user/tenant
- SQL injection prevention (parameterized queries)
- Input validation on all endpoints

## 7. Monitoring & Observability

### 7.1 New Relic Integration
- **APM**: Automatic performance monitoring for all API endpoints
- **Custom Metrics**: Matching duration, payment processing, ride lifecycle events
- **Custom Events**: Slow requests, driver matching, payment status
- **Error Tracking**: Automatic error detection and alerting
- **Response Time Tracking**: Per-endpoint latency monitoring

### 7.2 Key Metrics
- `API/ResponseTime/*` - Per-endpoint latency (P95, P99)
- `API/StatusCode/*` - HTTP status code distribution
- `Matching/Duration` - Time to find and score drivers
- `Matching/DriversFound` - Available driver count per request
- `Payment/completed` - Successful payment amounts
- `Payment/failed` - Failed payment tracking
- `Ride/Status/*` - Ride state distribution
- `SlowRequest` - Requests exceeding 1s threshold