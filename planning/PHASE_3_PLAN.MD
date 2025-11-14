# Singr Central API Backend - Phase 3

**Document Version:** 1.0  
**Last Updated:** 2025-11-12  
**Author:** kirkphillip605  
**Status:** In Development

---

## Phase 3: API Server Foundation

### 3.1 Fastify Server Setup

**Objective:** Bootstrap Fastify with core plugins and middleware.

**Duration:** 2-3 days  
**Team Size:** 1-2 developers

**Tasks:**

1. **Create `apps/api/src/server.ts`:**
   ```typescript
   import Fastify, { FastifyInstance } from 'fastify';
   import cors from '@fastify/cors';
   import helmet from '@fastify/helmet';
   import jwt from '@fastify/jwt';
   import rateLimit from '@fastify/rate-limit';
   import { config } from '@singr/config';
   import { logger, initSentry, Sentry } from '@singr/observability';
   import { prisma } from '@singr/database';
   import { RefreshTokenService } from '@singr/auth';
   import Redis from 'ioredis';

   // Extend Fastify instance with custom properties
   declare module 'fastify' {
     interface FastifyInstance {
       prisma: typeof prisma;
       redis: Redis;
       authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
     }
   }

   export async function buildServer(): Promise<FastifyInstance> {
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
       // Log error with Sentry
       Sentry.captureException(error, {
         user: request.user
           ? { id: request.user.sub, email: request.user.email }
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
       contentSecurityPolicy: false, // Disable CSP for API
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

     // Register rate limiting
     const redis = new Redis(config.REDIS_URL);
     await server.register(rateLimit, {
       global: true,
       max: 100,
       timeWindow: '1 minute',
       redis,
       skipOnError: true,
       keyGenerator: (request) => {
         // Use user ID if authenticated, otherwise IP
         return request.user?.sub || request.ip;
       },
       errorResponseBuilder: (request, context) => {
         return {
           type: 'rate_limited',
           title: 'Too Many Requests',
           detail: `Rate limit exceeded. Retry after ${Math.ceil(context.ttl / 1000)} seconds`,
           retryAfter: Math.ceil(context.ttl / 1000),
         };
       },
     });

     // Decorate with dependencies
     server.decorate('prisma', prisma);
     server.decorate('redis', redis);

     // Auth decorator
     server.decorate('authenticate', async (request, reply) => {
       try {
         await request.jwtVerify();

         // Check if token is revoked
         const refreshTokenService = new RefreshTokenService(server.redis);
         const isRevoked = await refreshTokenService.isJTIRevoked(
           request.user.jti
         );

         if (isRevoked) {
           return reply.code(401).send({
             type: 'authentication_failed',
             title: 'Unauthorized',
             detail: 'Token has been revoked',
           });
         }

         // Set user in Sentry context
         Sentry.setUser({
           id: request.user.sub,
           email: request.user.email,
         });
       } catch (err) {
         return reply.code(401).send({
           type: 'authentication_failed',
           title: 'Unauthorized',
           detail: 'Invalid or expired token',
         });
       }
     });

     // Health check endpoints
     server.get('/healthz', async () => {
       return { status: 'ok', timestamp: new Date().toISOString() };
     });

     server.get('/readyz', async () => {
       try {
         // Check database
         await prisma.$queryRaw`SELECT 1`;

         // Check Redis
         await server.redis.ping();

         return {
           status: 'ok',
           timestamp: new Date().toISOString(),
           checks: {
             database: 'ok',
             redis: 'ok',
           },
         };
       } catch (err) {
         throw server.httpErrors.serviceUnavailable(
           'Service dependencies unavailable'
         );
       }
     });

     // Graceful shutdown
     const closeGracefully = async (signal: string) => {
       logger.info(`Received ${signal}, closing gracefully`);
       await server.close();
       await prisma.$disconnect();
       await redis.quit();
       process.exit(0);
     };

     process.on('SIGINT', () => closeGracefully('SIGINT'));
     process.on('SIGTERM', () => closeGracefully('SIGTERM'));

     return server;
   }
   ```

