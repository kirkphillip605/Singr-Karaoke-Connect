import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import websocket from '@fastify/websocket';
import Redis from 'ioredis';

import { config } from '@singr/config';
import { logger, initSentry, Sentry } from '@singr/observability';
import { prisma } from '@singr/database';
import { RefreshTokenService } from '@singr/auth';
import { AppError } from '@singr/shared';
import { initWebSocketService } from './services/websocket.service';

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user?: {
      sub: string;
      email: string;
      jti: string;
      accountType?: 'singer' | 'customer';
      profileId?: string;
    };
    rawBody?: string | Buffer;
  }
}

export async function buildServer(): Promise<FastifyInstance> {
  // @ts-expect-error - Pino logger types are compatible but have minor type differences
  const server = Fastify({
    logger,
    requestIdLogLabel: 'correlationId',
    disableRequestLogging: false,
    trustProxy: true,
    ajv: {
      customOptions: {
        removeAdditional: 'all',
        coerceTypes: true,
        useDefaults: true,
      },
    },
  });

  // Initialize Sentry
  initSentry();

  // Global error handler
  server.setErrorHandler((error, request, reply) => {
    // Handle AppError instances
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send(error.toJSON());
    }

    // Log error with Sentry
    const user = request.user as any;
    Sentry.captureException(error, {
      user: user
        ? { id: user.sub, email: user.email }
        : undefined,
      extra: {
        correlationId: request.id,
        url: request.url,
        method: request.method,
        params: request.params,
        query: request.query,
      },
    });

    // Don't leak internal errors to clients
    if (error.statusCode && error.statusCode < 500) {
      return reply.send(error);
    }

    request.log.error({ error }, 'Internal server error');
    return reply.code(500).send({
      type: 'internal_error',
      title: 'Internal Server Error',
      detail: 'An unexpected error occurred',
      correlationId: request.id,
    });
  });

  // Not found handler
  server.setNotFoundHandler((request, reply) => {
    return reply.code(404).send({
      type: 'resource_not_found',
      title: 'Not Found',
      detail: `Route ${request.method} ${request.url} not found`,
    });
  });

  // Register helmet for security headers
  await server.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  });

  // Register CORS
  await server.register(cors, {
    origin: config.CORS_ORIGINS.split(','),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'X-API-Key',
    ],
    exposedHeaders: [
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      'X-Request-Id',
    ],
  });

  // Register JWT
  // @ts-expect-error - JWT plugin types have minor incompatibilities with Fastify 5
  await server.register(jwt, {
    secret: {
      private: config.JWT_PRIVATE_KEY,
      public: config.JWT_PUBLIC_KEY,
    },
    sign: {
      algorithm: 'ES256',
      issuer: config.JWT_ISSUER,
      audience: config.JWT_AUDIENCE,
    },
    verify: {
      algorithms: ['ES256'],
      issuer: config.JWT_ISSUER,
      audience: config.JWT_AUDIENCE,
    },
  });

  // Register WebSocket support
  await server.register(websocket, {
    options: {
      maxPayload: 1048576, // 1MB
      clientTracking: true,
    },
  });

  // Register rate limiting
  // @ts-expect-error - Redis constructor type compatibility
  const redis = new Redis(config.REDIS_URL);
  await server.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: '1 minute',
    redis,
    skipOnError: true,
    keyGenerator: (request) => {
      const user = request.user as any;
      return user?.sub || request.ip;
    },
    errorResponseBuilder: (_request, context) => {
      return {
        type: 'rate_limited',
        title: 'Too Many Requests',
        detail: `Rate limit exceeded. Retry after ${Math.ceil(context.ttl / 1000)} seconds`,
        retryAfter: Math.ceil(context.ttl / 1000),
      };
    },
  });

  // Register Swagger documentation
  await server.register(swagger, {
    openapi: {
      info: {
        title: 'Singr Central API',
        description: 'Unified REST API for the Singr karaoke ecosystem',
        version: '1.0.0',
      },
      servers: [
        { url: 'http://localhost:3000', description: 'Development' },
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

  await server.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });

  // Decorate server with dependencies
  server.decorate('prisma', prisma);
  server.decorate('redis', redis);

  // Auth decorator
  server.decorate('authenticate', async (request, reply) => {
    try {
      await request.jwtVerify();

      const user = request.user as any;
      // Check if token is revoked
      const refreshTokenService = new RefreshTokenService(redis);
      const isRevoked = await refreshTokenService.isJTIRevoked(user.jti);

      if (isRevoked) {
        return reply.code(401).send({
          type: 'authentication_failed',
          title: 'Unauthorized',
          detail: 'Token has been revoked',
        });
      }

      // Fetch user account type and profile
      const dbUser = await prisma.user.findUnique({
        where: { id: user.sub },
        include: {
          customerProfile: true,
          singerProfile: true,
        },
      });

      if (dbUser) {
        if (dbUser.customerProfile) {
          user.accountType = 'customer';
          user.profileId = dbUser.customerProfile.id;
        } else if (dbUser.singerProfile) {
          user.accountType = 'singer';
          user.profileId = dbUser.singerProfile.id;
        }
      }

      // Set user in Sentry context
      Sentry.setUser({
        id: user.sub,
        email: user.email,
      });
    } catch (err) {
      return reply.code(401).send({
        type: 'authentication_failed',
        title: 'Unauthorized',
        detail: 'Invalid or expired token',
      });
    }
  });

  // Initialize WebSocket service
  initWebSocketService(server);

  // Health check endpoints
  server.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  server.get('/health/ready', async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      await redis.ping();
      return {
        status: 'ready',
        database: 'connected',
        redis: 'connected',
      };
    } catch (error) {
      throw new AppError(503, 'not_ready', 'Service Not Ready', 'Service dependencies are not ready');
    }
  });

  // Register routes
  await server.register(import('./routes/auth.js'), { prefix: '/v1/auth' });
  await server.register(import('./routes/public.js'), { prefix: '/v1/public' });
  await server.register(import('./routes/singer.js'), { prefix: '/v1/singer' });
  await server.register(import('./routes/customer.js'), { prefix: '/v1/customer' });
  await server.register(import('./routes/systems.js'), { prefix: '/v1/customer' });
  await server.register(import('./routes/songdb.js'), { prefix: '/v1/customer' });
  await server.register(import('./routes/apikeys.js'), { prefix: '/v1/customer' });
  await server.register(import('./routes/organization.js'), { prefix: '/v1/customer' });
  await server.register(import('./routes/analytics.js'), { prefix: '/v1/customer' });
  await server.register(import('./routes/billing.js'), { prefix: '/v1/customer' });
  await server.register(import('./routes/openkj.js'), { prefix: '/v1/openkj' });
  await server.register(import('./routes/admin.js'), { prefix: '/v1/admin' });
  await server.register(import('./routes/websocket.js'), { prefix: '/v1' });

  // @ts-expect-error - Fastify instance types are compatible at runtime
  return server;
}
