# Singr Central API Backend - Project Summary

**Project Name**: Singr Central API Backend  
**Version**: 1.0  
**Last Updated**: 2025-11-12  
**Status**: Planning Complete - Ready for Development

---

## Executive Overview

The Singr Central API Backend is a comprehensive, unified REST API that powers the entire Singr karaoke ecosystem, including:

- **Singer Web Application** - For registered and guest singers
- **Singer Mobile Applications** - Native iOS and Android apps
- **Customer Web Portal** - For venue owners and managers

This project documentation suite provides complete technical specifications, database schemas, API definitions, and phase-by-phase implementation plans for building a production-ready karaoke management platform.

---

## Project Scope

### Core Features

1. **Authentication & Authorization**
   - JWT-based authentication (ES256)
   - OAuth integration (Google, Apple)
   - Magic link authentication
   - Two-factor authentication (TOTP, SMS)
   - Role-based access control (RBAC)

2. **Singer Features**
   - Venue discovery and search
   - Song database browsing
   - Song request submission
   - Favorites and history tracking
   - Profile management

3. **Customer Features**
   - Multi-venue management
   - Song database management
   - Request queue processing
   - Team and organization management
   - API key management for integrations
   - Analytics and reporting

4. **Billing & Subscriptions**
   - Stripe integration
   - Multiple subscription tiers
   - Usage-based billing
   - Customer portal

5. **Integrations**
   - OpenKJ compatibility layer
   - Email delivery (Mailjet)
   - SMS notifications (Twilio)
   - Push notifications
   - Geographic search (PostGIS)

---

## Technical Architecture

### Technology Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Language** | TypeScript (strict mode) | Type-safe development |
| **Runtime** | Node.js 20+ | Server execution |
| **Framework** | Fastify | High-performance HTTP server |
| **Database** | PostgreSQL 16 + PostGIS | Primary data store with geographic features |
| **ORM** | Prisma | Type-safe database access |
| **Cache** | Redis | Session storage and caching |
| **Queue** | BullMQ | Background job processing |
| **Auth** | JWT (ES256) + Argon2 | Secure authentication |
| **Validation** | Zod | Runtime schema validation |
| **Email** | Mailjet | Transactional emails |
| **SMS** | Twilio | SMS notifications and 2FA |
| **Payments** | Stripe | Subscription billing |
| **Storage** | S3/GCS | File uploads and assets |
| **Logging** | Pino | Structured JSON logging |
| **Monitoring** | Sentry | Error tracking |
| **Testing** | Vitest/Jest | Unit and integration tests |

### System Architecture

```
┌─────────────────────────────────────┐
│     Client Applications             │
│  (Web, iOS, Android, OpenKJ)       │
└──────────────┬──────────────────────┘
               │ HTTPS
┌──────────────▼──────────────────────┐
│    Load Balancer / CDN              │
│  (TLS, CORS, Rate Limiting)         │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│      Fastify API Service            │
│  • JWT Authentication               │
│  • Request Validation (Zod)         │
│  • Rate Limiting                    │
│  • Route Handlers                   │
│  • Error Handling                   │
└──┬───────┬────────┬─────────┬───────┘
   │       │        │         │
   ▼       ▼        ▼         ▼
┌──────┐ ┌────┐ ┌─────┐ ┌─────────┐
│Postgre││Redis││ S3  ││ BullMQ  │
│SQL+GIS││Cache││Store││ Workers │
└──────┘ └────┘ └─────┘ └────┬────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │Email/SMS Workers│
                    │(Mailjet, Twilio)│
                    └─────────────────┘
```

---

## Database Design

### Key Tables (25 total)

**Core Identity**
- `users` - User accounts
- `roles` - System and custom roles
- `permissions` - Granular permissions
- `user_roles` - Role assignments
- `accounts` - OAuth provider accounts
- `sessions` - Active user sessions

**Profiles**
- `customer_profiles` - Business account details
- `singer_profiles` - Singer user details

**Venue Operations**
- `venues` - Karaoke venue locations
- `systems` - Karaoke system configurations
- `songdb` - Song library per system
- `requests` - Song requests from singers

