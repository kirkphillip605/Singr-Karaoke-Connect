# Singr Central API Backend - Phase 4

**Document Version:** 1.0  
**Last Updated:** 2025-11-12  
**Author:** kirkphillip605  
**Status:** In Development

---

## Phase 4: Authentication Endpoints

### 4.1 User Registration

**Objective:** Implement `/v1/auth/register` endpoints for customer and singer registration with email verification.

**Duration:** 2-3 days  
**Team Size:** 1 developer

**Tasks:**

1. **Create registration schemas in `apps/api/src/routes/auth/schemas.ts`:**
   ```typescript
   import { z } from 'zod';
   import { EmailSchema, PasswordSchema } from '@singr/shared/validation';

   export const RegisterSchema = z.object({
     email: EmailSchema,
     password: PasswordSchema,
     name: z.string().min(1).max(255).optional(),
     accountType: z.enum(['customer', 'singer']),
     customerData: z
       .object({
         legalBusinessName: z.string().min(1).max(255).optional(),
         contactEmail: EmailSchema.optional(),
         timezone: z.string().optional(),
       })
       .optional(),
     singerData: z
       .object({
         nickname: z.string().min(1).max(100).optional(),
       })
       .optional(),
   });

   export const SingerRegisterSchema = z.object({
     email: EmailSchema,
     password: PasswordSchema,
     nickname: z.string().min(1).max(100),
   });

   export const RegisterResponseSchema = z.object({
     id: z.string().uuid(),
     email: z.string().email(),
     name: z.string().nullable(),
     accountType: z.enum(['customer', 'singer']),
     message: z.string(),
   });
   ```

