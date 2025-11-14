# Singr Central API Backend

> A comprehensive, production-ready REST API powering the Singr karaoke ecosystem

## 🎤 Overview

Singr Central API Backend is a unified API platform that powers multiple front-end applications:

- **Singer Web Application** - For registered and guest singers
- **Singer Mobile Applications** - Native iOS and Android apps
- **Customer Web Portal** - For venue owners and managers
- **Admin Portal** - Platform administration

## 🏗️ Architecture

This is a monorepo project organized into applications and shared packages:

```
singr-backend/
├── apps/
│   ├── api/          # Main Fastify API server
│   └── worker/       # BullMQ background job processor
├── packages/
│   ├── database/     # Prisma schema and migrations
│   ├── auth/         # JWT, RBAC, password utilities
│   ├── config/       # Environment configuration
│   ├── shared/       # DTOs, types, services
│   └── observability/ # Logging, monitoring, error tracking
└── planning/         # Complete project documentation
```

## 🚀 Tech Stack

- **Runtime**: Node.js 20+ with TypeScript (strict mode)
- **Framework**: Fastify
- **Database**: PostgreSQL 16 + PostGIS
- **ORM**: Prisma
- **Cache**: Redis
- **Queue**: BullMQ
- **Validation**: Zod
- **Auth**: JWT (ES256) + Argon2id
- **Logging**: Pino
- **Monitoring**: Sentry
- **Payments**: Stripe
- **Email**: Mailjet
- **SMS**: Twilio

## 📋 Prerequisites

- Node.js 20+
- pnpm 8+
- Docker & Docker Compose
- PostgreSQL 16 (with PostGIS)
- Redis 7+

## 🛠️ Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/kirkphillip605/Singr-Karaoke-Connect.git
cd Singr-Karaoke-Connect
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Set up environment variables

```bash
cp .env.example .env
# Edit .env with your configuration
```

### 4. Start local services

```bash
docker-compose up -d
```

### 5. Run database migrations

```bash
pnpm db:migrate:dev
pnpm db:seed
```

### 6. Start development servers

```bash
# Start all services
pnpm dev

# Or start individually
pnpm api:dev      # API server on port 3000
pnpm worker:dev   # Background worker
```

## 🧪 Testing

```bash
# Run all tests
pnpm test

# Run tests with coverage
pnpm test:coverage

# Run specific package tests
pnpm --filter @singr/api test
```

## 🔍 Code Quality

```bash
# Lint code
pnpm lint

# Format code
pnpm format

# Type check
pnpm type-check
```

## 📚 API Documentation

- **OpenAPI Spec**: See `planning/OPENAPI_SPEC.MD`
- **Swagger UI**: Available at `http://localhost:3000/docs` when running
- **Database Schema**: See `planning/PRISMA_SCHEMA.MD`

## 🗂️ Development Phases

This project is implemented across 18 phases:

- **Phase 0**: Project foundation and infrastructure ✅
- **Phase 1**: Database schema and migrations ✅
- **Phase 2**: Authentication and authorization ✅
- **Phase 3**: API server foundation ✅
- **Phase 4**: Auth endpoints ✅
- **Phase 5-7**: Singer features ✅
- **Phase 8-11**: Customer features (venues, systems, songdb, API keys) ✅
- **Phase 12**: Organization/team management ✅
- **Phase 13**: Billing integration (Stripe) (planned)
- **Phase 14-16**: Advanced features (real-time, admin ✅, analytics ✅)
- **Phase 17**: Testing and deployment (planned)

**Current Status**: Phases 0-12 + Analytics & Admin complete with 77 functional API endpoints.

See `planning/` directory for detailed phase documentation.

## 🔐 Security

- ES256 JWT with asymmetric keys
- Argon2id password hashing
- Rate limiting per endpoint
- CORS configuration
- Input validation with Zod
- SQL injection prevention (Prisma)
- API key hashing
- Webhook signature verification
- Audit logging

## 📦 Package Structure

### Apps

- `@singr/api` - Main Fastify API server
- `@singr/worker` - BullMQ background jobs

### Packages

- `@singr/database` - Prisma client and schema
- `@singr/auth` - Authentication utilities
- `@singr/config` - Environment configuration
- `@singr/shared` - Shared types and utilities
- `@singr/observability` - Logging and monitoring

## 🚢 Deployment

### Production Build

```bash
pnpm build
```

### Database Migrations

```bash
pnpm db:migrate:deploy
```

### Docker Images

```bash
docker build -f docker/api.Dockerfile -t singr-api .
docker build -f docker/worker.Dockerfile -t singr-worker .
```

## 🤝 Contributing

1. Create a feature branch
2. Make your changes
3. Run tests and linting
4. Submit a pull request

## 📄 License

Proprietary - All rights reserved

## 📧 Support

For support, email support@singrkaraoke.com

---

**Version**: 1.0.0  
**Last Updated**: 2025-11-14  
**Maintained by**: kirkphillip605