2. **Create `apps/api/src/index.ts`:**
   ```typescript
   import { buildServer } from './server';
   import { config } from '@singr/config';
   import { logger } from '@singr/observability';

   async function start() {
     try {
       const server = await buildServer();

       // Register routes (will be added in subsequent phases)
       // await server.register(routes);

       await server.listen({
         port: config.PORT,
         host: '0.0.0.0',
       });

       logger.info(
         {
           port: config.PORT,
           environment: config.NODE_ENV,
         },
         'Server listening'
       );
     } catch (err) {
       logger.error({ error: err }, 'Failed to start server');
       process.exit(1);
     }
   }

   start();
   ```

3. **Create development script in `apps/api/package.json`:**
   ```json
   {
     "name": "@singr/api",
     "version": "1.0.0",
     "scripts": {
       "dev": "tsx watch src/index.ts",
       "build": "tsc",
       "start": "node dist/index.js",
       "test": "vitest"
     },
     "dependencies": {
       "fastify": "^4.x",
       "@fastify/cors": "^9.x",
       "@fastify/helmet": "^11.x",
       "@fastify/jwt": "^7.x",
       "@fastify/rate-limit": "^9.x",
       "@fastify/swagger": "^8.x",
       "@fastify/swagger-ui": "^3.x",
       "@singr/database": "workspace:*",
       "@singr/auth": "workspace:*",
       "@singr/config": "workspace:*",
       "@singr/shared": "workspace:*",
       "@singr/observability": "workspace:*",
       "ioredis": "^5.x"
     }
   }
   ```

**Deliverables:**
- ✅ Fastify server with core plugins configured
- ✅ JWT authentication decorator
- ✅ Global rate limiting (100 req/min default)
- ✅ CORS configured for allowed origins
- ✅ Helmet security headers
- ✅ Sentry error tracking integrated
- ✅ Health check endpoints (`/healthz`, `/readyz`)
- ✅ Graceful shutdown handling
- ✅ Correlation ID tracking

---

### 3.2 Request Validation with Zod

**Objective:** Type-safe request validation schemas.

**Duration:** 1-2 days  
**Team Size:** 1 developer

**Tasks:**

1. **Create shared validation utilities in `packages/shared/src/validation/index.ts`:**
   ```typescript
   import { z } from 'zod';
   import { FastifyRequest, FastifyReply } from 'fastify';

   export function validateBody<T extends z.ZodTypeAny>(schema: T) {
     return async (request: FastifyRequest, reply: FastifyReply) => {
       const result = schema.safeParse(request.body);

       if (!result.success) {
         return reply.code(400).send({
           type: 'validation_error',
           title: 'Validation Failed',
           detail: 'Request body validation failed',
           errors: result.error.errors.map((e) => ({
             path: e.path.join('.'),
             message: e.message,
             code: e.code,
           })),
         });
       }

       request.body = result.data;
     };
   }

   export function validateQuery<T extends z.ZodTypeAny>(schema: T) {
     return async (request: FastifyRequest, reply: FastifyReply) => {
       const result = schema.safeParse(request.query);

       if (!result.success) {
         return reply.code(400).send({
           type: 'validation_error',
           title: 'Validation Failed',
           detail: 'Query parameter validation failed',
           errors: result.error.errors.map((e) => ({
             path: e.path.join('.'),
             message: e.message,
             code: e.code,
           })),
         });
       }

       request.query = result.data;
     };
   }

   export function validateParams<T extends z.ZodTypeAny>(schema: T) {
     return async (request: FastifyRequest, reply: FastifyReply) => {
       const result = schema.safeParse(request.params);

       if (!result.success) {
         return reply.code(400).send({
           type: 'validation_error',
           title: 'Validation Failed',
           detail: 'Path parameter validation failed',
           errors: result.error.errors.map((e) => ({
             path: e.path.join('.'),
             message: e.message,
             code: e.code,
           })),
         });
       }

       request.params = result.data;
     };
   }
   ```

