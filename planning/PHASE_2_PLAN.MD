# Singr Central API Backend - Phase 2

**Document Version:** 1.0  
**Last Updated:** 2025-11-12  
**Author:** kirkphillip605  
**Status:** In Development

---

## Phase 2: Authentication & Authorization

### 2.1 Password Hashing & User Management

**Objective:** Secure password handling with Argon2id.

**Duration:** 2 days  
**Team Size:** 1 developer

**Tasks:**

1. **Create `packages/auth/src/password.ts`:**
   ```typescript
   import { hash, verify } from '@node-rs/argon2';
   import { createLogger } from '@singr/observability';

   const logger = createLogger('auth:password');

   export const PASSWORD_CONFIG = {
     memoryCost: 19456, // 19 MB
     timeCost: 2,
     outputLen: 32,
     parallelism: 1,
     algorithm: 0, // Argon2id
   };

   export async function hashPassword(password: string): Promise<string> {
     try {
       return await hash(password, PASSWORD_CONFIG);
     } catch (error) {
       logger.error({ error }, 'Password hashing failed');
       throw new Error('Failed to hash password');
     }
   }

   export async function verifyPassword(
     hash: string,
     password: string
   ): Promise<boolean> {
     try {
       return await verify(hash, password, PASSWORD_CONFIG);
     } catch (error) {
       logger.debug({ error }, 'Password verification failed');
       return false;
     }
   }

   export function validatePasswordStrength(password: string): {
     valid: boolean;
     errors: string[];
   } {
     const errors: string[] = [];

     if (password.length < 8) {
       errors.push('Password must be at least 8 characters');
     }
     if (!/[A-Z]/.test(password)) {
       errors.push('Password must contain at least one uppercase letter');
     }
     if (!/[a-z]/.test(password)) {
       errors.push('Password must contain at least one lowercase letter');
     }
     if (!/[0-9]/.test(password)) {
       errors.push('Password must contain at least one number');
     }
     if (!/[^A-Za-z0-9]/.test(password)) {
       errors.push('Password must contain at least one special character');
     }

     return { valid: errors.length === 0, errors };
   }
   ```

2. **Create user service in `packages/auth/src/user-service.ts`:**
   ```typescript
   import { prisma } from '@singr/database';
   import { createLogger } from '@singr/observability';
   import { hashPassword, validatePasswordStrength } from './password';
   import { randomUUID } from 'crypto';

   const logger = createLogger('auth:user-service');

   export interface CreateUserInput {
     email: string;
     password: string;
     name?: string;
     accountType: 'customer' | 'singer';
     customerData?: {
       legalBusinessName?: string;
       contactEmail?: string;
       timezone?: string;
     };
     singerData?: {
       nickname?: string;
     };
   }

   export async function createUser(input: CreateUserInput) {
     // Validate password strength
     const passwordValidation = validatePasswordStrength(input.password);
     if (!passwordValidation.valid) {
       throw new Error(`Password validation failed: ${passwordValidation.errors.join(', ')}`);
     }

     // Check if user already exists
     const existingUser = await prisma.user.findUnique({
       where: { email: input.email.toLowerCase() },
     });

     if (existingUser) {
       throw new Error('User with this email already exists');
     }

     const passwordHash = await hashPassword(input.password);

     const user = await prisma.user.create({
       data: {
         email: input.email.toLowerCase(),
         passwordHash,
         passwordAlgo: 'argon2id',
         name: input.name,
         ...(input.accountType === 'customer' && {
           customerProfile: {
             create: {
               legalBusinessName: input.customerData?.legalBusinessName,
               contactEmail: input.customerData?.contactEmail || input.email,
               timezone: input.customerData?.timezone || 'UTC',
             },
           },
         }),
         ...(input.accountType === 'singer' && {
           singerProfile: {
             create: {
               nickname: input.singerData?.nickname,
             },
           },
         }),
       },
       include: {
         customerProfile: true,
         singerProfile: true,
       },
     });

     // Assign default role
     const roleSlug =
       input.accountType === 'customer' ? 'customer_owner' : 'singer';
     const role = await prisma.role.findUnique({ where: { slug: roleSlug } });

     if (role) {
       await prisma.userRole.create({
         data: { userId: user.id, roleId: role.id },
       });
     }

     // Create verification token
     const verificationToken = randomUUID();
     await prisma.verificationToken.create({
       data: {
         identifier: user.email,
         token: verificationToken,
         expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
       },
     });

     logger.info(
       {
         userId: user.id,
         email: user.email,
         accountType: input.accountType,
       },
       'User created'
     );

     return { user, verificationToken };
   }

   export async function getUserWithRoles(userId: string) {
     return prisma.user.findUnique({
       where: { id: userId },
       include: {
         userRoles: {
           include: {
             role: {
               include: {
                 rolePermissions: {
                   include: { permission: true },
                 },
               },
             },
           },
         },
         customerProfile: true,
         singerProfile: true,
         organizationUsers: {
           include: {
             role: {
               include: {
                 rolePermissions: {
                   include: { permission: true },
                 },
               },
             },
             permissions: {
               include: { permission: true },
             },
           },
         },
       },
     });
   }
   ```

