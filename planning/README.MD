# Singr Central API Backend - Project Planning Documents

This directory contains all planning and specification documents for the Singr Central API Backend project.

## Document Overview

### Database Schemas

- **[POSTGRES_SCHEMA.MD](./POSTGRES_SCHEMA.MD)** - Complete PostgreSQL database schema including:
  - All tables with columns and constraints
  - Indexes for performance optimization
  - Foreign key relationships
  - Functions and triggers
  - Materialized views for analytics
  - PostGIS geographic data support

- **[PRISMA_SCHEMA.MD](./PRISMA_SCHEMA.MD)** - Prisma ORM schema definition including:
  - All data models with TypeScript types
  - Relationships and cascading rules
  - Enums and constraints
  - Usage examples and best practices

### API Specification

- **[OPENAPI_SPEC.MD](./OPENAPI_SPEC.MD)** - Complete OpenAPI 3.0 specification covering:
  - All REST API endpoints across 17 phases
  - Authentication flows (JWT, OAuth, Magic Links)
  - Request/response schemas
  - Error handling patterns
  - Rate limiting specifications
  - Pagination guidelines
  - OpenKJ compatibility layer

### Phase Planning Documents

The development is organized into 18 phases (Phase 0-17). Each phase has its own detailed planning document:

#### **Phase 0: Project Foundation & Infrastructure Setup**
- [PHASE_0_PLAN.MD](./PHASE_0_PLAN.MD)
- Repository structure and tooling
- Docker and local development environment
- Configuration and secrets management
- Observability foundation
- Communication infrastructure (Mailjet, Twilio, BullMQ)

#### **Phase 1: Database Schema & Core Models**
- [PHASE_1_PLAN.MD](./PHASE_1_PLAN.MD)
- PostgreSQL + PostGIS setup
- Complete Prisma schema implementation
- Database seed scripts
- Migration infrastructure

#### **Phase 2: Authentication & Authorization**
- [PHASE_2_PLAN.MD](./PHASE_2_PLAN.MD)
- JWT token management (ES256)
- Password hashing with Argon2
- RBAC (Role-Based Access Control)
- Session management
- Refresh token rotation

#### **Phase 3: API Server Foundation**
- [PHASE_3_PLAN.MD](./PHASE_3_PLAN.MD)
- Fastify server setup
- Request validation with Zod
- Error handling middleware
- CORS and security headers
- Rate limiting
- Request logging

#### **Phase 4: Authentication Endpoints**
- [PHASE_4_PLAN.MD](./PHASE_4_PLAN.MD)
- Sign up / Sign in / Sign out
- Password reset flow
- Email verification
- Magic link authentication
- Two-factor authentication (TOTP, SMS)
- OAuth integration (Google, Apple)

#### **Phase 5: Public Venue Discovery & Guest Features**
- [PHASE_5_PLAN.MD](./PHASE_5_PLAN.MD)
- Public venue search (by location, city, state)
- Venue details and song database search
- Guest song request submission
- Geographic search with PostGIS
- Rate limiting for public endpoints

#### **Phase 6: Singer Account & Profile Management**
- [PHASE_6_PLAN.MD](./PHASE_6_PLAN.MD)
- Singer profile CRUD operations
- Avatar upload and management
- Profile preferences and settings
- Account deletion

#### **Phase 7: Singer History, Favorites & Personalization**
- [PHASE_7_PLAN.MD](./PHASE_7_PLAN.MD)
- Favorite songs management
- Favorite venues tracking
- Song request history
- Personalized recommendations

#### **Phase 8: Customer Venue Management**
- [PHASE_8_PLAN.MD](./PHASE_8_PLAN.MD)
- Venue CRUD operations
- URL name uniqueness validation
- Geographic data with PostGIS
- Venue branding and settings
- Request acceptance toggle

#### **Phase 9: Customer Systems & Songdb Management**
- [PHASE_9_PLAN.MD](./PHASE_9_PLAN.MD)
- Karaoke system management
- Song database CRUD operations
- Bulk song import/export
- Song search with full-text indexing
- CSV/Excel import support

