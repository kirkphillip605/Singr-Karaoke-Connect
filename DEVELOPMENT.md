# Singr API Backend - Development Guide

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 8+
- Docker & Docker Compose
- PostgreSQL 16 (via Docker)
- Redis 7+ (via Docker)

### Initial Setup

```bash
# 1. Clone the repository
git clone https://github.com/kirkphillip605/Singr-Karaoke-Connect.git
cd Singr-Karaoke-Connect

# 2. Install dependencies
pnpm install

# 3. Copy environment file
cp .env.example .env

# 4. Generate JWT keys (ES256)
# Install openssl if needed, then run:
openssl ecparam -name prime256v1 -genkey -noout -out private-key.pem
openssl ec -in private-key.pem -pubout -out public-key.pem

# Add keys to .env file (replace newlines with \n)

# 5. Start Docker services
make dev-up

# 6. Generate Prisma client
pnpm db:generate

# 7. Run database migrations
pnpm db:migrate:dev

# 8. Seed database with roles and permissions
pnpm db:seed

# 9. Start API server
pnpm api:dev
```

The API server will be available at `http://localhost:3000`

## Project Structure

```
singr-backend/
├── apps/
│   ├── api/                    # Main Fastify API server
│   │   ├── src/
│   │   │   ├── routes/         # API route handlers
│   │   │   │   ├── auth.ts     # Authentication endpoints
│   │   │   │   ├── public.ts   # Public venue/song endpoints
│   │   │   │   ├── singer.ts   # Singer-specific endpoints
│   │   │   │   └── customer.ts # Customer/venue owner endpoints
│   │   │   ├── services/       # Business logic layer
│   │   │   │   ├── venue.service.ts
│   │   │   │   └── request.service.ts
│   │   │   ├── server.ts       # Fastify server setup
│   │   │   └── index.ts        # Entry point
│   │   └── package.json
│   └── worker/                 # BullMQ background worker (planned)
├── packages/
│   ├── database/               # Prisma schema and client
│   │   ├── prisma/
│   │   │   ├── schema.prisma   # Database schema (25 models)
│   │   │   └── seed.ts         # Seed data
│   │   └── src/
│   │       └── index.ts        # Prisma client singleton
│   ├── auth/                   # Authentication utilities
│   │   └── src/
│   │       ├── jwt.ts          # JWT generation/verification
│   │       ├── password.ts     # Argon2id hashing
│   │       ├── rbac.ts         # Role-based access control
│   │       └── refresh-token.ts # Token revocation
│   ├── config/                 # Environment configuration
│   │   └── src/
│   │       └── index.ts        # Validated env vars (envsafe)
│   ├── shared/                 # Shared types and utilities
│   │   └── src/
│   │       ├── errors/         # Custom error classes
│   │       ├── validation/     # Zod schemas
│   │       └── utils/          # Helper functions
│   └── observability/          # Logging and monitoring
│       └── src/
│           ├── logger.ts       # Pino logger setup
│           └── sentry.ts       # Sentry integration
├── docker/
│   └── init-db.sql             # Database initialization
├── docker-compose.yml          # Local services
├── Makefile                    # Common commands
└── README.md
```

## Development Commands

### Common Tasks

```bash
# Install dependencies
pnpm install

# Start all services in dev mode
pnpm dev

# Start only API server
pnpm api:dev

# Start Docker services
make dev-up

# Stop Docker services
make dev-down

# View Docker logs
make dev-logs
```

### Database Commands

```bash
# Generate Prisma client
pnpm db:generate

# Create a new migration
pnpm db:migrate:dev

# Deploy migrations (production)
pnpm db:migrate:deploy

# Seed database
pnpm db:seed

# Open Prisma Studio (database GUI)
pnpm db:studio

# Reset database (CAUTION)
make db-reset
```

### Code Quality

```bash
# Lint code
pnpm lint

# Format code
pnpm format

# Type check
pnpm type-check

# Run tests (when implemented)
pnpm test
```

## API Documentation

### Swagger UI

When the API server is running, visit:
- Local: `http://localhost:3000/docs`

### Health Checks

```bash
# Basic health check
curl http://localhost:3000/health

# Readiness check (database + redis)
curl http://localhost:3000/health/ready
```