2. **Create common schemas in `packages/shared/src/validation/schemas.ts`:**
   ```typescript
   import { z } from 'zod';

   // ========== Common Schemas ==========

   export const UUIDSchema = z.string().uuid({
     message: 'Must be a valid UUID',
   });

   export const EmailSchema = z
     .string()
     .email({ message: 'Must be a valid email address' })
     .toLowerCase()
     .trim();

   export const PasswordSchema = z
     .string()
     .min(8, 'Password must be at least 8 characters')
     .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
     .regex(/[a-z]/, 'Must contain at least one lowercase letter')
     .regex(/[0-9]/, 'Must contain at least one number')
     .regex(/[^A-Za-z0-9]/, 'Must contain at least one special character');

   export const PaginationSchema = z.object({
     page: z.coerce.number().int().min(1).default(1),
     limit: z.coerce.number().int().min(1).max(100).default(20),
   });

   export const DateRangeSchema = z.object({
     startDate: z.string().datetime().optional(),
     endDate: z.string().datetime().optional(),
   });

   export const SortOrderSchema = z.enum(['asc', 'desc']).default('asc');

   // ========== Geographic Schemas ==========

   export const LatitudeSchema = z
     .number()
     .min(-90, 'Latitude must be between -90 and 90')
     .max(90, 'Latitude must be between -90 and 90');

   export const LongitudeSchema = z
     .number()
     .min(-180, 'Longitude must be between -180 and 180')
     .max(180, 'Longitude must be between -180 and 180');

   export const LocationSchema = z.object({
     lat: LatitudeSchema,
     lng: LongitudeSchema,
   });

   export const AddressSchema = z.object({
     address: z.string().min(1).max(255),
     city: z.string().min(1).max(100),
     state: z.string().min(2).max(50),
     postalCode: z.string().min(1).max(20),
     country: z.string().max(50).default('USA'),
   });

   // ========== Contact Schemas ==========

   export const PhoneNumberSchema = z
     .string()
     .regex(
       /^\+?[1-9]\d{1,14}$/,
       'Must be a valid phone number in E.164 format'
     )
     .optional();

   export const WebsiteSchema = z
     .string()
     .url({ message: 'Must be a valid URL' })
     .optional();

   // ========== Song Schemas ==========

   export const KeyChangeSchema = z
     .number()
     .int()
     .min(-12, 'Key change must be between -12 and 12')
     .max(12, 'Key change must be between -12 and 12')
     .default(0);

   export const SongSchema = z.object({
     artist: z.string().min(1).max(255),
     title: z.string().min(1).max(255),
     keyChange: KeyChangeSchema,
   });

   // ========== Response Pagination Schema ==========

   export const PaginatedResponseSchema = <T extends z.ZodTypeAny>(
     dataSchema: T
   ) => {
     return z.object({
       data: z.array(dataSchema),
       pagination: z.object({
         page: z.number().int().positive(),
         limit: z.number().int().positive(),
         total: z.number().int().nonnegative(),
         totalPages: z.number().int().nonnegative(),
       }),
     });
   };
   ```

3. **Create validation error types in `packages/shared/src/types/errors.ts`:**
   ```typescript
   export interface ProblemDetails {
     type: string;
     title: string;
     detail: string;
     status?: number;
     instance?: string;
     [key: string]: any;
   }

   export interface ValidationError extends ProblemDetails {
     type: 'validation_error';
     errors: Array<{
       path: string;
       message: string;
       code: string;
     }>;
   }

   export interface AuthenticationError extends ProblemDetails {
     type: 'authentication_failed';
   }

   export interface AuthorizationError extends ProblemDetails {
     type: 'authorization_denied';
   }

   export interface ResourceNotFoundError extends ProblemDetails {
     type: 'resource_not_found';
   }

   export interface ConflictError extends ProblemDetails {
     type: 'conflict';
   }

   export interface RateLimitError extends ProblemDetails {
     type: 'rate_limited';
     retryAfter: number;
   }
   ```

**Deliverables:**
- ✅ Zod validation middleware for body/query/params
- ✅ Problem+JSON error responses for validation failures
- ✅ Common reusable schemas (UUID, Email, Password, Pagination, etc.)
- ✅ Type inference from schemas
- ✅ Geographic and contact validation schemas
- ✅ Consistent error structure across API

---

### 3.3 Route Organization

**Objective:** Modular route structure by domain.

**Duration:** 1 day  
**Team Size:** 1 developer

**Tasks:**