**Organization**
- `organization_users` - Team members
- `organization_user_permissions` - Permission overrides

**Billing**
- `customers` - Stripe customer records
- `subscriptions` - Active subscriptions
- `products` - Stripe products
- `prices` - Pricing tiers
- `stripe_webhook_events` - Webhook event log

**API Management**
- `api_keys` - Customer API keys
- `branded_apps` - White-label configurations
- `branded_app_api_keys` - App-specific keys

**Features**
- `singer_favorite_songs` - Singer favorites
- `singer_favorite_venues` - Favorite venues
- `singer_request_history` - Request history

**Analytics**
- `saved_reports` - Custom report definitions
- `report_executions` - Report run history
- `audit_logs` - Complete audit trail

### Materialized Views

- `daily_request_stats` - Daily aggregated metrics
- `song_popularity_stats` - Song request frequencies
- `singer_activity_stats` - Singer engagement metrics
- `platform_analytics` - Platform-wide statistics

---

## API Specification

### Endpoint Categories

1. **Authentication** (`/v1/auth/*`)
   - Sign up, sign in, sign out
   - Password reset, email verification
   - Magic links, 2FA, OAuth

2. **Public** (`/v1/public/*`)
   - Venue discovery and search
   - Song database browsing
   - Guest request submission

3. **Singer** (`/v1/singer/*`)
   - Profile management
   - Favorites and history
   - Request submission

4. **Customer Venues** (`/v1/customer/venues/*`)
   - Venue CRUD operations
   - Venue configuration

5. **Customer Systems** (`/v1/customer/systems/*`)
   - System management
   - Song database import/export

6. **Customer Requests** (`/v1/customer/requests/*`)
   - Request queue management
   - Request processing

7. **Customer API Keys** (`/v1/customer/api-keys/*`)
   - Key generation and management
   - Key rotation and revocation

8. **Organization** (`/v1/customer/organization/*`)
   - Team member management
   - Role and permission assignment

9. **Billing** (`/v1/customer/subscription/*`)
   - Subscription management
   - Stripe checkout and portal

10. **Analytics** (`/v1/customer/analytics/*`)
    - Daily statistics
    - Song popularity
    - Custom reports

11. **OpenKJ Compatibility** (`/api/*`)
    - Legacy OpenKJ endpoints
    - Request interface API

### Authentication Methods

- **JWT Bearer Token**: Primary authentication method
- **API Keys**: For OpenKJ and third-party integrations
- **Magic Links**: Passwordless authentication
- **OAuth 2.0**: Google and Apple sign-in
- **2FA**: TOTP and SMS-based

---

## Development Phases

The project is organized into 18 development phases (0-17):

### Phase 0: Foundation (2-3 days)
- Repository setup and tooling
- Docker environment
- Configuration management
- Observability infrastructure
- Communication services (Mailjet, Twilio)

### Phase 1: Database (3-4 days)
- PostgreSQL + PostGIS setup
- Prisma schema implementation
- Database migrations
- Seed data

### Phase 2: Authentication (3-4 days)
- JWT token management
- Password hashing
- RBAC implementation
- Session management

### Phase 3: API Foundation (2-3 days)
- Fastify server setup
- Request validation
- Error handling
- Rate limiting
- CORS and security

### Phase 4: Auth Endpoints (4-5 days)
- Sign up/in/out endpoints
- Password reset flow
- Magic links
- 2FA (TOTP + SMS)
- OAuth integration

### Phase 5: Public Features (3-4 days)
- Venue discovery
- Song database search
- Guest request submission
- Geographic search

### Phase 6: Singer Profile (2-3 days)
- Profile CRUD
- Avatar management
- Preferences

### Phase 7: Singer Features (4-5 days)
- Favorites management
- Request history
- Recommendations

### Phase 8: Venue Management (3-4 days)
- Venue CRUD
- URL name validation
- Geographic data
- Settings

### Phase 9: Systems & SongDB (5-6 days)
- System management
- Song database CRUD
- Bulk import/export
- Full-text search