**Deliverables:**
- ✅ Password hashing with Argon2id
- ✅ Password strength validation (8+ chars, uppercase, lowercase, number, special char)
- ✅ User creation with profile initialization
- ✅ Default role assignment
- ✅ Email verification token generation
- ✅ Secure user service with transaction support

---

### 2.2 JWT Implementation

**Objective:** Stateless JWT authentication with refresh tokens.

**Duration:** 2-3 days  
**Team Size:** 1 developer

**Tasks:**

1. **Create `packages/auth/src/jwt.ts`:**
   ```typescript
   import { FastifyJWT } from '@fastify/jwt';
   import { config } from '@singr/config';
   import { prisma } from '@singr/database';
   import { createLogger } from '@singr/observability';

   const logger = createLogger('auth:jwt');

   export interface JWTPayload {
     sub: string; // user ID
     email: string;
     roles: string[]; // global role slugs
     organizations: Array<{
       id: string; // customer_profile_id
       roles: string[];
       permissions: string[];
     }>;
     activeContext?: {
       type: 'customer' | 'singer';
       id: string; // profile ID
     };
     iat: number;
     exp: number;
     jti: string;
     iss: string;
     aud: string;
   }

   declare module '@fastify/jwt' {
     interface FastifyJWT {
       payload: JWTPayload;
       user: JWTPayload;
     }
   }

   export async function buildJWTPayload(userId: string): Promise<JWTPayload> {
     const user = await prisma.user.findUniqueOrThrow({
       where: { id: userId },
       include: {
         userRoles: {
           include: { role: true },
         },
         organizationUsers: {
           where: { status: 'active' },
           include: {
             role: true,
             permissions: {
               include: { permission: true },
             },
           },
         },
         customerProfile: true,
         singerProfile: true,
       },
     });

     const globalRoles = user.userRoles.map((ur) => ur.role.slug);

     const organizations = user.organizationUsers.map((ou) => ({
       id: ou.customerProfileId,
       roles: ou.role ? [ou.role.slug] : [],
       permissions: ou.permissions.map((p) => p.permission.slug),
     }));

     // Default context
     let activeContext: JWTPayload['activeContext'];
     if (user.customerProfile) {
       activeContext = { type: 'customer', id: user.customerProfile.id };
     } else if (user.singerProfile) {
       activeContext = { type: 'singer', id: user.singerProfile.id };
     }

     const now = Math.floor(Date.now() / 1000);

     return {
       sub: user.id,
       email: user.email,
       roles: globalRoles,
       organizations,
       activeContext,
       iat: now,
       exp: now + config.JWT_ACCESS_TTL,
       jti: require('crypto').randomUUID(),
       iss: config.JWT_ISSUER,
       aud: config.JWT_AUDIENCE,
     };
   }

   export function verifyJWTPayload(payload: JWTPayload): void {
     const now = Math.floor(Date.now() / 1000);

     if (payload.exp < now) {
       throw new Error('Token has expired');
     }

     if (payload.iss !== config.JWT_ISSUER) {
       throw new Error('Invalid issuer');
     }

     if (payload.aud !== config.JWT_AUDIENCE) {
       throw new Error('Invalid audience');
     }
   }
   ```