1. **Create route plugin structure:**
   ```
   apps/api/src/routes/
   ├── index.ts              # Register all route plugins
   ├── auth/
   │   ├── index.ts          # Auth route plugin
   │   ├── signin.ts
   │   ├── register.ts
   │   ├── refresh.ts
   │   ├── signout.ts
   │   ├── password.ts
   │   ├── profile.ts
   │   ├── context.ts
   │   └── schemas.ts
   ├── customer/
   │   ├── index.ts
   │   ├── venues.ts
   │   ├── systems.ts
   │   ├── songdb.ts
   │   ├── api-keys.ts
   │   ├── requests.ts
   │   ├── organization.ts
   │   └── schemas.ts
   ├── singer/
   │   ├── index.ts
   │   ├── profile.ts
   │   ├── requests.ts
   │   ├── history.ts
   │   ├── favorites.ts
   │   ├── dashboard.ts
   │   ├── account.ts
   │   └── schemas.ts
   ├── admin/
   │   ├── index.ts
   │   ├── users.ts
   │   ├── roles.ts
   │   ├── organizations.ts
   │   ├── audit.ts
   │   └── schemas.ts
   └── public/
       ├── index.ts
       ├── venues.ts
       ├── songs.ts
       ├── requests.ts
       ├── branding.ts
       └── schemas.ts
   ```

2. **Create route index in `apps/api/src/routes/index.ts`:**
   ```typescript
   import { FastifyInstance, FastifyPluginAsync } from 'fastify';
   import { authRoutes } from './auth';
   import { customerRoutes } from './customer';
   import { singerRoutes } from './singer';
   import { adminRoutes } from './admin';
   import { publicRoutes } from './public';

   export const routes: FastifyPluginAsync = async (server: FastifyInstance) => {
     // Public routes (no authentication required)
     await server.register(publicRoutes, { prefix: '/v1/public' });

     // Authentication routes
     await server.register(authRoutes, { prefix: '/v1/auth' });

     // Customer portal routes
     await server.register(customerRoutes, { prefix: '/v1/customer' });

     // Singer app routes
     await server.register(singerRoutes, { prefix: '/v1/singer' });

     // Admin routes
     await server.register(adminRoutes, { prefix: '/v1/admin' });
   };
   ```

3. **Create example route plugin structure for auth:**
   ```typescript
   // apps/api/src/routes/auth/index.ts
   import { FastifyPluginAsync } from 'fastify';
   import { signinRoute } from './signin';
   import { registerRoute } from './register';
   import { refreshRoute } from './refresh';
   import { signoutRoute } from './signout';
   import { passwordRoute } from './password';
   import { profileRoute } from './profile';
   import { contextRoute } from './context';

   export const authRoutes: FastifyPluginAsync = async (server) => {
     await server.register(signinRoute);
     await server.register(registerRoute);
     await server.register(refreshRoute);
     await server.register(signoutRoute);
     await server.register(passwordRoute);
     await server.register(profileRoute);
     await server.register(contextRoute);
   };
   ```

4. **Create placeholder route files:**
   ```typescript
   // apps/api/src/routes/customer/index.ts
   import { FastifyPluginAsync } from 'fastify';
   // Import individual route files as they're created

   export const customerRoutes: FastifyPluginAsync = async (server) => {
     // Routes will be registered here
     // await server.register(venuesRoute);
     // await server.register(systemsRoute);
     // etc.
   };

   // apps/api/src/routes/singer/index.ts
   import { FastifyPluginAsync } from 'fastify';

   export const singerRoutes: FastifyPluginAsync = async (server) => {
     // Routes will be registered here
   };

   // apps/api/src/routes/admin/index.ts
   import { FastifyPluginAsync } from 'fastify';

   export const adminRoutes: FastifyPluginAsync = async (server) => {
     // Routes will be registered here
   };

   // apps/api/src/routes/public/index.ts
   import { FastifyPluginAsync } from 'fastify';

   export const publicRoutes: FastifyPluginAsync = async (server) => {
     // Routes will be registered here
   };
   ```

5. **Register routes in server:**
   ```typescript
   // Update apps/api/src/server.ts to include routes
   import { routes } from './routes';

   export async function buildServer(): Promise<FastifyInstance> {
     const server = Fastify({
       // ... existing config
     });

     // ... existing middleware setup

     // Register all routes
     await server.register(routes);

     return server;
   }
   ```

**Deliverables:**
- ✅ Modular route plugins by domain
- ✅ Versioned API paths (`/v1/...`)
- ✅ Clear separation of concerns (auth, customer, singer, admin, public)
- ✅ Easy to add new routes
- ✅ Route structure documented
- ✅ Placeholder files ready for implementation

---