### Phase 10: Request Management (4-5 days)
- Request queue
- Processing workflows
- Real-time updates
- History

### Phase 11: API Keys & OpenKJ (5-6 days)
- API key management
- OpenKJ compatibility
- Request interface API
- Usage tracking

### Phase 12: Organization (4-5 days)
- Team invitations
- Role assignment
- Permission management
- Activity tracking

### Phase 13: Billing (5-7 days)
- Stripe integration
- Subscription plans
- Checkout flow
- Customer portal
- Webhooks

### Phase 14: Request Interface (3-4 days)
- Real-time updates
- WebSocket support
- Polling endpoints
- Notifications

### Phase 15: Admin Portal (4-5 days)
- Platform administration
- Customer management
- Support tools
- System monitoring

### Phase 16: Analytics (5-6 days)
- Daily statistics
- Song popularity
- Singer activity
- Custom reports
- Export functionality

### Phase 17: Testing & Deployment (7-10 days)
- Unit and integration tests
- API documentation
- Performance optimization
- Production deployment
- Monitoring setup

**Total Estimated Duration**: 70-90 days (14-18 weeks)

---

## Security Features

### Authentication Security
- ES256 JWT (asymmetric cryptography)
- Refresh token rotation
- Argon2id password hashing
- Rate limiting on auth endpoints
- Session invalidation on logout
- Magic link expiration
- 2FA backup codes

### API Security
- CORS configuration
- Rate limiting per endpoint type
- Input validation with Zod
- SQL injection prevention (Prisma)
- XSS prevention
- CSRF protection
- API key hashing
- Webhook signature verification

### Data Protection
- Encrypted data at rest
- TLS 1.3 for data in transit
- Sensitive data redaction in logs
- Audit logging for all operations
- Soft deletes where appropriate

---

## Monitoring & Observability

### Logging
- Structured JSON logs (Pino)
- Correlation IDs for request tracing
- Sensitive data redaction
- Log aggregation and search

### Error Tracking
- Sentry integration
- Error grouping and alerts
- Performance monitoring
- Release tracking

### Metrics
- Prometheus-compatible metrics
- Request/response times
- Error rates
- Active sessions
- Queue depths

### Health Checks
- `/health` endpoint
- Database connectivity
- Redis connectivity
- Service readiness

---

## Deployment Architecture

### Infrastructure
- Docker containers
- Kubernetes or AWS ECS orchestration
- Auto-scaling based on metrics
- Load balancer with TLS termination
- CDN for static assets

### Database
- PostgreSQL primary with read replicas
- Automated backups (daily + WAL archiving)
- Point-in-time recovery
- Connection pooling (PgBouncer)

### Caching
- Redis cluster for high availability
- Session storage
- Application-level caching
- Rate limit tracking

### Background Jobs
- BullMQ workers
- Email delivery queue
- SMS delivery queue
- Report generation
- Database cleanup

### Monitoring
- Application metrics (Prometheus)
- Error tracking (Sentry)
- Log aggregation (ELK/DataDog)
- APM (optional)

---

## Documentation Suite

### Created Documents

1. **README.MD** (11KB)
   - Master index and navigation
   - Quick start guide
   - Technology stack overview

2. **POSTGRES_SCHEMA.MD** (36KB)
   - Complete PostgreSQL DDL
   - All tables, indexes, views
   - Functions and triggers
   - PostGIS integration

3. **PRISMA_SCHEMA.MD** (35KB)
   - Full Prisma schema
   - All models and relationships
   - Usage examples
   - Best practices

4. **OPENAPI_SPEC.MD** (57KB)
   - OpenAPI 3.0 specification
   - 50+ endpoint definitions
   - Request/response schemas
   - Authentication flows
   - Error handling patterns

5. **PHASE_X_PLAN.MD** (18 files, ~700KB total)
   - Detailed phase-by-phase plans
   - Implementation guidance
   - Code examples
   - Deliverables and timelines

**Total Documentation**: ~940KB across 22 files

---

## Quality Assurance

### Testing Strategy
- Unit tests for business logic (>70% coverage)
- Integration tests for API endpoints
- End-to-end tests for critical flows
- Load testing for performance validation
- Security scanning for vulnerabilities