## Authentication Flow

### 1. Sign Up

```bash
curl -X POST http://localhost:3000/v1/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "singer@example.com",
    "password": "SecurePass123!",
    "name": "Test Singer",
    "accountType": "singer"
  }'
```

Response includes `accessToken` and `refreshToken`.

### 2. Sign In

```bash
curl -X POST http://localhost:3000/v1/auth/signin \
  -H "Content-Type: application/json" \
  -d '{
    "email": "singer@example.com",
    "password": "SecurePass123!"
  }'
```

### 3. Use Access Token

```bash
curl http://localhost:3000/v1/singer/profile \
  -H "Authorization: Bearer <accessToken>"
```

### 4. Refresh Token

```bash
curl -X POST http://localhost:3000/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "<refreshToken>"
  }'
```

## Database Schema

### Key Models

- **User** - Core user accounts with email/password
- **CustomerProfile** - Business account details
- **SingerProfile** - Singer user details
- **Venue** - Karaoke venue locations with PostGIS
- **SongDb** - Song library per system
- **Request** - Song requests from singers
- **Role/Permission** - RBAC system
- **Subscription** - Stripe subscription data

See `packages/database/prisma/schema.prisma` for complete schema.

## Environment Variables

Key environment variables (see `.env.example`):

```bash
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/singr_dev

# Redis
REDIS_URL=redis://localhost:6379

# JWT (ES256 keys)
JWT_PRIVATE_KEY="-----BEGIN EC PRIVATE KEY-----\n...\n-----END EC PRIVATE KEY-----"
JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"

# Optional Services
STRIPE_SECRET_KEY=sk_test_...
MAILJET_API_KEY=...
TWILIO_ACCOUNT_SID=...
SENTRY_DSN=...
```

## Testing

### Manual Testing with curl

```bash
# Create customer account
curl -X POST http://localhost:3000/v1/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "owner@venue.com",
    "password": "SecurePass123!",
    "name": "Venue Owner",
    "accountType": "customer",
    "customerData": {
      "legalBusinessName": "My Karaoke Bar",
      "timezone": "America/New_York"
    }
  }'

# Get access token from response, then create venue
curl -X POST http://localhost:3000/v1/customer/venues \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Karaoke Palace",
    "urlName": "karaoke-palace-nyc",
    "address": "123 Main St",
    "city": "New York",
    "state": "NY",
    "postalCode": "10001",
    "phoneNumber": "+1-212-555-0100"
  }'

# Search public venues
curl "http://localhost:3000/v1/public/venues?city=New+York&limit=10"

# Submit guest request
curl -X POST http://localhost:3000/v1/public/venues/karaoke-palace-nyc/requests \
  -H "Content-Type: application/json" \
  -d '{
    "artist": "Journey",
    "title": "Don'\''t Stop Believin'\''",
    "keyChange": 0,
    "notes": "First timer!"
  }'
```

## Troubleshooting

### Database Connection Issues

```bash
# Check if PostgreSQL is running
docker ps | grep postgres

# View PostgreSQL logs
docker logs singr-postgres

# Recreate database
make dev-down
make dev-up
pnpm db:migrate:dev
```

### Redis Connection Issues

```bash
# Check if Redis is running
docker ps | grep redis

# Test Redis connection
docker exec -it singr-redis redis-cli ping
```

### Build Errors

```bash
# Clean and reinstall
pnpm clean
rm -rf node_modules
pnpm install
pnpm build
```

### Port Already in Use

```bash
# Kill process on port 3000
lsof -ti:3000 | xargs kill -9

# Or change PORT in .env
PORT=3001
```

## Contributing

1. Create a feature branch
2. Make changes with proper commit messages
3. Run linting and type checking
4. Submit PR with description

## Production Deployment

See deployment documentation (TODO) for:
- Docker image building
- Kubernetes/ECS deployment
- Environment configuration
- Database migrations
- Monitoring setup

## Support

- GitHub Issues: [Report bugs](https://github.com/kirkphillip605/Singr-Karaoke-Connect/issues)
- Documentation: See `planning/` directory
- Email: support@singrkaraoke.com
