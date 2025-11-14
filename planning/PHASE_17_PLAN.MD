# Singr Central API Backend - Phase 17

**Document Version:** 1.0  
**Last Updated:** 2025-11-12  
**Author:** kirkphillip605  
**Status:** In Development

---

## Phase 17: Testing, Documentation & Deployment

**Objective**: Implement comprehensive testing, generate API documentation, and prepare for production deployment.

### 17.1 Testing Strategy

```typescript
// package.json - Add test dependencies
{
  "devDependencies": {
    "@types/jest": "^29.5.0",
    "@types/supertest": "^6.0.0",
    "jest": "^29.7.0",
    "supertest": "^6.3.3",
    "ts-jest": "^29.1.0"
  },
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "test:integration": "jest --testPathPattern=integration",
    "test:unit": "jest --testPathPattern=unit"
  }
}
```

```typescript
// jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/__tests__/**/*.ts', '**/*.test.ts', '**/*.spec.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/__tests__/**',
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
};
```

```typescript
// tests/setup.ts
// Global test setup

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

beforeAll(async () => {
  // Setup test database
  await prisma.$connect();
});

afterAll(async () => {
  // Cleanup
  await prisma.$disconnect();
});

afterEach(async () => {
  // Clear test data between tests
  const tables = [
    'requests',
    'venues',
    'systems',
    'songdb',
    'api_keys',
    'subscriptions',
    'organization_users',
  ];

  for (const table of tables) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${table} CASCADE`);
  }
});
```

```typescript
// tests/unit/services/venue-service.test.ts

import { VenueService } from '../../../src/services/venue-service';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const venueService = new VenueService(prisma);

describe('VenueService', () => {
  describe('createVenue', () => {
    it('should create a venue with valid data', async () => {
      const customerProfileId = 'test-customer-id';
      const data = {
        name: 'Test Venue',
        urlName: 'test-venue',
        address: '123 Main St',
        city: 'Test City',
        state: 'TS',
        postalCode: '12345',
        acceptingRequests: true,
      };

      const venue = await venueService.createVenue(customerProfileId, data);

      expect(venue).toBeDefined();
      expect(venue.name).toBe(data.name);
      expect(venue.customerProfileId).toBe(customerProfileId);
    });

    it('should throw error for duplicate urlName', async () => {
      const customerProfileId = 'test-customer-id';
      const data = {
        name: 'Test Venue',
        urlName: 'duplicate',
        address: '123 Main St',
        city: 'Test City',
        state: 'TS',
        postalCode: '12345',
        acceptingRequests: true,
      };

      await venueService.createVenue(customerProfileId, data);

      await expect(
        venueService.createVenue(customerProfileId, data)
      ).rejects.toThrow();
    });
  });

  describe('updateVenue', () => {
    it('should update venue details', async () => {
      const customerProfileId = 'test-customer-id';
      const venue = await venueService.createVenue(customerProfileId, {
        name: 'Original Name',
        urlName: 'original',
        address: '123 Main St',
        city: 'Test City',
        state: 'TS',
        postalCode: '12345',
        acceptingRequests: true,
      });

      const updated = await venueService.updateVenue(
        venue.id,
        customerProfileId,
        { name: 'Updated Name' }
      );

      expect(updated.name).toBe('Updated Name');
    });

    it('should throw error for non-existent venue', async () => {
      await expect(
        venueService.updateVenue('fake-id', 'customer-id', { name: 'Test' })
      ).rejects.toThrow('Venue not found');
    });
  });
});
```

```typescript
// tests/integration/routes/venue-routes.test.ts

import supertest from 'supertest';
import { build } from '../../../src/app';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