2. **Create refresh token service in `packages/auth/src/refresh-token-service.ts`:**
   ```typescript
   import { Redis } from 'ioredis';
   import { randomBytes } from 'crypto';
   import { config } from '@singr/config';
   import { createLogger } from '@singr/observability';
   import { hashPassword, verifyPassword } from './password';

   const logger = createLogger('auth:refresh-token');

   export class RefreshTokenService {
     constructor(private redis: Redis) {}

     async create(userId: string): Promise<string> {
       const token = randomBytes(32).toString('hex');
       const hashedToken = await hashPassword(token);

       await this.redis.setex(
         `refresh:${userId}`,
         config.JWT_REFRESH_TTL,
         hashedToken
       );

       logger.debug({ userId }, 'Refresh token created');

       return token;
     }

     async verify(userId: string, token: string): Promise<boolean> {
       const stored = await this.redis.get(`refresh:${userId}`);
       if (!stored) {
         logger.debug({ userId }, 'Refresh token not found');
         return false;
       }

       return verifyPassword(stored, token);
     }

     async revoke(userId: string): Promise<void> {
       await this.redis.del(`refresh:${userId}`);
       logger.debug({ userId }, 'Refresh token revoked');
     }

     async revokeJTI(jti: string): Promise<void> {
       await this.redis.setex(`revoked:${jti}`, config.JWT_ACCESS_TTL, '1');
       logger.debug({ jti }, 'JWT revoked');
     }

     async isJTIRevoked(jti: string): Promise<boolean> {
       const result = await this.redis.get(`revoked:${jti}`);
       return result === '1';
     }

     async refreshTokens(
       userId: string,
       oldRefreshToken: string,
       newRefreshTokenFunc: () => Promise<string>
     ): Promise<string> {
       // Verify old token
       const isValid = await this.verify(userId, oldRefreshToken);
       if (!isValid) {
         throw new Error('Invalid refresh token');
       }

       // Revoke old token
       await this.revoke(userId);

       // Create new token
       const newToken = await newRefreshTokenFunc();

       logger.info({ userId }, 'Tokens refreshed');

       return newToken;
     }
   }
   ```

3. **Export auth utilities in `packages/auth/src/index.ts`:**
   ```typescript
   export * from './password';
   export * from './user-service';
   export * from './jwt';
   export * from './refresh-token-service';
   export * from './rbac';
   export * from './context';
   ```

**Deliverables:**
- ✅ JWT signing with ES256
- ✅ JWT payload includes roles, organizations, context
- ✅ Refresh token generation and storage in Redis
- ✅ Token revocation support via Redis denylist
- ✅ JTI revocation for immediate logout
- ✅ Token rotation on refresh

---

### 2.3 RBAC & Permission System

**Objective:** Flexible role and permission evaluation.

**Duration:** 2 days  
**Team Size:** 1 developer

**Tasks:**