2. **Update user service to enqueue emails in `packages/auth/src/user-service.ts`:**
   ```typescript
   import { prisma } from '@singr/database';
   import { createLogger } from '@singr/observability';
   import { hashPassword, validatePasswordStrength } from './password';
   import { randomUUID } from 'crypto';
   import { Queue } from 'bullmq';
   import type { CommunicationJob } from '@singr/shared/types/jobs';

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
     communicationQueue?: Queue<CommunicationJob>;
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

     // Enqueue verification email
     if (input.communicationQueue) {
       await input.communicationQueue.add('email', {
         type: 'email',
         to: user.email,
         toName: user.name || undefined,
         subject: 'Verify your Singr account',
         templateId: parseInt(process.env.MAILJET_TEMPLATE_VERIFICATION || '0'),
         variables: {
           user_name: user.name || user.email.split('@')[0],
           verification_link: `${process.env.APP_URL_WEB}/verify-email?token=${verificationToken}`,
           verification_code: verificationToken.substring(0, 6).toUpperCase(),
           expiry_hours: 24,
         },
       });

       logger.info(
         {
           userId: user.id,
           email: user.email,
         },
         'Verification email enqueued'
       );
     }

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

3. **Implement registration route in `apps/api/src/routes/auth/register.ts`:**
   ```typescript
   import { FastifyPluginAsync } from 'fastify';
   import { validateBody } from '@singr/shared/validation';
   import { RegisterSchema, SingerRegisterSchema } from './schemas';
   import { createUser } from '@singr/auth';
   import { createLogger } from '@singr/observability';
   import { createCommunicationQueue } from '@singr/shared/queues/communication-queue';

   const logger = createLogger('routes:auth:register');

   export const registerRoute: FastifyPluginAsync = async (server) => {
     const communicationQueue = createCommunicationQueue(server.redis);

     // General registration endpoint
     server.post(
       '/register',
       {
         schema: {
           tags: ['auth'],
           summary: 'Register new user',
           description: 'Create a new customer or singer account with email verification',
           body: {
             type: 'object',
             required: ['email', 'password', 'accountType'],
             properties: {
               email: { type: 'string', format: 'email' },
               password: { type: 'string', minLength: 8 },
               name: { type: 'string' },
               accountType: { type: 'string', enum: ['customer', 'singer'] },
               customerData: {
                 type: 'object',
                 properties: {
                   legalBusinessName: { type: 'string' },
                   contactEmail: { type: 'string', format: 'email' },
                   timezone: { type: 'string' },
                 },
               },
               singerData: {
                 type: 'object',
                 properties: {
                   nickname: { type: 'string' },
                 },
               },
             },
           },
           response: {
             201: {
               description: 'User created successfully',
               type: 'object',
               properties: {
                 id: { type: 'string', format: 'uuid' },
                 email: { type: 'string' },
                 accountType: { type: 'string' },
                 message: { type: 'string' },
               },
             },
             409: {
               description: 'User already exists',
               type: 'object',
               properties: {
                 type: { type: 'string' },
                 title: { type: 'string' },
                 detail: { type: 'string' },
               },
             },
           },
         },
         preHandler: [validateBody(RegisterSchema)],
         config: {
           rateLimit: {
             max: 3,
             timeWindow: '1 hour',
           },
         },
       },
       async (request, reply) => {
         const body = request.body as z.infer<typeof RegisterSchema>;

         try {
           const { user } = await createUser({
             email: body.email,
             password: body.password,
             name: body.name,
             accountType: body.accountType,
             customerData: body.customerData,
             singerData: body.singerData,
             communicationQueue,
           });

           logger.info(
             {
               userId: user.id,
               email: user.email,
               accountType: body.accountType,
             },
             'User registered'
           );

           return reply.code(201).send({
             id: user.id,
             email: user.email,
             name: user.name,
             accountType: body.accountType,
             message:
               'Registration successful. Please check your email to verify your account.',
           });
         } catch (error) {
           if (error instanceof Error) {
             if (error.message.includes('already exists')) {
               return reply.code(409).send({
                 type: 'conflict',
                 title: 'User Already Exists',
                 detail: 'A user with this email already exists',
               });
             }

             if (error.message.includes('Password validation failed')) {
               return reply.code(400).send({
                 type: 'validation_error',
                 title: 'Invalid Password',
                 detail: error.message,
               });
             }
           }

           throw error;
         }
       }
     );

     // Lightweight singer registration
     server.post(
       '/register/singer',
       {
         schema: {
           tags: ['auth'],
           summary: 'Quick singer registration',
           description: 'Streamlined registration for singer users with email verification',
           body: {
             type: 'object',
             required: ['email', 'password', 'nickname'],
             properties: {
               email: { type: 'string', format: 'email' },
               password: { type: 'string', minLength: 8 },
               nickname: { type: 'string', minLength: 1, maxLength: 100 },
             },
           },
           response: {
             201: {
               description: 'Singer created successfully',
               type: 'object',
               properties: {
                 id: { type: 'string', format: 'uuid' },
                 email: { type: 'string' },
                 nickname: { type: 'string' },
                 message: { type: 'string' },
               },
             },
           },
         },
         preHandler: [validateBody(SingerRegisterSchema)],
         config: {
           rateLimit: {
             max: 5,
             timeWindow: '1 hour',
           },
         },
       },
       async (request, reply) => {
         const { email, password, nickname } = request.body as z.infer<
           typeof SingerRegisterSchema
         >;

         try {
           const { user } = await createUser({
             email,
             password,
             accountType: 'singer',
             singerData: { nickname },
             communicationQueue,
           });

           logger.info({ userId: user.id, email }, 'Singer registered');

           return reply.code(201).send({
             id: user.id,
             email: user.email,
             nickname,
             message:
               'Registration successful. Please check your email to verify your account.',
           });
         } catch (error) {
           if (error instanceof Error && error.message.includes('already exists')) {
             return reply.code(409).send({
               type: 'conflict',
               title: 'User Already Exists',
               detail: 'A user with this email already exists',
             });
           }

           throw error;
         }
       }
     );
   };
   ```

**Deliverables:**
- ✅ `POST /v1/auth/register` - General registration endpoint
- ✅ `POST /v1/auth/register/singer` - Streamlined singer registration
- ✅ Rate limiting (3-5 req/hour per IP)
- ✅ Duplicate email detection
- ✅ Profile creation based on account type
- ✅ Verification token generation
- ✅ Email verification queued via BullMQ
- ✅ Mailjet template integration
- ✅ 24-hour verification token expiry
- ✅ OpenAPI documentation
- ✅ Comprehensive error handling

---

### 4.2 Sign In & Token Issuance

**Objective:** Implement credential-based authentication with JWT.

**Duration:** 2 days  
**Team Size:** 1 developer

**Tasks:**

1. **Create sign-in schemas:**
   ```typescript
   // Add to apps/api/src/routes/auth/schemas.ts
   export const SignInSchema = z.object({
     email: EmailSchema,
     password: z.string().min(1, 'Password is required'),
   });

   export const SignInResponseSchema = z.object({
     accessToken: z.string(),
     refreshToken: z.string(),
     expiresIn: z.number(),
     tokenType: z.literal('Bearer'),
     user: z.object({
       id: z.string().uuid(),
       email: z.string().email(),
       name: z.string().nullable(),
       roles: z.array(z.string()),
     }),
   });
   ```

2. **Implement sign-in route in `apps/api/src/routes/auth/signin.ts`:**
   ```typescript
   import { FastifyPluginAsync } from 'fastify';
   import { validateBody } from '@singr/shared/validation';
   import { SignInSchema } from './schemas';
   import { verifyPassword, buildJWTPayload, RefreshTokenService } from '@singr/auth';
   import { config } from '@singr/config';
   import { createLogger } from '@singr/observability';

   const logger = createLogger('routes:auth:signin');

   export const signinRoute: FastifyPluginAsync = async (server) => {
     server.post(
       '/signin',
       {
         schema: {
           tags: ['auth'],
           summary: 'Sign in',
           description: 'Authenticate with email and password to receive JWT tokens',
           body: {
             type: 'object',
             required: ['email', 'password'],
             properties: {
               email: { type: 'string', format: 'email' },
               password: { type: 'string' },
             },
           },
           response: {
             200: {
               description: 'Authentication successful',
               type: 'object',
               properties: {
                 accessToken: { type: 'string' },
                 refreshToken: { type: 'string' },
                 expiresIn: { type: 'number' },
                 tokenType: { type: 'string' },
                 user: {
                   type: 'object',
                   properties: {
                     id: { type: 'string', format: 'uuid' },
                     email: { type: 'string' },
                     name: { type: 'string' },
                     roles: { type: 'array', items: { type: 'string' } },
                   },
                 },
               },
             },
             401: {
               description: 'Invalid credentials',
               type: 'object',
               properties: {
                 type: { type: 'string' },
                 title: { type: 'string' },
                 detail: { type: 'string' },
               },
             },
           },
         },
         preHandler: [validateBody(SignInSchema)],
         config: {
           rateLimit: {
             max: 5,
             timeWindow: '1 minute',
           },
         },
       },
       async (request, reply) => {
         const { email, password } = request.body as z.infer<typeof SignInSchema>;

         // Find user
         const user = await server.prisma.user.findUnique({
           where: { email: email.toLowerCase() },
           include: {
             userRoles: {
               include: { role: true },
             },
           },
         });

         if (!user || !user.passwordHash) {
           logger.warn({ email }, 'Sign in attempt with invalid email');
           return reply.code(401).send({
             type: 'authentication_failed',
             title: 'Invalid Credentials',
             detail: 'Email or password is incorrect',
           });
         }

         // Verify password
         const validPassword = await verifyPassword(user.passwordHash, password);
         if (!validPassword) {
           logger.warn({ email, userId: user.id }, 'Sign in attempt with invalid password');
           return reply.code(401).send({
             type: 'authentication_failed',
             title: 'Invalid Credentials',
             detail: 'Email or password is incorrect',
           });
         }

         // Check email verification
         if (!user.isEmailVerified) {
           logger.warn({ email, userId: user.id }, 'Sign in attempt with unverified email');
           return reply.code(403).send({
             type: 'email_not_verified',
             title: 'Email Not Verified',
             detail: 'Please verify your email before signing in',
           });
         }

         // Build JWT payload
         const payload = await buildJWTPayload(user.id);
         const accessToken = server.jwt.sign(payload);

         // Create refresh token
         const refreshTokenService = new RefreshTokenService(server.redis);
         const refreshToken = await refreshTokenService.create(user.id);

         // Update last login
         await server.prisma.user.update({
           where: { id: user.id },
           data: { lastLoginAt: new Date() },
         });

         logger.info({ userId: user.id, email: user.email }, 'User signed in');

         return reply.send({
           accessToken,
           refreshToken,
           expiresIn: config.JWT_ACCESS_TTL,
           tokenType: 'Bearer',
           user: {
             id: user.id,
             email: user.email,
             name: user.name,
             roles: user.userRoles.map((ur) => ur.role.slug),
           },
         });
       }
     );
   };
   ```

**Deliverables:**
- ✅ `POST /v1/auth/signin` - Credential authentication
- ✅ Password verification with Argon2
- ✅ Email verification check
- ✅ JWT access token issuance
- ✅ Refresh token generation
- ✅ Rate limiting (5 req/min per IP)
- ✅ Last login timestamp update
- ✅ Comprehensive logging

---

### 4.3 Token Refresh & Revocation

**Objective:** Implement token lifecycle management.

**Duration:** 1-2 days  
**Team Size:** 1 developer

**Tasks:**

1. **Create refresh schemas:**
   ```typescript
   // Add to apps/api/src/routes/auth/schemas.ts
   export const RefreshTokenSchema = z.object({
     refreshToken: z.string().min(1, 'Refresh token is required'),
   });
   ```

2. **Implement token refresh in `apps/api/src/routes/auth/refresh.ts`:**
   ```typescript
   import { FastifyPluginAsync } from 'fastify';
   import { validateBody } from '@singr/shared/validation';
   import { RefreshTokenSchema } from './schemas';
   import { buildJWTPayload, RefreshTokenService } from '@singr/auth';
   import { config } from '@singr/config';
   import { createLogger } from '@singr/observability';

   const logger = createLogger('routes:auth:refresh');

   export const refreshRoute: FastifyPluginAsync = async (server) => {
     server.post(
       '/refresh',
       {
         schema: {
           tags: ['auth'],
           summary: 'Refresh access token',
           description: 'Exchange refresh token for new access and refresh tokens',
           body: {
             type: 'object',
             required: ['refreshToken'],
             properties: {
               refreshToken: { type: 'string' },
             },
           },
           response: {
             200: {
               description: 'Tokens refreshed successfully',
               type: 'object',
               properties: {
                 accessToken: { type: 'string' },
                 refreshToken: { type: 'string' },
                 expiresIn: { type: 'number' },
                 tokenType: { type: 'string' },
               },
             },
             401: {
               description: 'Invalid or expired refresh token',
             },
           },
         },
         preHandler: [validateBody(RefreshTokenSchema)],
         config: {
           rateLimit: {
             max: 10,
             timeWindow: '1 minute',
           },
         },
       },
       async (request, reply) => {
         const { refreshToken } = request.body as z.infer<typeof RefreshTokenSchema>;

         // Extract user ID from Authorization header (may be expired)
         let userId: string;
         try {
           const authHeader = request.headers.authorization;
           if (!authHeader?.startsWith('Bearer ')) {
             throw new Error('Missing authorization header');
           }

           const token = authHeader.substring(7);
           const decoded = server.jwt.decode(token) as any;
           userId = decoded.sub;
         } catch (error) {
           logger.warn('Failed to extract user ID from token');
           return reply.code(401).send({
             type: 'authentication_failed',
             title: 'Invalid Token',
             detail: 'Cannot refresh token',
           });
         }

         // Verify refresh token
         const refreshTokenService = new RefreshTokenService(server.redis);
         const valid = await refreshTokenService.verify(userId, refreshToken);

         if (!valid) {
           logger.warn({ userId }, 'Invalid refresh token attempt');
           return reply.code(401).send({
             type: 'authentication_failed',
             title: 'Invalid Refresh Token',
             detail: 'Refresh token is invalid or expired',
           });
         }

         // Issue new tokens
         const payload = await buildJWTPayload(userId);
         const accessToken = server.jwt.sign(payload);
         const newRefreshToken = await refreshTokenService.create(userId);

         logger.info({ userId }, 'Tokens refreshed');

         return reply.send({
           accessToken,
           refreshToken: newRefreshToken,
           expiresIn: config.JWT_ACCESS_TTL,
           tokenType: 'Bearer',
         });
       }
     );
   };
   ```

3. **Implement sign out in `apps/api/src/routes/auth/signout.ts`:**
   ```typescript
   import { FastifyPluginAsync } from 'fastify';
   import { RefreshTokenService } from '@singr/auth';
   import { createLogger } from '@singr/observability';

   const logger = createLogger('routes:auth:signout');

   export const signoutRoute: FastifyPluginAsync = async (server) => {
     server.post(
       '/signout',
       {
         schema: {
           tags: ['auth'],
           summary: 'Sign out',
           description: 'Revoke refresh token and blacklist current JWT',
           security: [{ bearerAuth: [] }],
           response: {
             200: {
               description: 'Signed out successfully',
               type: 'object',
               properties: {
                 message: { type: 'string' },
               },
             },
           },
         },
         preHandler: [server.authenticate],
         config: {
           rateLimit: {
             max: 30,
             timeWindow: '1 minute',
           },
         },
       },
       async (request, reply) => {
         const refreshTokenService = new RefreshTokenService(server.redis);

         // Revoke refresh token
         await refreshTokenService.revoke(request.user.sub);

         // Revoke current JWT
         await refreshTokenService.revokeJTI(request.user.jti);

         logger.info({ userId: request.user.sub }, 'User signed out');

         return reply.send({ message: 'Signed out successfully' });
       }
     );
   };
   ```

**Deliverables:**
- ✅ `POST /v1/auth/refresh` - Token refresh endpoint
- ✅ `POST /v1/auth/signout` - Sign out with token revocation
- ✅ Refresh token rotation
- ✅ JTI revocation for immediate logout
- ✅ Rate limiting on refresh (10/min)

---

### 4.4 Password Reset Flow

**Objective:** Secure password reset via email verification with Mailjet integration.

**Duration:** 2 days  
**Team Size:** 1 developer

**Tasks:**

1. **Create password reset schemas:**
   ```typescript
   // Add to apps/api/src/routes/auth/schemas.ts
   export const ForgotPasswordSchema = z.object({
     email: EmailSchema,
   });

   export const ResetPasswordSchema = z.object({
     token: z.string().uuid('Invalid token format'),
     newPassword: PasswordSchema,
   });

   export const VerifyEmailSchema = z.object({
     token: z.string().uuid('Invalid token format'),
   });
   ```

2. **Implement password reset routes in `apps/api/src/routes/auth/password.ts`:**
   ```typescript
   import { FastifyPluginAsync } from 'fastify';
   import { validateBody } from '@singr/shared/validation';
   import {
     ForgotPasswordSchema,
     ResetPasswordSchema,
     VerifyEmailSchema,
   } from './schemas';
   import { hashPassword, RefreshTokenService } from '@singr/auth';
   import { randomUUID } from 'crypto';
   import { createLogger } from '@singr/observability';
   import { createCommunicationQueue } from '@singr/shared/queues/communication-queue';
   import { config, TOKEN_EXPIRY } from '@singr/config';

   const logger = createLogger('routes:auth:password');

   export const passwordRoute: FastifyPluginAsync = async (server) => {
     const communicationQueue = createCommunicationQueue(server.redis);

     // Request password reset
     server.post(
       '/password/forgot',
       {
         schema: {
           tags: ['auth'],
           summary: 'Request password reset',
           description: 'Send password reset email with verification token',
           body: {
             type: 'object',
             required: ['email'],
             properties: {
               email: { type: 'string', format: 'email' },
             },
           },
           response: {
             200: {
               description: 'Reset email sent (or user not found)',
               type: 'object',
               properties: {
                 message: { type: 'string' },
               },
             },
           },
         },
         preHandler: [validateBody(ForgotPasswordSchema)],
         config: {
           rateLimit: {
             max: 5,
             timeWindow: '1 hour',
           },
         },
       },
       async (request, reply) => {
         const { email } = request.body as z.infer<typeof ForgotPasswordSchema>;

         const user = await server.prisma.user.findUnique({
           where: { email: email.toLowerCase() },
         });

         // Don't reveal if user exists
         if (!user) {
           logger.debug({ email }, 'Password reset requested for non-existent user');
           return reply.send({
             message: 'If an account exists, a reset link has been sent',
           });
         }

         // Delete any existing reset tokens
         await server.prisma.verificationToken.deleteMany({
           where: { identifier: user.email },
         });

         // Create reset token
         const resetToken = randomUUID();
         await server.prisma.verificationToken.create({
           data: {
             identifier: user.email,
             token: resetToken,
             expiresAt: new Date(Date.now() + TOKEN_EXPIRY.PASSWORD_RESET),
           },
         });

         // Enqueue password reset email
         await communicationQueue.add('email', {
           type: 'email',
           to: user.email,
           toName: user.name || undefined,
           subject: 'Reset your Singr password',
           templateId: config.MAILJET_TEMPLATE_PASSWORD_RESET,
           variables: {
             user_name: user.name || user.email.split('@')[0],
             reset_link: `${config.APP_URL_WEB}/reset-password?token=${resetToken}`,
             expiry_minutes: Math.floor(TOKEN_EXPIRY.PASSWORD_RESET / (1000 * 60)),
           },
         });

         logger.info({ userId: user.id, email: user.email }, 'Password reset requested');

         return reply.send({
           message: 'If an account exists, a reset link has been sent',
         });
       }
     );

     // Reset password with token
     server.post(
       '/password/reset',
       {
         schema: {
           tags: ['auth'],
           summary: 'Reset password',
           description: 'Reset password using verification token',
           body: {
             type: 'object',
             required: ['token', 'newPassword'],
             properties: {
               token: { type: 'string', format: 'uuid' },
               newPassword: { type: 'string', minLength: 8 },
             },
           },
           response: {
             200: {
               description: 'Password reset successful',
               type: 'object',
               properties: {
                 message: { type: 'string' },
               },
             },
             400: {
               description: 'Invalid or expired token',
             },
           },
         },
         preHandler: [validateBody(ResetPasswordSchema)],
         config: {
           rateLimit: {
             max: 5,
             timeWindow: '1 hour',
           },
         },
       },
       async (request, reply) => {
         const { token, newPassword } = request.body as z.infer<
           typeof ResetPasswordSchema
         >;

         // Find valid token
         const verificationToken = await server.prisma.verificationToken.findFirst({
           where: {
             token,
             expiresAt: { gt: new Date() },
           },
         });

         if (!verificationToken) {
           logger.warn({ token }, 'Invalid or expired password reset token');
           return reply.code(400).send({
             type: 'invalid_token',
             title: 'Invalid or Expired Token',
             detail: 'Password reset token is invalid or has expired',
           });
         }

         // Find user
         const user = await server.prisma.user.findUnique({
           where: { email: verificationToken.identifier },
         });

         if (!user) {
           return reply.code(404).send({
             type: 'resource_not_found',
             title: 'User Not Found',
             detail: 'No user found with this email',
           });
         }

         // Update password
         const newPasswordHash = await hashPassword(newPassword);
         await server.prisma.user.update({
           where: { id: user.id },
           data: {
             passwordHash: newPasswordHash,
             passwordAlgo: 'argon2id',
           },
         });

         // Delete token
         await server.prisma.verificationToken.delete({
           where: {
             identifier_token: {
               identifier: verificationToken.identifier,
               token: verificationToken.token,
             },
           },
         });

         // Revoke all sessions
         const refreshTokenService = new RefreshTokenService(server.redis);
         await refreshTokenService.revoke(user.id);

         // Send confirmation email
         await communicationQueue.add('email', {
           type: 'email',
           to: user.email,
           toName: user.name || undefined,
           subject: 'Your Singr password has been reset',
           htmlPart: `
             <h2>Password Reset Successful</h2>
             <p>Hello ${user.name || 'there'},</p>
             <p>Your password has been successfully reset.</p>
             <p>If you did not perform this action, please contact support immediately.</p>
             <p><a href="${config.APP_URL_WEB}/signin">Sign in to your account</a></p>
           `,
           textPart: `Your password has been successfully reset. If you did not perform this action, please contact support immediately.`,
         });

         logger.info({ userId: user.id }, 'Password reset completed');

         return reply.send({
           message:
             'Password reset successful. Please sign in with your new password.',
         });
       }
     );

     // Verify email
     server.post(
       '/verify-email',
       {
         schema: {
           tags: ['auth'],
           summary: 'Verify email address',
           description: 'Verify email using verification token',
           body: {
             type: 'object',
             required: ['token'],
             properties: {
               token: { type: 'string', format: 'uuid' },
             },
           },
           response: {
             200: {
               description: 'Email verified successfully',
               type: 'object',
               properties: {
                 message: { type: 'string' },
               },
             },
           },
         },
         preHandler: [validateBody(VerifyEmailSchema)],
       },
       async (request, reply) => {
         const { token } = request.body as z.infer<typeof VerifyEmailSchema>;

         // Find valid token
         const verificationToken = await server.prisma.verificationToken.findFirst({
           where: {
             token,
             expiresAt: { gt: new Date() },
           },
         });

         if (!verificationToken) {
           return reply.code(400).send({
             type: 'invalid_token',
             title: 'Invalid or Expired Token',
             detail: 'Email verification token is invalid or has expired',
           });
         }

         // Update user
         const user = await server.prisma.user.update({
           where: { email: verificationToken.identifier },
           data: { isEmailVerified: true },
         });

         // Delete token
         await server.prisma.verificationToken.delete({
           where: {
             identifier_token: {
               identifier: verificationToken.identifier,
               token: verificationToken.token,
             },
           },
         });

         // Send welcome email
         const accountType = user.customerProfile ? 'customer' : 'singer';
         await communicationQueue.add('email', {
           type: 'email',
           to: user.email,
           toName: user.name || undefined,
           subject: 'Welcome to Singr!',
           templateId: config.MAILJET_TEMPLATE_WELCOME,
           variables: {
             user_name: user.name || user.email.split('@')[0],
             account_type: accountType,
             dashboard_link:
               accountType === 'customer'
                 ? config.APP_URL_CUSTOMER
                 : config.APP_URL_WEB,
           },
         });

         logger.info({ userId: user.id, email: user.email }, 'Email verified');

         return reply.send({
           message: 'Email verified successfully',
         });
       }
     );

     // Resend verification email
     server.post(
       '/verify-email/resend',
       {
         schema: {
           tags: ['auth'],
           summary: 'Resend verification email',
           description: 'Request a new email verification token',
           body: {
             type: 'object',
             required: ['email'],
             properties: {
               email: { type: 'string', format: 'email' },
             },
           },
           response: {
             200: {
               description: 'Verification email sent',
               type: 'object',
               properties: {
                 message: { type: 'string' },
               },
             },
           },
         },
         preHandler: [validateBody(ForgotPasswordSchema)],
         config: {
           rateLimit: {
             max: 3,
             timeWindow: '1 hour',
           },
         },
       },
       async (request, reply) => {
         const { email } = request.body as z.infer<typeof ForgotPasswordSchema>;

         const user = await server.prisma.user.findUnique({
           where: { email: email.toLowerCase() },
         });

         // Don't reveal if user exists
         if (!user) {
           return reply.send({
             message: 'If an account exists, a verification email has been sent',
           });
         }

         if (user.isEmailVerified) {
           return reply.send({
             message: 'Email is already verified',
           });
         }

         // Delete old tokens
         await server.prisma.verificationToken.deleteMany({
           where: { identifier: email },
         });

         // Create new token
         const verificationToken = randomUUID();
         await server.prisma.verificationToken.create({
           data: {
             identifier: email.toLowerCase(),
             token: verificationToken,
             expiresAt: new Date(Date.now() + TOKEN_EXPIRY.EMAIL_VERIFICATION),
           },
         });

         // Enqueue verification email
         await communicationQueue.add('email', {
           type: 'email',
           to: user.email,
           toName: user.name || undefined,
           subject: 'Verify your Singr account',
           templateId: config.MAILJET_TEMPLATE_VERIFICATION,
           variables: {
             user_name: user.name || user.email.split('@')[0],
             verification_link: `${config.APP_URL_WEB}/verify-email?token=${verificationToken}`,
             verification_code: verificationToken.substring(0, 6).toUpperCase(),
             expiry_hours: Math.floor(TOKEN_EXPIRY.EMAIL_VERIFICATION / (1000 * 60 * 60)),
           },
         });

         logger.info({ userId: user.id }, 'Verification email resent');

         return reply.send({
           message: 'If an account exists, a verification email has been sent',
         });
       }
     );
   };
   ```

**Deliverables:**
- ✅ `POST /v1/auth/password/forgot` - Request password reset
- ✅ `POST /v1/auth/password/reset` - Complete password reset
- ✅ `POST /v1/auth/verify-email` - Verify email address
- ✅ `POST /v1/auth/verify-email/resend` - Resend verification
- ✅ Secure token handling with expiration
- ✅ Session revocation on password reset
- ✅ Rate limiting on all endpoints
- ✅ Email notifications via Mailjet
- ✅ Welcome email sent after verification
- ✅ Confirmation email after password reset
- ✅ BullMQ queue integration
- ✅ Token cleanup after use
- ✅ Privacy-preserving responses (don't reveal user existence)

---

### 4.5 User Profile & Context Management

**Objective:** Endpoints for retrieving user profile and switching contexts.

**Duration:** 1-2 days  
**Team Size:** 1 developer

**Tasks:**

1. **Create profile and context schemas:**
   ```typescript
   // Add to apps/api/src/routes/auth/schemas.ts
   export const SwitchContextSchema = z.object({
     contextType: z.enum(['customer', 'singer']),
     contextId: z.string().uuid(),
   });

   export const UserProfileSchema = z.object({
     id: z.string().uuid(),
     email: z.string().email(),
     name: z.string().nullable(),
     displayName: z.string().nullable(),
     phoneNumber: z.string().nullable(),
     imageUrl: z.string().url().nullable(),
     isEmailVerified: z.boolean(),
     roles: z.array(z.string()),
     activeContext: z
       .object({
         type: z.enum(['customer', 'singer']),
         id: z.string().uuid(),
       })
       .nullable(),
     customerProfile: z
       .object({
         id: z.string().uuid(),
         legalBusinessName: z.string().nullable(),
         dbaName: z.string().nullable(),
       })
       .nullable(),
     singerProfile: z
       .object({
         id: z.string().uuid(),
         nickname: z.string().nullable(),
         avatarUrl: z.string().url().nullable(),
       })
       .nullable(),
     organizations: z.array(
       z.object({
         id: z.string().uuid(),
         name: z.string(),
         role: z.string(),
         status: z.string(),
       })
     ),
   });
   ```

2. **Implement profile route in `apps/api/src/routes/auth/profile.ts`:**
   ```typescript
   import { FastifyPluginAsync } from 'fastify';
   import { createLogger } from '@singr/observability';

   const logger = createLogger('routes:auth:profile');

   export const profileRoute: FastifyPluginAsync = async (server) => {
     server.get(
       '/profile',
       {
         schema: {
           tags: ['auth'],
           summary: 'Get user profile',
           description: 'Retrieve current user profile with roles and contexts',
           security: [{ bearerAuth: [] }],
           response: {
             200: {
               description: 'User profile',
               type: 'object',
               properties: {
                 id: { type: 'string', format: 'uuid' },
                 email: { type: 'string' },
                 name: { type: 'string' },
                 roles: { type: 'array', items: { type: 'string' } },
                 activeContext: {
                   type: 'object',
                   properties: {
                     type: { type: 'string' },
                     id: { type: 'string' },
                   },
                 },
               },
             },
           },
         },
         preHandler: [server.authenticate],
         config: {
           rateLimit: {
             max: 30,
             timeWindow: '1 minute',
           },
         },
       },
       async (request, reply) => {
         const userId = request.user.sub;

         const user = await server.prisma.user.findUnique({
           where: { id: userId },
           include: {
             customerProfile: true,
             singerProfile: true,
             userRoles: {
               include: { role: true },
             },
             organizationUsers: {
               where: { status: 'active' },
               include: {
                 customerProfile: true,
                 role: true,
               },
             },
           },
         });

         if (!user) {
           return reply.code(404).send({
             type: 'resource_not_found',
             title: 'User Not Found',
             detail: 'User profile not found',
           });
         }

         return reply.send({
           id: user.id,
           email: user.email,
           name: user.name,
           displayName: user.displayName,
           phoneNumber: user.phoneNumber,
           imageUrl: user.imageUrl,
           isEmailVerified: user.isEmailVerified,
           roles: user.userRoles.map((ur) => ur.role.slug),
           activeContext: request.user.activeContext || null,
           customerProfile: user.customerProfile
             ? {
                 id: user.customerProfile.id,
                 legalBusinessName: user.customerProfile.legalBusinessName,
                 dbaName: user.customerProfile.dbaName,
               }
             : null,
           singerProfile: user.singerProfile
             ? {
                 id: user.singerProfile.id,
                 nickname: user.singerProfile.nickname,
                 avatarUrl: user.singerProfile.avatarUrl,
               }
             : null,
           organizations: user.organizationUsers.map((ou) => ({
             id: ou.customerProfile.id,
             name:
               ou.customerProfile.dbaName ||
               ou.customerProfile.legalBusinessName ||
               'Organization',
             role: ou.role?.slug || 'member',
             status: ou.status,
           })),
         });
       }
     );
   };
   ```

3. **Implement context switching in `apps/api/src/routes/auth/context.ts`:**
   ```typescript
   import { FastifyPluginAsync } from 'fastify';
   import { validateBody } from '@singr/shared/validation';
   import { SwitchContextSchema } from './schemas';
   import { switchContext } from '@singr/auth';
   import { config } from '@singr/config';
   import { createLogger } from '@singr/observability';

   const logger = createLogger('routes:auth:context');

   export const contextRoute: FastifyPluginAsync = async (server) => {
     server.post(
       '/context',
       {
         schema: {
           tags: ['auth'],
           summary: 'Switch context',
           description:
             'Switch between customer and singer contexts, returns new JWT',
           security: [{ bearerAuth: [] }],
           body: {
             type: 'object',
             required: ['contextType', 'contextId'],
             properties: {
               contextType: { type: 'string', enum: ['customer', 'singer'] },
               contextId: { type: 'string', format: 'uuid' },
             },
           },
           response: {
             200: {
               description: 'Context switched successfully',
               type: 'object',
               properties: {
                 accessToken: { type: 'string' },
                 expiresIn: { type: 'number' },
                 tokenType: { type: 'string' },
               },
             },
             403: {
               description: 'Access denied to requested context',
             },
           },
         },
         preHandler: [server.authenticate, validateBody(SwitchContextSchema)],
         config: {
           rateLimit: {
             max: 10,
             timeWindow: '1 minute',
           },
         },
       },
       async (request, reply) => {
         const { contextType, contextId } = request.body as z.infer<
           typeof SwitchContextSchema
         >;

         try {
           const payload = await switchContext(
             request.user.sub,
             contextType,
             contextId
           );

           const accessToken = server.jwt.sign(payload);

           logger.info(
             {
               userId: request.user.sub,
               contextType,
               contextId,
             },
             'Context switched'
           );

           return reply.send({
             accessToken,
             expiresIn: config.JWT_ACCESS_TTL,
             tokenType: 'Bearer',
           });
         } catch (error) {
           if (error instanceof Error) {
             logger.warn(
               {
                 userId: request.user.sub,
                 contextType,
                 contextId,
                 error: error.message,
               },
               'Context switch denied'
             );

             return reply.code(403).send({
               type: 'authorization_denied',
               title: 'Access Denied',
               detail: error.message,
             });
           }

           throw error;
         }
       }
     );
   };
   ```

**Deliverables:**
- ✅ `GET /v1/auth/profile` - Get current user profile
- ✅ `POST /v1/auth/context` - Switch context (customer/singer)
- ✅ Profile includes roles, organizations, and both profile types
- ✅ Context switching validates access
- ✅ New JWT issued with updated context
- ✅ Refresh token remains valid

---

## Phase 4.6: Magic Link & 2FA Authentication

**Objective:** Implement passwordless magic link authentication and two-factor authentication (TOTP and SMS).

**Duration:** 4-5 days  
**Team Size:** 1-2 developers

### 4.6.1 Database Schema for 2FA

**Tasks:**

1. **Create migration for 2FA tables (`packages/database/prisma/migrations/0003_two_factor.sql`):**
   ```sql
   -- Two-factor authentication settings
   CREATE TABLE two_factor_settings (
     two_factor_settings_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     users_id UUID NOT NULL REFERENCES users(users_id) ON DELETE CASCADE,
     totp_enabled BOOLEAN DEFAULT FALSE,
     totp_secret TEXT,
     totp_verified_at TIMESTAMPTZ(6),
     sms_enabled BOOLEAN DEFAULT FALSE,
     sms_phone_number TEXT,
     sms_verified_at TIMESTAMPTZ(6),
     backup_codes_generated_at TIMESTAMPTZ(6),
     created_at TIMESTAMPTZ(6) DEFAULT NOW(),
     updated_at TIMESTAMPTZ(6) DEFAULT NOW(),
     UNIQUE(users_id)
   );

   -- Backup codes for 2FA recovery
   CREATE TABLE two_factor_backup_codes (
     two_factor_backup_codes_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     two_factor_settings_id UUID NOT NULL REFERENCES two_factor_settings(two_factor_settings_id) ON DELETE CASCADE,
     code_hash TEXT NOT NULL,
     used_at TIMESTAMPTZ(6),
     created_at TIMESTAMPTZ(6) DEFAULT NOW()
   );

   -- Magic link tokens
   CREATE TABLE magic_link_tokens (
     magic_link_tokens_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     users_id UUID REFERENCES users(users_id) ON DELETE CASCADE,
     email TEXT NOT NULL,
     token TEXT NOT NULL UNIQUE,
     ip_address TEXT,
     user_agent TEXT,
     expires_at TIMESTAMPTZ(6) NOT NULL,
     used_at TIMESTAMPTZ(6),
     created_at TIMESTAMPTZ(6) DEFAULT NOW()
   );

   -- Indexes
   CREATE INDEX idx_two_factor_settings_user ON two_factor_settings(users_id);
   CREATE INDEX idx_two_factor_backup_codes_settings ON two_factor_backup_codes(two_factor_settings_id);
   CREATE INDEX idx_magic_link_tokens_token ON magic_link_tokens(token);
   CREATE INDEX idx_magic_link_tokens_email ON magic_link_tokens(email);
   CREATE INDEX idx_magic_link_tokens_expires ON magic_link_tokens(expires_at);

   -- Triggers
   CREATE TRIGGER two_factor_settings_set_updated_at BEFORE UPDATE ON two_factor_settings 
     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
   ```

2. **Update Prisma schema (`packages/database/prisma/schema.prisma`):**
   ```prisma
   model TwoFactorSettings {
     id                    String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid @map("two_factor_settings_id")
     userId                String    @unique @map("users_id") @db.Uuid
     totpEnabled           Boolean   @default(false) @map("totp_enabled")
     totpSecret            String?   @map("totp_secret")
     totpVerifiedAt        DateTime? @map("totp_verified_at") @db.Timestamptz(6)
     smsEnabled            Boolean   @default(false) @map("sms_enabled")
     smsPhoneNumber        String?   @map("sms_phone_number")
     smsVerifiedAt         DateTime? @map("sms_verified_at") @db.Timestamptz(6)
     backupCodesGeneratedAt DateTime? @map("backup_codes_generated_at") @db.Timestamptz(6)
     createdAt             DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
     updatedAt             DateTime  @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

     user        User                   @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: Cascade)
     backupCodes TwoFactorBackupCode[]

     @@map("two_factor_settings")
   }

   model TwoFactorBackupCode {
     id                    String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid @map("two_factor_backup_codes_id")
     twoFactorSettingsId   String    @map("two_factor_settings_id") @db.Uuid
     codeHash              String    @map("code_hash")
     usedAt                DateTime? @map("used_at") @db.Timestamptz(6)
     createdAt             DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)

     twoFactorSettings TwoFactorSettings @relation(fields: [twoFactorSettingsId], references: [id], onDelete: Cascade, onUpdate: Cascade)

     @@map("two_factor_backup_codes")
   }

   model MagicLinkToken {
     id         String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid @map("magic_link_tokens_id")
     userId     String?   @map("users_id") @db.Uuid
     email      String
     token      String    @unique
     ipAddress  String?   @map("ip_address")
     userAgent  String?   @map("user_agent")
     expiresAt  DateTime  @map("expires_at") @db.Timestamptz(6)
     usedAt     DateTime? @map("used_at") @db.Timestamptz(6)
     createdAt  DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)

     user User? @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: Cascade)

     @@index([token], map: "idx_magic_link_tokens_token")
     @@index([email], map: "idx_magic_link_tokens_email")
     @@index([expiresAt], map: "idx_magic_link_tokens_expires")
     @@map("magic_link_tokens")
   }

   // Add to User model:
   model User {
     // ... existing fields
     twoFactorSettings TwoFactorSettings?
     magicLinkTokens   MagicLinkToken[]
   }
   ```

**Deliverables:**
- ✅ Two-factor settings table
- ✅ Backup codes table with hash storage
- ✅ Magic link tokens table
- ✅ Prisma schema updated
- ✅ Database migration created

---

### 4.6.2 TOTP (Authenticator App) Implementation

**Tasks:**

1. **Install TOTP dependencies:**
   ```bash
   pnpm add otpauth qrcode
   pnpm add -D @types/qrcode
   ```

2. **Create TOTP service in `packages/auth/src/totp-service.ts`:**
   ```typescript
   import { TOTP, Secret } from 'otpauth';
   import { config, TWO_FACTOR } from '@singr/config';
   import { createLogger } from '@singr/observability';
   import QRCode from 'qrcode';

   const logger = createLogger('auth:totp');

   export class TOTPService {
     generateSecret(): string {
       const secret = new Secret({ size: 20 });
       return secret.base32;
     }

     generateQRCode(email: string, secret: string): Promise<string> {
       const totp = new TOTP({
         issuer: config.TWO_FACTOR_ISSUER,
         label: email,
         algorithm: 'SHA1',
         digits: 6,
         period: TWO_FACTOR.TOTP_STEP,
         secret: Secret.fromBase32(secret),
       });

       const uri = totp.toString();
       return QRCode.toDataURL(uri);
     }

     verifyToken(secret: string, token: string): boolean {
       try {
         const totp = new TOTP({
           issuer: config.TWO_FACTOR_ISSUER,
           algorithm: 'SHA1',
           digits: 6,
           period: TWO_FACTOR.TOTP_STEP,
           secret: Secret.fromBase32(secret),
         });

         const delta = totp.validate({
           token,
           window: config.TWO_FACTOR_WINDOW,
         });

         if (delta === null) {
           logger.debug('TOTP token validation failed');
           return false;
         }

         logger.debug({ delta }, 'TOTP token validated');
         return true;
       } catch (error) {
         logger.error({ error }, 'TOTP verification error');
         return false;
       }
     }

     generateBackupCodes(count: number = TWO_FACTOR.BACKUP_CODE_COUNT): string[] {
       const codes: string[] = [];
       const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excluding ambiguous chars

       for (let i = 0; i < count; i++) {
         let code = '';
         for (let j = 0; j < TWO_FACTOR.BACKUP_CODE_LENGTH; j++) {
           code += chars.charAt(Math.floor(Math.random() * chars.length));
         }
         codes.push(code);
       }

       return codes;
     }
   }
   ```

3. **Create 2FA schemas in `apps/api/src/routes/auth/schemas.ts`:**
   ```typescript
   // Add to existing schemas
   export const EnableTOTPSchema = z.object({
     password: z.string().min(1),
   });

   export const VerifyTOTPSchema = z.object({
     token: z.string().length(6, 'Token must be 6 digits'),
   });

   export const DisableTwoFactorSchema = z.object({
     password: z.string().min(1),
     method: z.enum(['totp', 'sms']),
   });

   export const TwoFactorChallengeSchema = z.object({
     token: z.string().min(6).max(8),
     method: z.enum(['totp', 'sms', 'backup']),
   });

   export const RequestSMSCodeSchema = z.object({
     phoneNumber: z.string().regex(/^\+[1-9]\d{1,14}$/, 'Must be in E.164 format'),
   });
   ```

4. **Implement TOTP routes in `apps/api/src/routes/auth/two-factor.ts`:**
   ```typescript
   import { FastifyPluginAsync } from 'fastify';
   import { validateBody } from '@singr/shared/validation';
   import {
     EnableTOTPSchema,
     VerifyTOTPSchema,
     DisableTwoFactorSchema,
     TwoFactorChallengeSchema,
     RequestSMSCodeSchema,
   } from './schemas';
   import { TOTPService } from '@singr/auth/totp-service';
   import { verifyPassword, hashPassword, buildJWTPayload } from '@singr/auth';
   import { createLogger } from '@singr/observability';
   import { createCommunicationQueue } from '@singr/shared/queues/communication-queue';
   import { SMSService } from '@singr/shared/services/sms/sms-service';
   import { config } from '@singr/config';

   const logger = createLogger('routes:auth:two-factor');

   export const twoFactorRoute: FastifyPluginAsync = async (server) => {
     const totpService = new TOTPService();
     const smsService = new SMSService();
     const communicationQueue = createCommunicationQueue(server.redis);

     // Enable TOTP (step 1: generate secret and QR code)
     server.post(
       '/two-factor/totp/enable',
       {
         schema: {
           tags: ['auth'],
           summary: 'Enable TOTP',
           description: 'Generate TOTP secret and QR code for authenticator app',
           security: [{ bearerAuth: [] }],
           body: {
             type: 'object',
             required: ['password'],
             properties: {
               password: { type: 'string' },
             },
           },
           response: {
             200: {
               description: 'TOTP setup initiated',
               type: 'object',
               properties: {
                 secret: { type: 'string' },
                 qrCode: { type: 'string' },
                 backupCodes: { type: 'array', items: { type: 'string' } },
               },
             },
           },
         },
         preHandler: [server.authenticate, validateBody(EnableTOTPSchema)],
       },
       async (request, reply) => {
         const { password } = request.body as z.infer<typeof EnableTOTPSchema>;
         const userId = request.user.sub;

         const user = await server.prisma.user.findUnique({
           where: { id: userId },
           include: { twoFactorSettings: true },
         });

         if (!user || !user.passwordHash) {
           return reply.code(401).send({
             type: 'authentication_failed',
             title: 'Authentication Failed',
             detail: 'Invalid credentials',
           });
         }

         // Verify password
         const validPassword = await verifyPassword(user.passwordHash, password);
         if (!validPassword) {
           return reply.code(401).send({
             type: 'authentication_failed',
             title: 'Authentication Failed',
             detail: 'Password is incorrect',
           });
         }

         // Generate TOTP secret
         const secret = totpService.generateSecret();
         const qrCode = await totpService.generateQRCode(user.email, secret);

         // Generate backup codes
         const backupCodes = totpService.generateBackupCodes();
         const backupCodeHashes = await Promise.all(
           backupCodes.map((code) => hashPassword(code))
         );

         // Create or update 2FA settings (not enabled yet)
         const twoFactorSettings = await server.prisma.twoFactorSettings.upsert({
           where: { userId },
           create: {
             userId,
             totpSecret: secret,
             totpEnabled: false,
           },
           update: {
             totpSecret: secret,
             totpEnabled: false,
           },
         });

         // Delete old backup codes and create new ones
         await server.prisma.twoFactorBackupCode.deleteMany({
           where: { twoFactorSettingsId: twoFactorSettings.id },
         });

         await server.prisma.twoFactorBackupCode.createMany({
           data: backupCodeHashes.map((codeHash) => ({
             twoFactorSettingsId: twoFactorSettings.id,
             codeHash,
           })),
         });

         await server.prisma.twoFactorSettings.update({
           where: { id: twoFactorSettings.id },
           data: { backupCodesGeneratedAt: new Date() },
         });

         logger.info({ userId }, 'TOTP setup initiated');

         return reply.send({
           secret,
           qrCode,
           backupCodes,
         });
       }
     );

     // Verify and enable TOTP (step 2: verify token from authenticator)
     server.post(
       '/two-factor/totp/verify',
       {
         schema: {
           tags: ['auth'],
           summary: 'Verify and enable TOTP',
           description: 'Verify TOTP token and enable two-factor authentication',
           security: [{ bearerAuth: [] }],
           body: {
             type: 'object',
             required: ['token'],
             properties: {
               token: { type: 'string', minLength: 6, maxLength: 6 },
             },
           },
           response: {
             200: {
               description: 'TOTP enabled',
               type: 'object',
               properties: {
                 message: { type: 'string' },
               },
             },
           },
         },
         preHandler: [server.authenticate, validateBody(VerifyTOTPSchema)],
       },
       async (request, reply) => {
         const { token } = request.body as z.infer<typeof VerifyTOTPSchema>;
         const userId = request.user.sub;

         const twoFactorSettings = await server.prisma.twoFactorSettings.findUnique({
           where: { userId },
         });

         if (!twoFactorSettings?.totpSecret) {
           return reply.code(400).send({
             type: 'invalid_request',
             title: 'TOTP Not Initialized',
             detail: 'TOTP setup must be initiated first',
           });
         }

         // Verify token
         const valid = totpService.verifyToken(twoFactorSettings.totpSecret, token);

         if (!valid) {
           return reply.code(400).send({
             type: 'invalid_token',
             title: 'Invalid Token',
             detail: 'TOTP token is invalid',
           });
         }

         // Enable TOTP
         await server.prisma.twoFactorSettings.update({
           where: { id: twoFactorSettings.id },
           data: {
             totpEnabled: true,
             totpVerifiedAt: new Date(),
           },
         });

         // Send confirmation email
         const user = await server.prisma.user.findUnique({
           where: { id: userId },
         });

         if (user) {
           await communicationQueue.add('email', {
             type: 'email',
             to: user.email,
             toName: user.name || undefined,
             subject: 'Two-factor authentication enabled',
             htmlPart: `
               <h2>Two-Factor Authentication Enabled</h2>
               <p>Hello ${user.name || 'there'},</p>
               <p>Two-factor authentication using an authenticator app has been successfully enabled on your account.</p>
               <p>If you did not enable this, please contact support immediately.</p>
             `,
             textPart: `Two-factor authentication has been enabled on your account. If you did not enable this, please contact support immediately.`,
           });
         }

         logger.info({ userId }, 'TOTP enabled');

         return reply.send({
           message: 'Two-factor authentication enabled successfully',
         });
       }
     );

     // Disable two-factor authentication
     server.post(
       '/two-factor/disable',
       {
         schema: {
           tags: ['auth'],
           summary: 'Disable two-factor authentication',
           description: 'Disable TOTP or SMS two-factor authentication',
           security: [{ bearerAuth: [] }],
           body: {
             type: 'object',
             required: ['password', 'method'],
             properties: {
               password: { type: 'string' },
               method: { type: 'string', enum: ['totp', 'sms'] },
             },
           },
           response: {
             200: {
               description: '2FA disabled',
               type: 'object',
               properties: {
                 message: { type: 'string' },
               },
             },
           },
         },
         preHandler: [server.authenticate, validateBody(DisableTwoFactorSchema)],
       },
       async (request, reply) => {
         const { password, method } = request.body as z.infer<
           typeof DisableTwoFactorSchema
         >;
         const userId = request.user.sub;

         const user = await server.prisma.user.findUnique({
           where: { id: userId },
         });

         if (!user || !user.passwordHash) {
           return reply.code(401).send({
             type: 'authentication_failed',
             title: 'Authentication Failed',
             detail: 'Invalid credentials',
           });
         }

         // Verify password
         const validPassword = await verifyPassword(user.passwordHash, password);
         if (!validPassword) {
           return reply.code(401).send({
             type: 'authentication_failed',
             title: 'Authentication Failed',
             detail: 'Password is incorrect',
           });
         }

         // Disable requested method
         const updateData: any = {};
         if (method === 'totp') {
           updateData.totpEnabled = false;
           updateData.totpSecret = null;
           updateData.totpVerifiedAt = null;
         } else if (method === 'sms') {
           updateData.smsEnabled = false;
           updateData.smsPhoneNumber = null;
           updateData.smsVerifiedAt = null;
         }

         await server.prisma.twoFactorSettings.update({
           where: { userId },
           data: updateData,
         });

         // Send confirmation email
         await communicationQueue.add('email', {
           type: 'email',
           to: user.email,
           toName: user.name || undefined,
           subject: 'Two-factor authentication disabled',
           htmlPart: `
             <h2>Two-Factor Authentication Disabled</h2>
             <p>Hello ${user.name || 'there'},</p>
             <p>Two-factor authentication (${method.toUpperCase()}) has been disabled on your account.</p>
             <p>If you did not disable this, please contact support immediately and secure your account.</p>
           `,
           textPart: `Two-factor authentication (${method.toUpperCase()}) has been disabled. If you did not disable this, please contact support immediately.`,
         });

         logger.info({ userId, method }, '2FA disabled');

         return reply.send({
           message: `Two-factor authentication (${method.toUpperCase()}) disabled successfully`,
         });
       }
     );

     // Get 2FA status
     server.get(
       '/two-factor/status',
       {
         schema: {
           tags: ['auth'],
           summary: 'Get 2FA status',
           description: 'Check which 2FA methods are enabled',
           security: [{ bearerAuth: [] }],
           response: {
             200: {
               description: '2FA status',
               type: 'object',
               properties: {
                 totpEnabled: { type: 'boolean' },
                 smsEnabled: { type: 'boolean' },
                 backupCodesGenerated: { type: 'boolean' },
               },
             },
           },
         },
         preHandler: [server.authenticate],
       },
       async (request, reply) => {
         const userId = request.user.sub;

         const twoFactorSettings = await server.prisma.twoFactorSettings.findUnique({
           where: { userId },
         });

         return reply.send({
           totpEnabled: twoFactorSettings?.totpEnabled || false,
           smsEnabled: twoFactorSettings?.smsEnabled || false,
           smsPhoneNumber: twoFactorSettings?.smsPhoneNumber || null,
           backupCodesGenerated: !!twoFactorSettings?.backupCodesGeneratedAt,
         });
       }
     );
   };
   ```

**Deliverables:**
- ✅ TOTP service with QR code generation
- ✅ `POST /v1/auth/two-factor/totp/enable` - Initiate TOTP setup
- ✅ `POST /v1/auth/two-factor/totp/verify` - Verify and enable TOTP
- ✅ `POST /v1/auth/two-factor/disable` - Disable 2FA
- ✅ `GET /v1/auth/two-factor/status` - Check 2FA status
- ✅ Backup code generation (10 codes, 8 characters)
- ✅ Password confirmation required
- ✅ Email notifications for 2FA changes

---

### 4.6.3 SMS Two-Factor Authentication

**Tasks:**

1. **Implement SMS 2FA routes (add to `apps/api/src/routes/auth/two-factor.ts`):**
   ```typescript
   // Add to existing twoFactorRoute
   
   // Enable SMS 2FA (step 1: send verification code)
   server.post(
     '/two-factor/sms/enable',
     {
       schema: {
         tags: ['auth'],
         summary: 'Enable SMS 2FA',
         description: 'Send SMS verification code to enable SMS two-factor authentication',
         security: [{ bearerAuth: [] }],
         body: {
           type: 'object',
           required: ['phoneNumber', 'password'],
           properties: {
             phoneNumber: { type: 'string', pattern: '^\\+[1-9]\\d{1,14}$' },
             password: { type: 'string' },
           },
         },
         response: {
           200: {
             description: 'Verification code sent',
             type: 'object',
             properties: {
               message: { type: 'string' },
               phoneNumber: { type: 'string' },
             },
           },
         },
       },
       preHandler: [server.authenticate, validateBody(RequestSMSCodeSchema.extend({
         password: z.string().min(1),
       }))],
       config: {
         rateLimit: {
           max: 5,
           timeWindow: '1 hour',
         },
       },
     },
     async (request, reply) => {
       const { phoneNumber, password } = request.body as any;
       const userId = request.user.sub;

       const user = await server.prisma.user.findUnique({
         where: { id: userId },
       });

       if (!user || !user.passwordHash) {
         return reply.code(401).send({
           type: 'authentication_failed',
           title: 'Authentication Failed',
           detail: 'Invalid credentials',
         });
       }

       // Verify password
       const validPassword = await verifyPassword(user.passwordHash, password);
       if (!validPassword) {
         return reply.code(401).send({
           type: 'authentication_failed',
           title: 'Authentication Failed',
           detail: 'Password is incorrect',
         });
       }

       // Generate verification code
       const verificationCode = smsService.generateVerificationCode();

       // Store in Redis with 5-minute TTL
       await server.redis.setex(
         `sms_2fa_setup:${userId}`,
         300,
         JSON.stringify({
           phoneNumber,
           code: verificationCode,
           attempts: 0,
         })
       );

       // Send SMS
       await communicationQueue.add('sms', {
         type: 'sms',
         to: phoneNumber,
         body: `Your Singr 2FA setup code is: ${verificationCode}. Valid for 5 minutes.`,
       });

       logger.info({ userId, phoneNumber }, 'SMS 2FA setup code sent');

       return reply.send({
         message: 'Verification code sent to your phone',
         phoneNumber,
       });
     }
   );

   // Verify and enable SMS 2FA (step 2)
   server.post(
     '/two-factor/sms/verify',
     {
       schema: {
         tags: ['auth'],
         summary: 'Verify and enable SMS 2FA',
         description: 'Verify SMS code and enable SMS two-factor authentication',
         security: [{ bearerAuth: [] }],
         body: {
           type: 'object',
           required: ['code'],
           properties: {
             code: { type: 'string', minLength: 6, maxLength: 6 },
           },
         },
         response: {
           200: {
             description: 'SMS 2FA enabled',
             type: 'object',
             properties: {
               message: { type: 'string' },
               backupCodes: { type: 'array', items: { type: 'string' } },
             },
           },
         },
       },
       preHandler: [server.authenticate, validateBody(VerifyTOTPSchema)],
     },
     async (request, reply) => {
       const { token: code } = request.body as z.infer<typeof VerifyTOTPSchema>;
       const userId = request.user.sub;

       // Get pending verification from Redis
       const pendingData = await server.redis.get(`sms_2fa_setup:${userId}`);

       if (!pendingData) {
         return reply.code(400).send({
           type: 'invalid_code',
           title: 'Invalid or Expired Code',
           detail: 'Verification code has expired or does not exist',
         });
       }

       const pending = JSON.parse(pendingData);

       // Check attempts
       if (pending.attempts >= 5) {
         await server.redis.del(`sms_2fa_setup:${userId}`);
         return reply.code(429).send({
           type: 'too_many_attempts',
           title: 'Too Many Attempts',
           detail: 'Maximum verification attempts exceeded',
         });
       }

       // Verify code
       if (pending.code !== code) {
         pending.attempts++;
         await server.redis.setex(
           `sms_2fa_setup:${userId}`,
           300,
           JSON.stringify(pending)
         );

         return reply.code(400).send({
           type: 'invalid_code',
           title: 'Invalid Code',
           detail: `Verification code is incorrect. ${5 - pending.attempts} attempts remaining.`,
         });
       }

       // Generate backup codes
       const backupCodes = totpService.generateBackupCodes();
       const backupCodeHashes = await Promise.all(
         backupCodes.map((code) => hashPassword(code))
       );

       // Enable SMS 2FA
       const twoFactorSettings = await server.prisma.twoFactorSettings.upsert({
         where: { userId },
         create: {
           userId,
           smsEnabled: true,
           smsPhoneNumber: pending.phoneNumber,
           smsVerifiedAt: new Date(),
         },
         update: {
           smsEnabled: true,
           smsPhoneNumber: pending.phoneNumber,
           smsVerifiedAt: new Date(),
         },
       });

       // Save backup codes
       await server.prisma.twoFactorBackupCode.deleteMany({
         where: { twoFactorSettingsId: twoFactorSettings.id },
       });

       await server.prisma.twoFactorBackupCode.createMany({
         data: backupCodeHashes.map((codeHash) => ({
           twoFactorSettingsId: twoFactorSettings.id,
           codeHash,
         })),
       });

       await server.prisma.twoFactorSettings.update({
         where: { id: twoFactorSettings.id },
         data: { backupCodesGeneratedAt: new Date() },
       });

       // Delete verification data
       await server.redis.del(`sms_2fa_setup:${userId}`);

       // Send confirmation email
       const user = await server.prisma.user.findUnique({
         where: { id: userId },
       });

       if (user) {
         await communicationQueue.add('email', {
           type: 'email',
           to: user.email,
           toName: user.name || undefined,
           subject: 'SMS two-factor authentication enabled',
           htmlPart: `
             <h2>SMS Two-Factor Authentication Enabled</h2>
             <p>Hello ${user.name || 'there'},</p>
             <p>SMS two-factor authentication has been enabled for phone number: ${pending.phoneNumber}</p>
             <p>If you did not enable this, please contact support immediately.</p>
           `,
           textPart: `SMS two-factor authentication has been enabled for ${pending.phoneNumber}. If you did not enable this, please contact support immediately.`,
         });
       }

       logger.info({ userId, phoneNumber: pending.phoneNumber }, 'SMS 2FA enabled');

       return reply.send({
         message: 'SMS two-factor authentication enabled successfully',
         backupCodes,
       });
     }
   );
   ```

**Deliverables:**
- ✅ `POST /v1/auth/two-factor/sms/enable` - Send SMS verification code
- ✅ `POST /v1/auth/two-factor/sms/verify` - Verify code and enable SMS 2FA
- ✅ SMS verification via Twilio
- ✅ Backup codes generated for SMS 2FA
- ✅ Rate limiting (5 req/hour)
- ✅ Attempt tracking (max 5 attempts)
- ✅ Email confirmation

---

### 4.6.4 Magic Link Authentication

**Objective:** Implement passwordless authentication via email magic links.

**Duration:** 2 days  
**Team Size:** 1 developer

**Tasks:**

1. **Create magic link schemas in `apps/api/src/routes/auth/schemas.ts`:**
   ```typescript
   // Add to existing schemas
   export const RequestMagicLinkSchema = z.object({
     email: EmailSchema,
   });

   export const VerifyMagicLinkSchema = z.object({
     token: z.string().uuid('Invalid token format'),
   });
   ```

2. **Create magic link service in `packages/auth/src/magic-link-service.ts`:**
   ```typescript
   import { PrismaClient } from '@prisma/database';
   import { randomUUID } from 'crypto';
   import { config } from '@singr/config';
   import { createLogger } from '@singr/observability';

   const logger = createLogger('auth:magic-link');

   export class MagicLinkService {
     constructor(private prisma: PrismaClient) {}

     async createMagicLink(
       email: string,
       ipAddress: string,
       userAgent: string
     ): Promise<{ token: string; userId: string | null }> {
       // Check if user exists
       const user = await this.prisma.user.findUnique({
         where: { email: email.toLowerCase() },
       });

       // Generate token
       const token = randomUUID();
       const expiresAt = new Date(Date.now() + config.MAGIC_LINK_TTL * 1000);

       // Create magic link token
       await this.prisma.magicLinkToken.create({
         data: {
           userId: user?.id || null,
           email: email.toLowerCase(),
           token,
           ipAddress,
           userAgent,
           expiresAt,
         },
       });

       logger.info(
         {
           email,
           userId: user?.id,
           ipAddress,
         },
         'Magic link created'
       );

       return { token, userId: user?.id || null };
     }

     async verifyMagicLink(token: string): Promise<{
       valid: boolean;
       email?: string;
       userId?: string;
       error?: string;
     }> {
       const magicLink = await this.prisma.magicLinkToken.findUnique({
         where: { token },
       });

       if (!magicLink) {
         return { valid: false, error: 'Invalid token' };
       }

       if (magicLink.usedAt) {
         return { valid: false, error: 'Token already used' };
       }

       if (magicLink.expiresAt < new Date()) {
         return { valid: false, error: 'Token expired' };
       }

       // Mark as used
       await this.prisma.magicLinkToken.update({
         where: { id: magicLink.id },
         data: { usedAt: new Date() },
       });

       logger.info(
         {
           email: magicLink.email,
           userId: magicLink.userId,
         },
         'Magic link verified'
       );

       return {
         valid: true,
         email: magicLink.email,
         userId: magicLink.userId || undefined,
       };
     }

     async cleanupExpiredTokens(): Promise<number> {
       const result = await this.prisma.magicLinkToken.deleteMany({
         where: {
           expiresAt: { lt: new Date() },
         },
       });

       logger.debug({ count: result.count }, 'Expired magic links cleaned up');

       return result.count;
     }
   }
   ```

3. **Implement magic link routes in `apps/api/src/routes/auth/magic-link.ts`:**
   ```typescript
   import { FastifyPluginAsync } from 'fastify';
   import { validateBody } from '@singr/shared/validation';
   import { RequestMagicLinkSchema, VerifyMagicLinkSchema } from './schemas';
   import { MagicLinkService } from '@singr/auth/magic-link-service';
   import { buildJWTPayload, RefreshTokenService } from '@singr/auth';
   import { createLogger } from '@singr/observability';
   import { createCommunicationQueue } from '@singr/shared/queues/communication-queue';
   import { config } from '@singr/config';

   const logger = createLogger('routes:auth:magic-link');

   export const magicLinkRoute: FastifyPluginAsync = async (server) => {
     const magicLinkService = new MagicLinkService(server.prisma);
     const communicationQueue = createCommunicationQueue(server.redis);

     // Request magic link
     server.post(
       '/magic-link/request',
       {
         schema: {
           tags: ['auth'],
           summary: 'Request magic link',
           description: 'Send passwordless authentication link via email',
           body: {
             type: 'object',
             required: ['email'],
             properties: {
               email: { type: 'string', format: 'email' },
             },
           },
           response: {
             200: {
               description: 'Magic link sent (or email not found)',
               type: 'object',
               properties: {
                 message: { type: 'string' },
               },
             },
           },
         },
         preHandler: [validateBody(RequestMagicLinkSchema)],
         config: {
           rateLimit: {
             max: 5,
             timeWindow: '1 hour',
           },
         },
       },
       async (request, reply) => {
         const { email } = request.body as z.infer<typeof RequestMagicLinkSchema>;
         const ipAddress = request.ip;
         const userAgent = request.headers['user-agent'] || 'Unknown';

         // Create magic link (always returns success to prevent email enumeration)
         const { token, userId } = await magicLinkService.createMagicLink(
           email,
           ipAddress,
           userAgent
         );

         // Only send email if user exists
         if (userId) {
           const magicLink = `${config.APP_URL_WEB}/auth/magic?token=${token}`;

           await communicationQueue.add('email', {
             type: 'email',
             to: email,
             subject: 'Sign in to Singr',
             templateId: config.MAILJET_TEMPLATE_MAGIC_LINK,
             variables: {
               user_email: email,
               magic_link: magicLink,
               expiry_minutes: Math.floor(config.MAGIC_LINK_TTL / 60),
               ip_address: ipAddress,
             },
           });

           logger.info({ email, userId, ipAddress }, 'Magic link email sent');
         } else {
           logger.debug({ email, ipAddress }, 'Magic link requested for non-existent user');
         }

         return reply.send({
           message: 'If an account exists, a sign-in link has been sent to your email',
         });
       }
     );

     // Verify magic link and sign in
     server.post(
       '/magic-link/verify',
       {
         schema: {
           tags: ['auth'],
           summary: 'Verify magic link',
           description: 'Verify magic link token and authenticate user',
           body: {
             type: 'object',
             required: ['token'],
             properties: {
               token: { type: 'string', format: 'uuid' },
             },
           },
           response: {
             200: {
               description: 'Authentication successful',
               type: 'object',
               properties: {
                 accessToken: { type: 'string' },
                 refreshToken: { type: 'string' },
                 expiresIn: { type: 'number' },
                 tokenType: { type: 'string' },
                 requiresTwoFactor: { type: 'boolean' },
                 twoFactorMethods: {
                   type: 'array',
                   items: { type: 'string' },
                 },
                 user: {
                   type: 'object',
                   properties: {
                     id: { type: 'string', format: 'uuid' },
                     email: { type: 'string' },
                     name: { type: 'string' },
                   },
                 },
               },
             },
             400: {
               description: 'Invalid or expired token',
             },
           },
         },
         preHandler: [validateBody(VerifyMagicLinkSchema)],
         config: {
           rateLimit: {
             max: 10,
             timeWindow: '1 minute',
           },
         },
       },
       async (request, reply) => {
         const { token } = request.body as z.infer<typeof VerifyMagicLinkSchema>;

         // Verify magic link
         const verification = await magicLinkService.verifyMagicLink(token);

         if (!verification.valid || !verification.userId) {
           return reply.code(400).send({
             type: 'invalid_token',
             title: 'Invalid or Expired Token',
             detail: verification.error || 'Magic link is invalid or has expired',
           });
         }

         // Get user
         const user = await server.prisma.user.findUnique({
           where: { id: verification.userId },
           include: {
             twoFactorSettings: true,
             userRoles: {
               include: { role: true },
             },
           },
         });

         if (!user) {
           return reply.code(404).send({
             type: 'resource_not_found',
             title: 'User Not Found',
             detail: 'User account not found',
           });
         }

         // Check if email is verified
         if (!user.isEmailVerified) {
           return reply.code(403).send({
             type: 'email_not_verified',
             title: 'Email Not Verified',
             detail: 'Please verify your email before signing in',
           });
         }

         // Check if 2FA is enabled
         const twoFactorEnabled =
           user.twoFactorSettings?.totpEnabled || user.twoFactorSettings?.smsEnabled;

         if (twoFactorEnabled) {
           // Store pending 2FA session in Redis (5 minutes)
           const tempToken = randomUUID();
           await server.redis.setex(
             `2fa_pending:${tempToken}`,
             300,
             JSON.stringify({
               userId: user.id,
               email: user.email,
               method: 'magic_link',
             })
           );

           const availableMethods: string[] = [];
           if (user.twoFactorSettings?.totpEnabled) availableMethods.push('totp');
           if (user.twoFactorSettings?.smsEnabled) availableMethods.push('sms');
           availableMethods.push('backup');

           logger.info({ userId: user.id, email: user.email }, 'Magic link verified - 2FA required');

           return reply.send({
             requiresTwoFactor: true,
             twoFactorMethods: availableMethods,
             twoFactorToken: tempToken,
             message: 'Two-factor authentication required',
           });
         }

         // Build JWT payload
         const payload = await buildJWTPayload(user.id);
         const accessToken = server.jwt.sign(payload);

         // Create refresh token
         const refreshTokenService = new RefreshTokenService(server.redis);
         const refreshToken = await refreshTokenService.create(user.id);

         // Update last login
         await server.prisma.user.update({
           where: { id: user.id },
           data: { lastLoginAt: new Date() },
         });

         logger.info({ userId: user.id, email: user.email }, 'Magic link authentication successful');

         return reply.send({
           accessToken,
           refreshToken,
           expiresIn: config.JWT_ACCESS_TTL,
           tokenType: 'Bearer',
           requiresTwoFactor: false,
           user: {
             id: user.id,
             email: user.email,
             name: user.name,
             roles: user.userRoles.map((ur) => ur.role.slug),
           },
         });
       }
     );
   };
   ```

**Deliverables:**
- ✅ `POST /v1/auth/magic-link/request` - Request magic link via email
- ✅ `POST /v1/auth/magic-link/verify` - Verify token and authenticate
- ✅ Magic link service with token generation and verification
- ✅ Email sent via Mailjet with magic link
- ✅ Token expiration (configurable, default 15 minutes)
- ✅ One-time use tokens
- ✅ IP address and user agent tracking
- ✅ Privacy-preserving responses (don't reveal user existence)
- ✅ 2FA integration (challenge if enabled)
- ✅ Rate limiting (5 requests/hour for generation)
- ✅ Cleanup of expired tokens

---

### 4.6.5 Two-Factor Challenge Flow

**Objective:** Complete authentication flow when 2FA is required.

**Duration:** 2 days  
**Team Size:** 1 developer

**Tasks:**

1. **Implement 2FA challenge routes in `apps/api/src/routes/auth/two-factor-challenge.ts`:**
   ```typescript
   import { FastifyPluginAsync } from 'fastify';
   import { validateBody } from '@singr/shared/validation';
   import { TwoFactorChallengeSchema } from './schemas';
   import { TOTPService } from '@singr/auth/totp-service';
   import { verifyPassword, buildJWTPayload, RefreshTokenService } from '@singr/auth';
   import { createLogger } from '@singr/observability';
   import { createCommunicationQueue } from '@singr/shared/queues/communication-queue';
   import { SMSService } from '@singr/shared/services/sms/sms-service';
   import { config } from '@singr/config';

   const logger = createLogger('routes:auth:two-factor-challenge');

   export const twoFactorChallengeRoute: FastifyPluginAsync = async (server) => {
     const totpService = new TOTPService();
     const smsService = new SMSService();
     const communicationQueue = createCommunicationQueue(server.redis);

     // Request SMS code during sign-in
     server.post(
       '/two-factor/challenge/sms',
       {
         schema: {
           tags: ['auth'],
           summary: 'Request SMS 2FA code',
           description: 'Send SMS code during two-factor authentication challenge',
           body: {
             type: 'object',
             required: ['twoFactorToken'],
             properties: {
               twoFactorToken: { type: 'string', format: 'uuid' },
             },
           },
           response: {
             200: {
               description: 'SMS code sent',
               type: 'object',
               properties: {
                 message: { type: 'string' },
               },
             },
           },
         },
         preHandler: [validateBody(z.object({ twoFactorToken: z.string().uuid() }))],
         config: {
           rateLimit: {
             max: 3,
             timeWindow: '15 minutes',
           },
         },
       },
       async (request, reply) => {
         const { twoFactorToken } = request.body as { twoFactorToken: string };

         // Get pending 2FA session
         const pendingData = await server.redis.get(`2fa_pending:${twoFactorToken}`);

         if (!pendingData) {
           return reply.code(400).send({
             type: 'invalid_token',
             title: 'Invalid Session',
             detail: 'Two-factor authentication session expired',
           });
         }

         const pending = JSON.parse(pendingData);

         // Get user and 2FA settings
         const user = await server.prisma.user.findUnique({
           where: { id: pending.userId },
           include: { twoFactorSettings: true },
         });

         if (!user?.twoFactorSettings?.smsEnabled || !user.twoFactorSettings.smsPhoneNumber) {
           return reply.code(400).send({
             type: 'invalid_request',
             title: 'SMS Not Enabled',
             detail: 'SMS two-factor authentication is not enabled',
           });
         }

         // Generate code
         const code = smsService.generateVerificationCode();

         // Store code in Redis (5 minutes)
         await server.redis.setex(
           `2fa_sms:${twoFactorToken}`,
           300,
           JSON.stringify({ code, attempts: 0 })
         );

         // Send SMS
         await communicationQueue.add('sms', {
           type: 'sms',
           to: user.twoFactorSettings.smsPhoneNumber,
           body: `Your Singr verification code is: ${code}. Valid for 5 minutes.`,
         });

         logger.info({ userId: user.id }, '2FA SMS code sent');

         return reply.send({
           message: 'Verification code sent to your phone',
         });
       }
     );

     // Verify 2FA challenge
     server.post(
       '/two-factor/challenge/verify',
       {
         schema: {
           tags: ['auth'],
           summary: 'Verify 2FA challenge',
           description: 'Complete two-factor authentication challenge',
           body: {
             type: 'object',
             required: ['twoFactorToken', 'token', 'method'],
             properties: {
               twoFactorToken: { type: 'string', format: 'uuid' },
               token: { type: 'string', minLength: 6, maxLength: 8 },
               method: { type: 'string', enum: ['totp', 'sms', 'backup'] },
             },
           },
           response: {
             200: {
               description: 'Authentication successful',
               type: 'object',
               properties: {
                 accessToken: { type: 'string' },
                 refreshToken: { type: 'string' },
                 expiresIn: { type: 'number' },
                 tokenType: { type: 'string' },
                 user: {
                   type: 'object',
                   properties: {
                     id: { type: 'string', format: 'uuid' },
                     email: { type: 'string' },
                     name: { type: 'string' },
                   },
                 },
               },
             },
           },
         },
         preHandler: [validateBody(TwoFactorChallengeSchema.extend({
           twoFactorToken: z.string().uuid(),
         }))],
         config: {
           rateLimit: {
             max: 10,
             timeWindow: '15 minutes',
           },
         },
       },
       async (request, reply) => {
         const { twoFactorToken, token, method } = request.body as z.infer<
           typeof TwoFactorChallengeSchema
         > & { twoFactorToken: string };

         // Get pending 2FA session
         const pendingData = await server.redis.get(`2fa_pending:${twoFactorToken}`);

         if (!pendingData) {
           return reply.code(400).send({
             type: 'invalid_token',
             title: 'Invalid Session',
             detail: 'Two-factor authentication session expired',
           });
         }

         const pending = JSON.parse(pendingData);

         // Get user and 2FA settings
         const user = await server.prisma.user.findUnique({
           where: { id: pending.userId },
           include: {
             twoFactorSettings: {
               include: {
                 backupCodes: {
                   where: { usedAt: null },
                 },
               },
             },
             userRoles: {
               include: { role: true },
             },
           },
         });

         if (!user?.twoFactorSettings) {
           return reply.code(400).send({
             type: 'invalid_request',
             title: '2FA Not Configured',
             detail: 'Two-factor authentication is not configured',
           });
         }

         let valid = false;

         // Verify based on method
         if (method === 'totp') {
           if (!user.twoFactorSettings.totpEnabled || !user.twoFactorSettings.totpSecret) {
             return reply.code(400).send({
               type: 'invalid_request',
               title: 'TOTP Not Enabled',
               detail: 'TOTP is not enabled for this account',
             });
           }

           valid = totpService.verifyToken(user.twoFactorSettings.totpSecret, token);
         } else if (method === 'sms') {
           if (!user.twoFactorSettings.smsEnabled) {
             return reply.code(400).send({
               type: 'invalid_request',
               title: 'SMS Not Enabled',
               detail: 'SMS 2FA is not enabled for this account',
             });
           }

           // Get SMS code from Redis
           const smsData = await server.redis.get(`2fa_sms:${twoFactorToken}`);

           if (!smsData) {
             return reply.code(400).send({
               type: 'invalid_code',
               title: 'Code Expired',
               detail: 'SMS verification code has expired',
             });
           }

           const sms = JSON.parse(smsData);

           if (sms.attempts >= 5) {
             await server.redis.del(`2fa_sms:${twoFactorToken}`);
             return reply.code(429).send({
               type: 'too_many_attempts',
               title: 'Too Many Attempts',
               detail: 'Maximum verification attempts exceeded',
             });
           }

           if (sms.code === token) {
             valid = true;
             await server.redis.del(`2fa_sms:${twoFactorToken}`);
           } else {
             sms.attempts++;
             await server.redis.setex(
               `2fa_sms:${twoFactorToken}`,
               300,
               JSON.stringify(sms)
             );
           }
         } else if (method === 'backup') {
           // Check backup codes
           for (const backupCode of user.twoFactorSettings.backupCodes) {
             const matches = await verifyPassword(backupCode.codeHash, token);
             if (matches) {
               // Mark code as used
               await server.prisma.twoFactorBackupCode.update({
                 where: { id: backupCode.id },
                 data: { usedAt: new Date() },
               });

               valid = true;

               // Send alert email
               await communicationQueue.add('email', {
                 type: 'email',
                 to: user.email,
                 toName: user.name || undefined,
                 subject: 'Backup code used for sign-in',
                 htmlPart: `
                   <h2>Backup Code Used</h2>
                   <p>Hello ${user.name || 'there'},</p>
                   <p>A backup code was used to sign in to your account.</p>
                   <p>You have ${user.twoFactorSettings.backupCodes.length - 1} backup codes remaining.</p>
                   <p>If this wasn't you, please secure your account immediately.</p>
                 `,
                 textPart: `A backup code was used to sign in to your account. You have ${
                   user.twoFactorSettings.backupCodes.length - 1
                 } backup codes remaining.`,
               });

               break;
             }
           }
         }

         if (!valid) {
           logger.warn({ userId: user.id, method }, '2FA verification failed');
           return reply.code(400).send({
             type: 'invalid_token',
             title: 'Invalid Code',
             detail: 'Verification code is incorrect',
           });
         }

         // Delete pending 2FA session
         await server.redis.del(`2fa_pending:${twoFactorToken}`);

         // Build JWT payload
         const payload = await buildJWTPayload(user.id);
         const accessToken = server.jwt.sign(payload);

         // Create refresh token
         const refreshTokenService = new RefreshTokenService(server.redis);
         const refreshToken = await refreshTokenService.create(user.id);

         // Update last login
         await server.prisma.user.update({
           where: { id: user.id },
           data: { lastLoginAt: new Date() },
         });

         logger.info({ userId: user.id, method }, '2FA challenge completed');

         return reply.send({
           accessToken,
           refreshToken,
           expiresIn: config.JWT_ACCESS_TTL,
           tokenType: 'Bearer',
           user: {
             id: user.id,
             email: user.email,
             name: user.name,
             roles: user.userRoles.map((ur) => ur.role.slug),
           },
         });
       }
     );
   };
   ```

2. **Update sign-in route to support 2FA in `apps/api/src/routes/auth/signin.ts`:**
   ```typescript
   // Add after password verification in existing signin route:

   // Check if 2FA is enabled
   const twoFactorSettings = await server.prisma.twoFactorSettings.findUnique({
     where: { userId: user.id },
   });

   const twoFactorEnabled =
     twoFactorSettings?.totpEnabled || twoFactorSettings?.smsEnabled;

   if (twoFactorEnabled) {
     // Store pending 2FA session in Redis (5 minutes)
     const tempToken = randomUUID();
     await server.redis.setex(
       `2fa_pending:${tempToken}`,
       300,
       JSON.stringify({
         userId: user.id,
         email: user.email,
         method: 'password',
       })
     );

     const availableMethods: string[] = [];
     if (twoFactorSettings?.totpEnabled) availableMethods.push('totp');
     if (twoFactorSettings?.smsEnabled) availableMethods.push('sms');
     availableMethods.push('backup');

     logger.info({ userId: user.id, email: user.email }, 'Sign in successful - 2FA required');

     return reply.send({
       requiresTwoFactor: true,
       twoFactorMethods: availableMethods,
       twoFactorToken: tempToken,
       message: 'Two-factor authentication required',
     });
   }

   // ... continue with normal JWT generation
   ```

3. **Register new routes in `apps/api/src/routes/auth/index.ts`:**
   ```typescript
   import { FastifyPluginAsync } from 'fastify';
   import { signinRoute } from './signin';
   import { registerRoute } from './register';
   import { refreshRoute } from './refresh';
   import { signoutRoute } from './signout';
   import { passwordRoute } from './password';
   import { profileRoute } from './profile';
   import { contextRoute } from './context';
   import { twoFactorRoute } from './two-factor';
   import { twoFactorChallengeRoute } from './two-factor-challenge';
   import { magicLinkRoute } from './magic-link';

   export const authRoutes: FastifyPluginAsync = async (server) => {
     await server.register(signinRoute);
     await server.register(registerRoute);
     await server.register(refreshRoute);
     await server.register(signoutRoute);
     await server.register(passwordRoute);
     await server.register(profileRoute);
     await server.register(contextRoute);
     await server.register(twoFactorRoute);
     await server.register(twoFactorChallengeRoute);
     await server.register(magicLinkRoute);
   };
   ```

**Deliverables:**
- ✅ `POST /v1/auth/two-factor/challenge/sms` - Request SMS code during sign-in
- ✅ `POST /v1/auth/two-factor/challenge/verify` - Verify 2FA challenge
- ✅ Support for TOTP, SMS, and backup code verification
- ✅ Temporary session storage in Redis (5 minutes)
- ✅ Integration with sign-in and magic link flows
- ✅ Backup code usage tracking
- ✅ Alert emails when backup codes are used
- ✅ Rate limiting on challenge verification
- ✅ Attempt tracking for SMS codes

---

### 4.6.6 Backup Code Management

**Objective:** Allow users to regenerate backup codes.

**Duration:** 1 day  
**Team Size:** 1 developer

**Tasks:**

1. **Add backup code routes to `apps/api/src/routes/auth/two-factor.ts`:**
   ```typescript
   // Add to existing twoFactorRoute

   // Regenerate backup codes
   server.post(
     '/two-factor/backup-codes/regenerate',
     {
       schema: {
         tags: ['auth'],
         summary: 'Regenerate backup codes',
         description: 'Generate new backup codes (invalidates old ones)',
         security: [{ bearerAuth: [] }],
         body: {
           type: 'object',
           required: ['password'],
           properties: {
             password: { type: 'string' },
           },
         },
         response: {
           200: {
             description: 'Backup codes regenerated',
             type: 'object',
             properties: {
               backupCodes: { type: 'array', items: { type: 'string' } },
             },
           },
         },
       },
       preHandler: [
         server.authenticate,
         validateBody(z.object({ password: z.string().min(1) })),
       ],
       config: {
         rateLimit: {
           max: 3,
           timeWindow: '1 hour',
         },
       },
     },
     async (request, reply) => {
       const { password } = request.body as { password: string };
       const userId = request.user.sub;

       const user = await server.prisma.user.findUnique({
         where: { id: userId },
         include: { twoFactorSettings: true },
       });

       if (!user || !user.passwordHash) {
         return reply.code(401).send({
           type: 'authentication_failed',
           title: 'Authentication Failed',
           detail: 'Invalid credentials',
         });
       }

       // Verify password
       const validPassword = await verifyPassword(user.passwordHash, password);
       if (!validPassword) {
         return reply.code(401).send({
           type: 'authentication_failed',
           title: 'Authentication Failed',
           detail: 'Password is incorrect',
         });
       }

       if (!user.twoFactorSettings) {
         return reply.code(400).send({
           type: 'invalid_request',
           title: '2FA Not Configured',
           detail: 'Two-factor authentication must be enabled first',
         });
       }

       // Generate new backup codes
       const backupCodes = totpService.generateBackupCodes();
       const backupCodeHashes = await Promise.all(
         backupCodes.map((code) => hashPassword(code))
       );

       // Delete old backup codes
       await server.prisma.twoFactorBackupCode.deleteMany({
         where: { twoFactorSettingsId: user.twoFactorSettings.id },
       });

       // Create new backup codes
       await server.prisma.twoFactorBackupCode.createMany({
         data: backupCodeHashes.map((codeHash) => ({
           twoFactorSettingsId: user.twoFactorSettings!.id,
           codeHash,
         })),
       });

       // Update timestamp
       await server.prisma.twoFactorSettings.update({
         where: { id: user.twoFactorSettings.id },
         data: { backupCodesGeneratedAt: new Date() },
       });

       // Send confirmation email
       await communicationQueue.add('email', {
         type: 'email',
         to: user.email,
         toName: user.name || undefined,
         subject: 'Backup codes regenerated',
         htmlPart: `
           <h2>Backup Codes Regenerated</h2>
           <p>Hello ${user.name || 'there'},</p>
           <p>New backup codes have been generated for your account.</p>
           <p>Your old backup codes are no longer valid.</p>
           <p>If you did not request this, please contact support immediately.</p>
         `,
         textPart: `New backup codes have been generated for your account. Your old backup codes are no longer valid.`,
       });

       logger.info({ userId }, 'Backup codes regenerated');

       return reply.send({
         backupCodes,
       });
     }
   );

   // View remaining backup codes count
   server.get(
     '/two-factor/backup-codes/count',
     {
       schema: {
         tags: ['auth'],
         summary: 'Get backup codes count',
         description: 'Check how many unused backup codes remain',
         security: [{ bearerAuth: [] }],
         response: {
           200: {
             description: 'Backup codes count',
             type: 'object',
             properties: {
               total: { type: 'integer' },
               remaining: { type: 'integer' },
               generatedAt: { type: 'string', format: 'date-time' },
             },
           },
         },
       },
       preHandler: [server.authenticate],
     },
     async (request, reply) => {
       const userId = request.user.sub;

       const twoFactorSettings = await server.prisma.twoFactorSettings.findUnique({
         where: { userId },
         include: {
           backupCodes: true,
         },
       });

       if (!twoFactorSettings) {
         return reply.send({
           total: 0,
           remaining: 0,
           generatedAt: null,
         });
       }

       const total = twoFactorSettings.backupCodes.length;
       const remaining = twoFactorSettings.backupCodes.filter(
         (code) => !code.usedAt
       ).length;

       return reply.send({
         total,
         remaining,
         generatedAt: twoFactorSettings.backupCodesGeneratedAt?.toISOString() || null,
       });
     }
   );
   ```

**Deliverables:**
- ✅ `POST /v1/auth/two-factor/backup-codes/regenerate` - Generate new backup codes
- ✅ `GET /v1/auth/two-factor/backup-codes/count` - Check remaining backup codes
- ✅ Password confirmation required
- ✅ Old codes invalidated when regenerating
- ✅ Email confirmation sent
- ✅ Rate limiting (3 req/hour)

---

**End of Phase 4.6. Complete deliverables:**

### Phase 4.6 Summary

**Complete Authentication Features:**
- ✅ TOTP (Time-based One-Time Password) with authenticator apps
- ✅ SMS two-factor authentication via Twilio
- ✅ Magic link passwordless authentication via Mailjet
- ✅ Backup codes for account recovery (10 codes, 8 characters each)
- ✅ Two-factor challenge flow integrated with sign-in
- ✅ Two-factor challenge flow integrated with magic links
- ✅ 2FA status endpoint
- ✅ 2FA enable/disable with password confirmation
- ✅ Backup code regeneration
- ✅ SMS code request during sign-in
- ✅ Rate limiting on all 2FA endpoints
- ✅ Email notifications for all 2FA changes
- ✅ Comprehensive audit logging
- ✅ Redis-based temporary session storage
- ✅ QR code generation for TOTP setup
- ✅ Magic link expiration and one-time use
- ✅ IP address and user agent tracking for magic links

---