describe('Venue Routes', () => {
  let app: any;
  let authToken: string;

  beforeAll(async () => {
    app = await build();
    await app.ready();

    // Create test user and get auth token
    const response = await supertest(app.server)
      .post('/v1/auth/signup')
      .send({
        email: 'test@example.com',
        password: 'Test123!@#',
        name: 'Test User',
      });

    authToken = response.body.token;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /v1/customer/venues', () => {
    it('should create a new venue', async () => {
      const response = await supertest(app.server)
        .post('/v1/customer/venues')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Test Venue',
          urlName: 'test-venue',
          address: '123 Main St',
          city: 'Test City',
          state: 'TS',
          postalCode: '12345',
          acceptingRequests: true,
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body.name).toBe('Test Venue');
    });

    it('should return 400 for missing required fields', async () => {
      const response = await supertest(app.server)
        .post('/v1/customer/venues')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Test Venue',
        });

      expect(response.status).toBe(400);
    });

    it('should return 401 without auth token', async () => {
      const response = await supertest(app.server)
        .post('/v1/customer/venues')
        .send({
          name: 'Test Venue',
          urlName: 'test',
        });

      expect(response.status).toBe(401);
    });
  });

  describe('GET /v1/customer/venues', () => {
    it('should list customer venues', async () => {
      const response = await supertest(app.server)
        .get('/v1/customer/venues')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('venues');
      expect(Array.isArray(response.body.venues)).toBe(true);
    });
  });
});
```

### 17.2 API Documentation Generation

```typescript
// src/app.ts - Add Swagger/OpenAPI documentation

import fastify from 'fastify';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';

export async function build() {
  const server = fastify({
    logger: true,
  });

  // Register Swagger
  await server.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'Singr Karaoke Connect API',
        description: 'Professional karaoke management platform API',
        version: '1.0.0',
        contact: {
          name: 'Singr Karaoke Support',
          email: 'support@singrkaraoke.com',
          url: 'https://singrkaraoke.com',
        },
      },
      servers: [
        {
          url: 'http://localhost:3000',
          description: 'Development server',
        },
        {
          url: 'https://api.singrkaraoke.com',
          description: 'Production server',
        },
      ],
      tags: [
        { name: 'auth', description: 'Authentication endpoints' },
        { name: 'customer', description: 'Customer management endpoints' },
        { name: 'singer', description: 'Singer endpoints' },
        { name: 'admin', description: 'Admin endpoints' },
        { name: 'public', description: 'Public endpoints' },
        { name: 'analytics', description: 'Analytics and reporting' },
        { name: 'request-interface', description: 'Request interface API' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
  });

  // Register Swagger UI
  await server.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
    staticCSP: true,
  });

  // Register routes
  // ... route registration

  return server;
}
```

### 17.3 Production Configuration

```typescript
// src/config/production.ts

export const productionConfig = {
  server: {
    host: '0.0.0.0',
    port: parseInt(process.env.PORT || '3000'),
    trustProxy: true,
  },

  database: {
    url: process.env.DATABASE_URL!,
    ssl: {
      rejectUnauthorized: true,
    },
    pool: {
      min: 2,
      max: 10,
    },
  },

  redis: {
    host: process.env.REDIS_HOST!,
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
  },

  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['https://singrkaraoke.com'],
    credentials: true,
  },

  rateLimit: {
    global: {
      max: 100,
      timeWindow: '1 minute',
    },
    auth: {
      max: 5,
      timeWindow: '15 minutes',
    },
  },

  logging: {
    level: 'info',
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: false,
        translateTime: 'SYS:standard',
      },
    },
  },

  security: {
    jwtSecret: process.env.JWT_SECRET!,
    jwtExpiresIn: '7d',
    bcryptRounds: 12,
  },

  monitoring: {
    sentryDsn: process.env.SENTRY_DSN,
    environment: 'production',
  },
};
```

### 17.4 Deployment Checklist

```markdown
# Production Deployment Checklist

## Pre-Deployment

### Database
- [ ] Run all migrations on production database
- [ ] Verify database backups are configured
- [ ] Create materialized views: `SELECT refresh_analytics_views()`
- [ ] Verify indexes are created
- [ ] Set up read replicas (if applicable)