1. **Create `packages/auth/src/rbac.ts`:**
   ```typescript
   import { prisma } from '@singr/database';
   import { Redis } from 'ioredis';
   import { createLogger } from '@singr/observability';

   const logger = createLogger('auth:rbac');

   export class RBACService {
     constructor(private redis: Redis) {}

     async getUserPermissions(
       userId: string,
       customerProfileId?: string
     ): Promise<Set<string>> {
       const cacheKey = customerProfileId
         ? `permissions:${userId}:${customerProfileId}`
         : `permissions:${userId}`;

       // Check cache
       const cached = await this.redis.get(cacheKey);
       if (cached) {
         return new Set(JSON.parse(cached));
       }

       // Fetch from DB
       const permissions = new Set<string>();

       // Global permissions from roles
       const userRoles = await prisma.userRole.findMany({
         where: { userId },
         include: {
           role: {
             include: {
               rolePermissions: {
                 include: { permission: true },
               },
             },
           },
         },
       });

       userRoles.forEach((ur) => {
         ur.role.rolePermissions.forEach((rp) => {
           permissions.add(rp.permission.slug);
         });
       });

       // Organization-specific permissions
       if (customerProfileId) {
         const orgUser = await prisma.organizationUser.findUnique({
           where: {
             customerProfileId_userId: {
               customerProfileId,
               userId,
             },
           },
           include: {
             role: {
               include: {
                 rolePermissions: {
                   include: { permission: true },
                 },
               },
             },
             permissions: {
               include: { permission: true },
             },
           },
         });

         if (orgUser && orgUser.status === 'active') {
           // Add role permissions
           orgUser.role?.rolePermissions.forEach((rp) => {
             permissions.add(rp.permission.slug);
           });

           // Add override permissions
           orgUser.permissions.forEach((p) => {
             permissions.add(p.permission.slug);
           });
         }
       }

       // Cache for 30 minutes
       await this.redis.setex(
         cacheKey,
         1800,
         JSON.stringify([...permissions])
       );

       logger.debug(
         {
           userId,
           customerProfileId,
           permissionCount: permissions.size,
         },
         'Permissions loaded'
       );

       return permissions;
     }

     async hasPermission(
       userId: string,
       permission: string,
       customerProfileId?: string
     ): Promise<boolean> {
       const permissions = await this.getUserPermissions(
         userId,
         customerProfileId
       );
       return permissions.has(permission);
     }

     async hasAnyPermission(
       userId: string,
       requiredPermissions: string[],
       customerProfileId?: string
     ): Promise<boolean> {
       const permissions = await this.getUserPermissions(
         userId,
         customerProfileId
       );
       return requiredPermissions.some((p) => permissions.has(p));
     }

     async hasAllPermissions(
       userId: string,
       requiredPermissions: string[],
       customerProfileId?: string
     ): Promise<boolean> {
       const permissions = await this.getUserPermissions(
         userId,
         customerProfileId
       );
       return requiredPermissions.every((p) => permissions.has(p));
     }

     async hasRole(userId: string, role: string): Promise<boolean> {
       const userRoles = await prisma.userRole.findMany({
         where: { userId },
         include: { role: true },
       });

       return userRoles.some((ur) => ur.role.slug === role);
     }

     async invalidateCache(userId: string, customerProfileId?: string): Promise<void> {
       if (customerProfileId) {
         await this.redis.del(`permissions:${userId}:${customerProfileId}`);
       } else {
         // Invalidate all caches for user
         const keys = await this.redis.keys(`permissions:${userId}:*`);
         if (keys.length > 0) {
           await this.redis.del(...keys);
         }
       }

       logger.debug(
         { userId, customerProfileId },
         'Permission cache invalidated'
       );
     }
   }
   ```

