# Local Development Setup

This guide explains how to set up the GoComet Ride Hailing application locally.

## Prerequisites

1. **Docker Desktop** - [Download here](https://www.docker.com/products/docker-desktop/)
2. **Node.js 18+** - [Download here](https://nodejs.org/)
3. **npm** or **yarn**

## Infrastructure Services

All infrastructure services run via Docker Compose:

| Service | Port | Description |
|---------|------|-------------|
| PostgreSQL | 5432 | Primary database |
| Redis | 6379 | Caching & GeoSpatial |
| Kafka | 9092 | Message broker |
| Zookeeper | 2181 | Kafka coordination |
| Kafka UI | 8080 | Debug Kafka topics |

## Quick Start

### 1. Start Infrastructure

```bash
# From project root
docker-compose up -d

# Check all services are running
docker-compose ps

# View logs if needed
docker-compose logs -f
```

### 2. Setup Environment

```bash
# Copy environment template
cp .env.example .env

# Edit .env if needed (defaults work for local development)
```

### 3. Start Backend

```bash
cd backend
npm install

# Run database migrations
npm run db:migrate

# Seed database with sample data
npm run db:seed

# Start development server
npm run dev
```

Backend will be available at http://localhost:3000

### 4. Start Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend will be available at http://localhost:3001

## Useful Commands

### Docker

```bash
# Stop all services
docker-compose down

# Stop and remove volumes (clean slate)
docker-compose down -v

# View service logs
docker-compose logs -f postgres
docker-compose logs -f kafka

# Restart a specific service
docker-compose restart redis
```

### Database

```bash
# Connect to PostgreSQL
docker exec -it gocomet-postgres psql -U gocomet -d ridehailing

# Run migrations manually
cd backend
npm run db:migrate

# Seed database
npm run db:seed

# View tables
\dt

# Query rides
SELECT * FROM rides LIMIT 10;
```

### Kafka

Access Kafka UI at http://localhost:8080 to:
- View topics and messages
- Monitor consumer groups
- Debug message flow

### Redis

```bash
# Connect to Redis CLI
docker exec -it gocomet-redis redis-cli

# Check GeoSpatial data
GEORADIUS drivers:online:economy 77.5946 12.9716 5 km WITHDIST
```

## Troubleshooting

### Port Already in Use

If a port is already in use, either stop the conflicting service or change the port in `docker-compose.yml`.

```bash
# Find what's using a port (e.g., 5432)
lsof -i :5432
```

### Kafka Connection Issues

Ensure Zookeeper is healthy before Kafka starts:

```bash
docker-compose logs zookeeper
docker-compose logs kafka
```

### Database Connection Refused

Wait for PostgreSQL to be ready:

```bash
docker-compose logs postgres
# Look for "database system is ready to accept connections"
```

## Resource Requirements

Recommended minimum for local development:
- **RAM**: 8GB (Docker services use ~2-3GB)
- **Disk**: 5GB free space
- **CPU**: 4 cores