### Environment Variables
- [ ] Set all required environment variables
- [ ] Verify Stripe keys (live mode)
- [ ] Configure Sentry DSN
- [ ] Set JWT secret (strong random value)
- [ ] Configure Redis connection
- [ ] Set allowed CORS origins
- [ ] Configure email provider credentials
- [ ] Set webhook secrets

### Security
- [ ] Enable SSL/TLS
- [ ] Configure security headers
- [ ] Set up rate limiting
- [ ] Enable CORS with proper origins
- [ ] Configure firewall rules
- [ ] Set up DDoS protection
- [ ] Enable audit logging

### Monitoring
- [ ] Set up Sentry error tracking
- [ ] Configure application performance monitoring (APM)
- [ ] Set up database query monitoring
- [ ] Configure uptime monitoring
- [ ] Set up log aggregation
- [ ] Create alerting rules

### Scheduled Jobs
- [ ] Set up cron job to refresh analytics views (daily at 1 AM UTC)
- [ ] Set up cron job to cleanup expired reports (daily)
- [ ] Set up cron job to cleanup expired delegated sessions (hourly)
- [ ] Configure BullMQ workers for background jobs

## Deployment

### Application
- [ ] Build production bundle: `npm run build`
- [ ] Run tests: `npm test`
- [ ] Verify OpenAPI documentation accessible at `/docs`
- [ ] Deploy to production environment
- [ ] Verify application starts successfully
- [ ] Check health endpoint: `GET /health`

### Infrastructure
- [ ] Configure load balancer
- [ ] Set up auto-scaling (if applicable)
- [ ] Configure CDN for static assets
- [ ] Set up backup strategy
- [ ] Configure disaster recovery plan

## Post-Deployment

### Verification
- [ ] Verify all API endpoints are accessible
- [ ] Test authentication flow
- [ ] Verify Stripe webhook delivery
- [ ] Test email delivery
- [ ] Verify Redis connectivity
- [ ] Check database connectivity
- [ ] Test rate limiting

### Monitoring
- [ ] Verify Sentry is receiving errors
- [ ] Check application logs
- [ ] Monitor database performance
- [ ] Monitor API response times
- [ ] Check scheduled job execution

### Documentation
- [ ] Update API documentation
- [ ] Document deployment process
- [ ] Create runbook for common issues
- [ ] Document rollback procedure
- [ ] Update change log

## Rollback Plan

If issues are encountered:
1. Stop new deployment
2. Revert to previous version
3. Run database rollback if needed
4. Verify previous version is working
5. Investigate and fix issues
6. Re-deploy when ready
```

### 17.5 Monitoring and Observability

```typescript
// src/lib/monitoring.ts

import * as Sentry from '@sentry/node';
import { ProfilingIntegration } from '@sentry/profiling-node';

export function initializeMonitoring() {
  if (process.env.SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || 'development',
      integrations: [
        new ProfilingIntegration(),
      ],
      tracesSampleRate: 0.1, // Capture 10% of transactions
      profilesSampleRate: 0.1,
      beforeSend(event, hint) {
        // Filter sensitive data
        if (event.request?.headers) {
          delete event.request.headers.authorization;
          delete event.request.headers.cookie;
        }
        return event;
      },
    });
  }
}

export function captureException(error: Error, context?: Record<string, any>) {
  console.error('Error:', error);
  
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(error, {
      extra: context,
    });
  }
}

export function captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info') {
  console.log(`[${level.toUpperCase()}] ${message}`);
  
  if (process.env.SENTRY_DSN) {
    Sentry.captureMessage(message, level);
  }
}

export function addBreadcrumb(breadcrumb: {
  message: string;
  category?: string;
  level?: 'info' | 'warning' | 'error';
  data?: Record<string, any>;
}) {
  if (process.env.SENTRY_DSN) {
    Sentry.addBreadcrumb(breadcrumb);
  }
}
```

```typescript
// src/plugins/monitoring.ts