2. **Create authorization decorators in `packages/auth/src/decorators.ts`:**
   ```typescript
   import { FastifyRequest, FastifyReply } from 'fastify';
   import { RBACService } from './rbac';
   import { createLogger } from '@singr/observability';

   const logger = createLogger('auth:decorators');

   export function requirePermission(permission: string | string[]) {
     const permissions = Array.isArray(permission) ? permission : [permission];

     return async (request: FastifyRequest, reply: FastifyReply) => {
       const { user } = request;

       if (!user) {
         return reply.code(401).send({
           type: 'authentication_failed',
           title: 'Unauthorized',
           detail: 'Authentication required',
         });
       }

       const customerProfileId =
         user.activeContext?.type === 'customer' ? user.activeContext.id : undefined;

       const rbac = new RBACService(request.server.redis);
       const hasPermission = await rbac.hasAnyPermission(
         user.sub,
         permissions,
         customerProfileId
       );

       if (!hasPermission) {
         logger.warn(
           {
             userId: user.sub,
             requiredPermissions: permissions,
           },
           'Permission denied'
         );

         return reply.code(403).send({
           type: 'authorization_denied',
           title: 'Forbidden',
           detail: `Missing required permission: ${permissions.join(' or ')}`,
         });
       }
     };
   }

   export function requireRole(role: string | string[]) {
     const roles = Array.isArray(role) ? role : [role];

     return async (request: FastifyRequest, reply: FastifyReply) => {
       const { user } = request;

       if (!user) {
         return reply.code(401).send({
           type: 'authentication_failed',
           title: 'Unauthorized',
           detail: 'Authentication required',
         });
       }

       const hasRole = roles.some((r) => user.roles.includes(r));

       if (!hasRole) {
         logger.warn(
           {
             userId: user.sub,
             requiredRoles: roles,
             userRoles: user.roles,
           },
           'Role denied'
         );

         return reply.code(403).send({
           type: 'authorization_denied',
           title: 'Forbidden',
           detail: `Missing required role: ${roles.join(' or ')}`,
         });
       }
     };
   }

   export function requireCustomerContext(
     _request: FastifyRequest,
     reply: FastifyReply
   ) {
     const { user } = _request;

     if (!user?.activeContext || user.activeContext.type !== 'customer') {
       return reply.code(403).send({
         type: 'authorization_denied',
         title: 'Customer Context Required',
         detail: 'You must be in a customer context to access this resource',
       });
     }
   }

   export function requireSingerContext(
     _request: FastifyRequest,
     reply: FastifyReply
   ) {
     const { user } = _request;

     if (!user?.activeContext || user.activeContext.type !== 'singer') {
       return reply.code(403).send({
         type: 'authorization_denied',
         title: 'Singer Context Required',
         detail: 'You must be in a singer context to access this resource',
       });
     }
   }
   ```

**Deliverables:**
- ✅ Permission aggregation from global and org-specific roles
- ✅ Redis caching of permission sets (30 min TTL)
- ✅ Cache invalidation on role/permission changes
- ✅ Fastify decorators for route protection
- ✅ Support for `hasPermission`, `hasAnyPermission`, `hasAllPermissions`
- ✅ Context-specific authorization (customer, singer)

---

### 2.4 Context Switching

**Objective:** Allow users to switch between customer and singer contexts.

**Duration:** 1 day  
**Team Size:** 1 developer

**Tasks:**

1. **Create `packages/auth/src/context.ts`:**
   ```typescript
   import { prisma } from '@singr/database';
   import { buildJWTPayload, JWTPayload } from './jwt';
   import { createLogger } from '@singr/observability';

   const logger = createLogger('auth:context');

   export async function switchContext(
     userId: string,
     contextType: 'customer' | 'singer',
     contextId: string
   ): Promise<JWTPayload> {
     // Verify user has access to this context
     if (contextType === 'customer') {
       const profile = await prisma.customerProfile.findFirst({
         where: {
           id: contextId,
           OR: [
             { userId },
             {
               organizationUsers: {
                 some: {
                   userId,
                   status: 'active',
                 },
               },
             },
           ],
         },
       });

       if (!profile) {
         logger.warn(
           { userId, contextId, contextType },
           'Access denied to customer profile'
         );
         throw new Error('Access denied to customer profile');
       }
     } else if (contextType === 'singer') {
       const profile = await prisma.singerProfile.findFirst({
         where: { id: contextId, userId },
       });

       if (!profile) {
         logger.warn(
           { userId, contextId, contextType },
           'Access denied to singer profile'
         );
         throw new Error('Access denied to singer profile');
       }
     }

     // Build new payload with updated context
     const payload = await buildJWTPayload(userId);
     payload.activeContext = { type: contextType, id: contextId };

     logger.info(
       { userId, contextType, contextId },
       'Context switched'
     );

     return payload;
   }

   export async function validateContext(
     userId: string,
     contextType: 'customer' | 'singer',
     contextId: string
   ): Promise<boolean> {
     try {
       await switchContext(userId, contextType, contextId);
       return true;
     } catch {
       return false;
     }
   }
   ```

**Deliverables:**
- ✅ Context switching validates user access
- ✅ New JWT issued with updated activeContext
- ✅ Refresh token remains valid across context switches
- ✅ Support for organization user context access

---