#### **Phase 10: Customer Request Management**
- [PHASE_10_PLAN.MD](./PHASE_10_PLAN.MD)
- Request queue management
- Request processing and marking as complete
- Request filtering and sorting
- Real-time updates via webhooks
- Request history and analytics

#### **Phase 11: API Key Management & OpenKJ Integration**
- [PHASE_11_PLAN.MD](./PHASE_11_PLAN.MD)
- API key generation and management
- Key rotation and revocation
- OpenKJ-compatible API endpoints
- Request interface API for third-party apps
- Usage tracking and rate limiting

#### **Phase 12: Customer Organization & Team Management**
- [PHASE_12_PLAN.MD](./PHASE_12_PLAN.MD)
- Organization user invitations
- Role assignment and permissions
- Permission overrides per organization
- Team member management
- Activity tracking

#### **Phase 13: Subscription & Billing Integration**
- [PHASE_13_PLAN.MD](./PHASE_13_PLAN.MD)
- Stripe integration
- Subscription plans and pricing
- Checkout flow
- Customer portal
- Webhook handling
- Invoice management
- Usage-based billing

#### **Phase 14: Request Interface API**
- [PHASE_14_PLAN.MD](./PHASE_14_PLAN.MD)
- Real-time request updates
- WebSocket support for live queue
- Polling endpoint for legacy clients
- Request notifications
- Queue management tools

#### **Phase 15: Admin & Support Portal Backend**
- [PHASE_15_PLAN.MD](./PHASE_15_PLAN.MD)
- Platform administration endpoints
- Customer account management
- Support tools and impersonation
- System health monitoring
- Feature flag management

#### **Phase 16: Analytics & Reporting**
- [PHASE_16_PLAN.MD](./PHASE_16_PLAN.MD)
- Daily request statistics
- Song popularity tracking
- Singer activity metrics
- Venue performance reports
- Custom report builder
- Export to CSV/PDF/Excel
- Materialized views for performance

#### **Phase 17: Testing, Documentation & Deployment**
- [PHASE_17_PLAN.MD](./PHASE_17_PLAN.MD)
- Unit and integration tests
- API documentation generation
- Deployment scripts and CI/CD
- Performance optimization
- Production monitoring setup
- Load testing and scaling

## Technology Stack

### Core Technologies
- **Language**: TypeScript (strict mode)
- **Runtime**: Node.js 20+
- **Framework**: Fastify
- **Database**: PostgreSQL 16 with PostGIS
- **ORM**: Prisma
- **Cache**: Redis
- **Queue**: BullMQ

### Authentication & Security
- **JWT**: ES256 (asymmetric keys)
- **Password Hashing**: Argon2id
- **Session Management**: Redis
- **2FA**: TOTP (speakeasy) + Twilio SMS

### Communication
- **Email**: Mailjet with templates
- **SMS**: Twilio with Verify API
- **Push Notifications**: Firebase Cloud Messaging

### Payment Processing
- **Billing**: Stripe (Subscriptions API)
- **Webhooks**: Stripe webhook verification

### Storage
- **Object Storage**: S3 or Google Cloud Storage
- **File Uploads**: Signed URLs

### Observability
- **Logging**: Pino (structured JSON logs)
- **Error Tracking**: Sentry
- **Metrics**: Prometheus format
- **APM**: Optional integration

### Validation & Testing
- **Schema Validation**: Zod
- **Testing**: Vitest / Jest
- **API Testing**: Supertest
- **Load Testing**: k6

## Development Workflow

### Getting Started

1. Clone the repository
2. Install dependencies: `pnpm install`
3. Start local services: `make dev-up`
4. Run migrations: `make db-migrate`
5. Seed database: `make db-seed`
6. Start API server: `pnpm dev`

### Phase Implementation Order

The phases should be implemented in numerical order (0-17) as each phase builds upon the previous ones:

1. **Phase 0** establishes the foundation
2. **Phase 1** creates the database structure
3. **Phase 2-3** set up authentication and API infrastructure
4. **Phase 4** implements auth endpoints
5. **Phase 5-7** deliver singer features
6. **Phase 8-11** implement customer features
7. **Phase 12-13** add team and billing
8. **Phase 14-16** provide advanced features
9. **Phase 17** ensures quality and production readiness

### Development Best Practices

- Follow TypeScript strict mode
- Write tests for all business logic
- Use Zod for runtime validation
- Follow RESTful API conventions
- Document all public APIs
- Use semantic commit messages
- Review security implications
- Monitor performance metrics

## API Documentation

### Base URLs

- **Production**: `https://api.singrkaraoke.com`
- **Staging**: `https://staging-api.singrkaraoke.com`
- **Local**: `http://localhost:3000`

### API Versioning

All endpoints are versioned under `/v1/`. Future versions will use `/v2/`, etc.

### Authentication

Bearer token authentication:
```
Authorization: Bearer <jwt_access_token>
```

API key authentication:
```
X-API-Key: <api_key>
```

### Rate Limits

- Public endpoints: 60 requests/minute
- Authenticated endpoints: 100 requests/minute
- API key endpoints: Variable by subscription tier

### Error Responses

All errors follow RFC 7807 Problem Details format:
```json
{
  "type": "https://api.singrkaraoke.com/errors/not_found",
  "title": "Resource Not Found",
  "status": 404,
  "detail": "The requested venue was not found"
}
```

## Database Schema

### Key Tables

- **users**: Core user accounts
- **customer_profiles**: Business/venue owner profiles
- **singer_profiles**: Singer user profiles
- **venues**: Karaoke venue locations
- **songdb**: Song library per system
- **requests**: Song requests from singers
- **api_keys**: API keys for OpenKJ integration
- **subscriptions**: Stripe subscription data

### Relationships

- User → CustomerProfile (1:1)
- User → SingerProfile (1:1)
- CustomerProfile → Venues (1:many)
- CustomerProfile → Systems (1:many)
- System → SongDb (1:many)
- Venue → Requests (1:many)
- SingerProfile → Requests (1:many)

## Security Considerations

### Authentication Security
- ES256 JWT tokens (asymmetric)
- Refresh token rotation
- Secure password hashing (Argon2id)
- Rate limiting on auth endpoints
- Session invalidation on logout

### Data Protection
- SQL injection prevention (Prisma)
- XSS prevention (input sanitization)
- CSRF protection (SameSite cookies)
- Encrypted data at rest
- TLS 1.3 for data in transit

### API Security
- CORS configuration
- Rate limiting per endpoint
- API key hashing before storage
- Webhook signature verification
- Input validation with Zod

## Deployment

### Infrastructure
- Docker containers
- Kubernetes or AWS ECS
- Load balancer with TLS termination
- Auto-scaling based on load
- Health checks and readiness probes

### Database
- PostgreSQL primary with read replicas
- Automated backups
- Point-in-time recovery
- Connection pooling

### Monitoring
- Application metrics (Prometheus)
- Error tracking (Sentry)
- Structured logging (Pino)
- APM for performance monitoring

### CI/CD
- Automated testing on PR
- Code quality checks (ESLint, Prettier)
- Security scanning (npm audit, Snyk)
- Automated deployment to staging
- Manual promotion to production

## Support & Contributing

### Documentation
- API documentation: `/docs` endpoint (Swagger UI)
- Architecture documentation: `docs/ARCHITECTURE.md`
- Contributing guidelines: `CONTRIBUTING.md`

### Issue Tracking
- GitHub Issues for bugs and features
- GitHub Projects for roadmap
- Discord/Slack for discussions

### Contact
- Email: support@singrkaraoke.com
- Website: https://singrkaraoke.com

---

**Last Updated**: 2025-11-12  
**Version**: 1.0  
**Maintained by**: kirkphillip605