### 3.4 Swagger/OpenAPI Documentation

**Objective:** Auto-generate API documentation.

**Duration:** 1-2 days  
**Team Size:** 1 developer

**Tasks:**

1. **Install and configure Swagger in `apps/api/src/server.ts`:**
   ```typescript
   import swagger from '@fastify/swagger';
   import swaggerUi from '@fastify/swagger-ui';

   export async function buildServer(): Promise<FastifyInstance> {
     const server = Fastify({
       // ... existing config
     });

     // ... existing plugins

     // Register Swagger
     await server.register(swagger, {
       openapi: {
         info: {
           title: 'Singr API',
           description: 'Central API for the Singr karaoke platform',
           version: '1.0.0',
           contact: {
             name: 'Singr Support',
             email: 'support@singrkaraoke.com',
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
         components: {
           securitySchemes: {
             bearerAuth: {
               type: 'http',
               scheme: 'bearer',
               bearerFormat: 'JWT',
               description: 'JWT token obtained from /v1/auth/signin',
             },
             apiKey: {
               type: 'apiKey',
               name: 'X-API-Key',
               in: 'header',
               description: 'API key for OpenKJ integration',
             },
           },
         },
         tags: [
           {
             name: 'auth',
             description: 'Authentication and authorization endpoints',
           },
           {
             name: 'public',
             description: 'Public endpoints (no authentication required)',
           },
           {
             name: 'singer',
             description: 'Singer-specific endpoints',
           },
           {
             name: 'customer',
             description: 'Customer portal endpoints',
           },
           {
             name: 'admin',
             description: 'Administrative endpoints',
           },
         ],
       },
     });

     await server.register(swaggerUi, {
       routePrefix: '/docs',
       uiConfig: {
         docExpansion: 'list',
         deepLinking: true,
         displayRequestDuration: true,
       },
       staticCSP: true,
       transformStaticCSP: (header) => header,
     });

     // ... rest of server setup

     return server;
   }
   ```

2. **Add schema example for future routes:**
   ```typescript
   // Example of how to document a route
   server.get(
     '/example',
     {
       schema: {
         tags: ['example'],
         summary: 'Example endpoint',
         description: 'Detailed description of what this endpoint does',
         security: [{ bearerAuth: [] }],
         querystring: {
           type: 'object',
           properties: {
             page: {
               type: 'integer',
               minimum: 1,
               default: 1,
               description: 'Page number for pagination',
             },
             limit: {
               type: 'integer',
               minimum: 1,
               maximum: 100,
               default: 20,
               description: 'Number of items per page',
             },
           },
         },
         response: {
           200: {
             description: 'Successful response',
             type: 'object',
             properties: {
               data: {
                 type: 'array',
                 items: {
                   type: 'object',
                   properties: {
                     id: { type: 'string', format: 'uuid' },
                     name: { type: 'string' },
                   },
                 },
               },
               pagination: {
                 type: 'object',
                 properties: {
                   page: { type: 'integer' },
                   limit: { type: 'integer' },
                   total: { type: 'integer' },
                   totalPages: { type: 'integer' },
                 },
               },
             },
           },
           401: {
             description: 'Unauthorized',
             type: 'object',
             properties: {
               type: { type: 'string' },
               title: { type: 'string' },
               detail: { type: 'string' },
             },
           },
         },
       },
     },
     async (request, reply) => {
       // Handler implementation
     }
   );
   ```

3. **Add script to export OpenAPI spec:**
   ```typescript
   // scripts/export-openapi.ts
   import { buildServer } from '../apps/api/src/server';
   import { writeFileSync } from 'fs';
   import { join } from 'path';

   async function exportOpenAPI() {
     const server = await buildServer();
     await server.ready();

     const spec = server.swagger();

     writeFileSync(
       join(__dirname, '../docs/openapi.json'),
       JSON.stringify(spec, null, 2)
     );
     
     console.log('OpenAPI spec exported to docs/openapi.json');

     await server.close();
   }

   exportOpenAPI();
   ```

**Deliverables:**
- ✅ Swagger UI available at `/docs`
- ✅ OpenAPI 3.0 specification auto-generated
- ✅ Security schemes documented (Bearer JWT, API Key)
- ✅ Tags for route organization
- ✅ Script to export OpenAPI JSON
- ✅ Documentation template for future routes

---