import type { FastifyPluginAsync } from 'fastify';
import * as Sentry from '@sentry/node';
import { captureException } from '../lib/monitoring';

const monitoringPlugin: FastifyPluginAsync = async (server) => {
  // Request tracking
  server.addHook('onRequest', async (request, reply) => {
    request.log.info({
      method: request.method,
      url: request.url,
      ip: request.ip,
    });
  });

  // Response time tracking
  server.addHook('onResponse', async (request, reply) => {
    const responseTime = reply.getResponseTime();
    
    request.log.info({
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      responseTime,
    });

    // Track slow requests
    if (responseTime > 1000) {
      request.log.warn({
        message: 'Slow request detected',
        method: request.method,
        url: request.url,
        responseTime,
      });
    }
  });

  // Error tracking
  server.setErrorHandler((error, request, reply) => {
    const statusCode = error.statusCode || 500;

    captureException(error, {
      method: request.method,
      url: request.url,
      user: request.user?.id,
    });

    if (statusCode >= 500) {
      request.log.error(error);
    } else {
      request.log.warn(error);
    }

    reply.status(statusCode).send({
      type: 'internal_error',
      title: 'Internal Server Error',
      detail: process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred'
        : error.message,
    });
  });

  // Health check endpoint
  server.get('/health', async (request, reply) => {
    // Check database
    try {
      await server.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      return reply.code(503).send({
        status: 'unhealthy',
        database: 'down',
      });
    }

    // Check Redis
    try {
      await server.redis.ping();
    } catch (error) {
      return reply.code(503).send({
        status: 'unhealthy',
        redis: 'down',
      });
    }

    return reply.send({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });
};

export default monitoringPlugin;
```

### 17.6 Production Scripts

```typescript
// scripts/production-startup.ts
/**
 * Production startup script
 * Ensures all prerequisites are met before starting the application
 */

import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

const prisma = new PrismaClient();

async function checkDatabase() {
  console.log('Checking database connection...');
  try {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
    console.log('✓ Database connection successful');
    return true;
  } catch (error) {
    console.error('✗ Database connection failed:', error);
    return false;
  }
}

async function checkRedis() {
  console.log('Checking Redis connection...');
  try {
    const redis = new Redis({
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
    });

    await redis.ping();
    await redis.disconnect();
    console.log('✓ Redis connection successful');
    return true;
  } catch (error) {
    console.error('✗ Redis connection failed:', error);
    return false;
  }
}

async function checkEnvironmentVariables() {
  console.log('Checking environment variables...');
  
  const required = [
    'DATABASE_URL',
    'REDIS_HOST',
    'JWT_SECRET',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
  ];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error('✗ Missing required environment variables:', missing);
    return false;
  }

  console.log('✓ All required environment variables set');
  return true;
}

async function refreshAnalyticsViews() {
  console.log('Refreshing analytics views...');
  try {
    await prisma.$executeRaw`SELECT refresh_analytics_views()`;
    console.log('✓ Analytics views refreshed');
    return true;
  } catch (error) {
    console.error('✗ Failed to refresh analytics views:', error);
    return false;
  }
}

async function main() {
  console.log('='.repeat(50));
  console.log('Singr Karaoke Connect - Production Startup Check');
  console.log('='.repeat(50));

  const checks = [
    await checkEnvironmentVariables(),
    await checkDatabase(),
    await checkRedis(),
    await refreshAnalyticsViews(),
  ];

  await prisma.$disconnect();

  if (checks.every((check) => check)) {
    console.log('\n✓ All checks passed! Starting application...\n');
    process.exit(0);
  } else {
    console.log('\n✗ Some checks failed. Please fix the issues before starting.\n');
    process.exit(1);
  }
}

main();
```