### Code Quality
- TypeScript strict mode
- ESLint for code style
- Prettier for formatting
- Pre-commit hooks (Husky)
- Code review requirements

### Performance
- Response time targets (<200ms p95)
- Database query optimization
- Caching strategies
- Rate limiting
- Connection pooling

---

## Project Milestones

### Milestone 1: Foundation Complete (Week 2)
- Infrastructure setup
- Database schema deployed
- Authentication working
- Basic API endpoints

### Milestone 2: Singer Features Complete (Week 6)
- Public venue discovery
- Singer profile management
- Favorites and history
- Request submission

### Milestone 3: Customer Features Complete (Week 12)
- Venue management
- Song database
- Request processing
- Team management
- API keys

### Milestone 4: Billing & Analytics Complete (Week 15)
- Stripe integration
- Subscription management
- Analytics dashboard
- Custom reports

### Milestone 5: Production Ready (Week 18)
- All tests passing
- Documentation complete
- Performance optimized
- Production deployed
- Monitoring active

---

## Success Criteria

### Technical
- [ ] All API endpoints implemented and tested
- [ ] >70% test coverage
- [ ] <200ms p95 response time
- [ ] Zero critical security vulnerabilities
- [ ] 99.9% uptime SLA

### Functional
- [ ] Singers can discover venues and submit requests
- [ ] Customers can manage venues and process requests
- [ ] Teams can collaborate with proper permissions
- [ ] Billing integration works end-to-end
- [ ] Analytics provide actionable insights

### Operational
- [ ] Automated deployments working
- [ ] Monitoring and alerting configured
- [ ] Documentation complete and up-to-date
- [ ] Support runbooks created
- [ ] Disaster recovery tested

---

## Next Steps

### Immediate Actions (Week 1)

1. **Set up development environment**
   - Install Node.js, pnpm, Docker
   - Clone repository
   - Configure local services

2. **Review documentation**
   - Read through all phase plans
   - Understand database schema
   - Review API specification

3. **Begin Phase 0**
   - Initialize monorepo structure
   - Set up Docker Compose
   - Configure tooling (ESLint, Prettier)
   - Set up Mailjet and Twilio accounts

### Short-term Goals (Weeks 2-4)

1. **Complete Phase 0-1**
   - Infrastructure ready
   - Database deployed
   - Seed data loaded

2. **Complete Phase 2-3**
   - Authentication working
   - API server running
   - Basic endpoints tested

3. **Begin Phase 4**
   - Auth endpoints implemented
   - 2FA working
   - OAuth configured

### Medium-term Goals (Weeks 5-12)

1. **Complete Singer Features (Phases 5-7)**
2. **Complete Customer Features (Phases 8-11)**
3. **Implement Organization & Billing (Phases 12-13)**

### Long-term Goals (Weeks 13-18)

1. **Complete Advanced Features (Phases 14-16)**
2. **Comprehensive Testing (Phase 17)**
3. **Production Deployment**
4. **Post-launch Monitoring**

---

## Support & Resources

### Documentation
- All planning documents in `/Project Planning Documents`
- API documentation at `/docs` endpoint
- Architecture diagrams in repository

### Communication
- GitHub Issues for bugs and features
- GitHub Discussions for questions
- Email: support@singrkaraoke.com

### Development Resources
- Fastify documentation: https://fastify.io
- Prisma documentation: https://prisma.io
- Stripe API reference: https://stripe.com/docs/api

---

## Conclusion

This comprehensive documentation suite provides everything needed to implement the Singr Central API Backend from start to finish. The modular phase-based approach allows for incremental development while maintaining a clear vision of the final architecture.

The project is well-architected with modern best practices, comprehensive security, and production-ready infrastructure. Following the phase plans sequentially will result in a robust, scalable karaoke management platform.

**Status**: ✅ Planning Complete - Ready to Begin Development

**Last Updated**: 2025-11-12  
**Version**: 1.0.0  
**Document Prepared By**: GitHub Copilot Development Agent
