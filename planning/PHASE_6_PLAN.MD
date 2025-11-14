# Singr Central API Backend - Phase 6

**Document Version:** 1.0  
**Last Updated:** 2025-11-12  
**Author:** kirkphillip605  
**Status:** In Development

---

## Phase 6: Singer Account & Profile Management

### 6.1 Singer Profile Management

**Objective:** Allow singers to view and update their profiles.

**Tasks:**

1. **Create singer profile schemas in `apps/api/src/routes/singer/schemas.ts`:**
   ```typescript
   import { z } from 'zod';
   import { PaginationSchema, EmailSchema, PasswordSchema } from '@singr/shared/validation';

   export const SingerProfileSchema = z.object({
     id: z.string().uuid(),
     userId: z.string().uuid(),
     nickname: z.string().nullable(),
     avatarUrl: z.string().url().nullable(),
     email: z.string().email(),
     name: z.string().nullable(),
     phoneNumber: z.string().nullable(),
     preferences: z.record(z.any()),
     createdAt: z.string().datetime(),
   });

   export const UpdateSingerProfileSchema = z.object({
     nickname: z.string().min(1).max(100).optional(),
     name: z.string().min(1).max(255).optional(),
     phoneNumber: z.string().max(20).optional(),
     preferences: z.record(z.any()).optional(),
   });

   export const SingerRequestSchema = z.object({
     venueId: z.string().uuid(),
     artist: z.string().min(1).max(255),
     title: z.string().min(1).max(255),
     keyChange: z.number().int().min(-12).max(12).default(0),
     notes: z.string().max(500).optional(),
   });

   export const RequestParamsSchema = z.object({
     id: z.coerce.number().int().positive(),
   });

   export const SingerRequestResponseSchema = z.object({
     id: z.number(),
     venueId: z.string().uuid(),
     venueName: z.string(),
     venueUrlName: z.string(),
     artist: z.string(),
     title: z.string(),
     keyChange: z.number(),
     notes: z.string().nullable(),
     requestedAt: z.string().datetime(),
     processed: z.boolean(),
     processedAt: z.string().datetime().nullable(),
   });

   export const UpdateEmailSchema = z.object({
     newEmail: EmailSchema,
     password: z.string().min(1),
   });

   export const ChangePasswordSchema = z.object({
     currentPassword: z.string().min(1),
     newPassword: PasswordSchema,
   });

   export const UpdatePhoneNumberSchema = z.object({
     phoneNumber: z.string().regex(/^\+[1-9]\d{1,14}$/, 'Must be in E.164 format'),
     password: z.string().min(1),
   });

   export const VerifyPhoneNumberSchema = z.object({
     code: z.string().length(6, 'Code must be 6 digits'),
   });
   ```

2. **Implement profile routes in `apps/api/src/routes/singer/profile.ts`:**
   ```typescript
   import { FastifyPluginAsync } from 'fastify';
   import { validateBody } from '@singr/shared/validation';
   import { UpdateSingerProfileSchema } from './schemas';
   import { createLogger } from '@singr/observability';

   const logger = createLogger('routes:singer:profile');

   export const profileRoute: FastifyPluginAsync = async (server) => {
     // Get current profile
     server.get(
       '/profile',
       {
         schema: {
           tags: ['singer'],
           summary: 'Get singer profile',
           description: 'Retrieve current singer profile information',
           security: [{ bearerAuth: [] }],
           response: {
             200: {
               description: 'Singer profile',
               type: 'object',
               properties: {
                 id: { type: 'string', format: 'uuid' },
                 userId: { type: 'string', format: 'uuid' },
                 nickname: { type: 'string' },
                 email: { type: 'string' },
                 name: { type: 'string' },
                 phoneNumber: { type: 'string' },
                 preferences: { type: 'object' },
               },
             },
             404: {
               description: 'Profile not found',
             },
           },
         },
         preHandler: [server.authenticate],
       },
       async (request, reply) => {
         const userId = request.user.sub;

         const user = await server.prisma.user.findUnique({
           where: { id: userId },
           include: {
             singerProfile: true,
           },
         });

         if (!user?.singerProfile) {
           return reply.code(404).send({
             type: 'resource_not_found',
             title: 'Singer Profile Not Found',
             detail: 'No singer profile exists for this user',
           });
         }

         return reply.send({
           id: user.singerProfile.id,
           userId: user.id,
           nickname: user.singerProfile.nickname,
           avatarUrl: user.singerProfile.avatarUrl,
           email: user.email,
           name: user.name,
           phoneNumber: user.phoneNumber,
           preferences: user.singerProfile.preferences,
           createdAt: user.singerProfile.createdAt.toISOString(),
         });
       }
     );

     // Update profile
     server.patch(
       '/profile',
       {
         schema: {
           tags: ['singer'],
           summary: 'Update singer profile',
           description: 'Update singer profile information',
           security: [{ bearerAuth: [] }],
           body: {
             type: 'object',
             properties: {
               nickname: { type: 'string', minLength: 1, maxLength: 100 },
               name: { type: 'string', minLength: 1, maxLength: 255 },
               phoneNumber: { type: 'string', maxLength: 20 },
               preferences: { type: 'object' },
             },
           },
           response: {
             200: {
               description: 'Profile updated',
               type: 'object',
               properties: {
                 id: { type: 'string', format: 'uuid' },
                 nickname: { type: 'string' },
                 name: { type: 'string' },
               },
             },
           },
         },
         preHandler: [server.authenticate, validateBody(UpdateSingerProfileSchema)],
       },
       async (request, reply) => {
         const userId = request.user.sub;
         const body = request.body as z.infer<typeof UpdateSingerProfileSchema>;

         const user = await server.prisma.user.findUnique({
           where: { id: userId },
           include: { singerProfile: true },
         });

         if (!user?.singerProfile) {
           return reply.code(404).send({
             type: 'resource_not_found',
             title: 'Singer Profile Not Found',
             detail: 'No singer profile exists for this user',
           });
         }

         // Update user fields
         const userUpdate: any = {};
         if (body.name !== undefined) userUpdate.name = body.name;
         if (body.phoneNumber !== undefined) userUpdate.phoneNumber = body.phoneNumber;

         // Update singer profile fields
         const profileUpdate: any = {};
         if (body.nickname !== undefined) profileUpdate.nickname = body.nickname;
         if (body.preferences !== undefined) {
           profileUpdate.preferences = {
             ...user.singerProfile.preferences,
             ...body.preferences,
           };
         }

         // Execute updates
         const [updatedUser, updatedProfile] = await Promise.all([
           Object.keys(userUpdate).length > 0
             ? server.prisma.user.update({
                 where: { id: userId },
                 data: userUpdate,
               })
             : Promise.resolve(user),
           Object.keys(profileUpdate).length > 0
             ? server.prisma.singerProfile.update({
                 where: { id: user.singerProfile.id },
                 data: profileUpdate,
               })
             : Promise.resolve(user.singerProfile),
         ]);

         logger.info({ userId, singerProfileId: updatedProfile.id }, 'Singer profile updated');

         return reply.send({
           id: updatedProfile.id,
           userId: updatedUser.id,
           nickname: updatedProfile.nickname,
           avatarUrl: updatedProfile.avatarUrl,
           email: updatedUser.email,
           name: updatedUser.name,
           phoneNumber: updatedUser.phoneNumber,
           preferences: updatedProfile.preferences,
           createdAt: updatedProfile.createdAt.toISOString(),
         });
       }
     );
   };
   ```

**Deliverables:**
- ✅ `GET /v1/singer/profile` - Retrieve current profile
- ✅ `PATCH /v1/singer/profile` - Update nickname, name, phone, preferences
- ✅ Authenticated access required
- ✅ Preferences stored as JSON

---

### 6.2 Authenticated Request Submission

**Objective:** Allow authenticated singers to submit requests with tracking.

**Duration:** 1-2 days  
**Team Size:** 1 developer

**Tasks:**

1. **Implement singer request routes in `apps/api/src/routes/singer/requests.ts`:**
   ```typescript
   import { FastifyPluginAsync } from 'fastify';
   import { validateBody, validateParams } from '@singr/shared/validation';
   import { SingerRequestSchema, RequestParamsSchema } from './schemas';
   import { RequestService } from '@singr/shared/services/request-service';
   import { createLogger } from '@singr/observability';

   const logger = createLogger('routes:singer:requests');

   export const requestsRoute: FastifyPluginAsync = async (server) => {
     const requestService = new RequestService(server.prisma, server.redis);

     // Submit authenticated request
     server.post(
       '/requests',
       {
         schema: {
           tags: ['singer'],
           summary: 'Submit song request',
           description: 'Submit a song request as an authenticated singer',
           security: [{ bearerAuth: [] }],
           body: {
             type: 'object',
             required: ['venueId', 'artist', 'title'],
             properties: {
               venueId: { type: 'string', format: 'uuid' },
               artist: { type: 'string' },
               title: { type: 'string' },
               keyChange: { type: 'integer', minimum: -12, maximum: 12, default: 0 },
               notes: { type: 'string', maxLength: 500 },
             },
           },
           response: {
             201: {
               description: 'Request created',
               type: 'object',
               properties: {
                 id: { type: 'integer' },
                 venueId: { type: 'string', format: 'uuid' },
                 venueName: { type: 'string' },
                 artist: { type: 'string' },
                 title: { type: 'string' },
               },
             },
           },
         },
         preHandler: [server.authenticate, validateBody(SingerRequestSchema)],
         config: {
           rateLimit: {
             max: 10,
             timeWindow: '1 hour',
           },
         },
       },
       async (request, reply) => {
         const body = request.body as z.infer<typeof SingerRequestSchema>;
         const userId = request.user.sub;

         // Get singer profile
         const singerProfile = await server.prisma.singerProfile.findUnique({
           where: { userId },
         });

         if (!singerProfile) {
           return reply.code(404).send({
             type: 'resource_not_found',
             title: 'Singer Profile Not Found',
             detail: 'No singer profile found for this user',
           });
         }

         try {
           const result = await requestService.createRequest({
             venueId: body.venueId,
             artist: body.artist,
             title: body.title,
             keyChange: body.keyChange,
             notes: body.notes,
             singerProfileId: singerProfile.id,
             submittedByUserId: userId,
           });

           return reply.code(201).send(result);
         } catch (error) {
           if (error instanceof Error) {
             if (error.message.includes('not found')) {
               return reply.code(404).send({
                 type: 'resource_not_found',
                 title: 'Venue Not Found',
                 detail: error.message,
               });
             }

             if (error.message.includes('rate limit')) {
               return reply.code(429).send({
                 type: 'rate_limited',
                 title: 'Too Many Requests',
                 detail: error.message,
               });
             }

             if (error.message.includes('not accepting')) {
               return reply.code(422).send({
                 type: 'unprocessable_entity',
                 title: 'Requests Not Accepted',
                 detail: error.message,
               });
             }
           }

           throw error;
         }
       }
     );

     // Get specific request
     server.get(
       '/requests/:id',
       {
         schema: {
           tags: ['singer'],
           summary: 'Get request details',
           description: 'Retrieve details of a specific request',
           security: [{ bearerAuth: [] }],
           params: {
             type: 'object',
             properties: {
               id: { type: 'integer' },
             },
           },
           response: {
             200: {
               description: 'Request details',
               type: 'object',
               properties: {
                 id: { type: 'integer' },
                 venueId: { type: 'string', format: 'uuid' },
                 venueName: { type: 'string' },
                 artist: { type: 'string' },
                 title: { type: 'string' },
                 keyChange: { type: 'integer' },
                 processed: { type: 'boolean' },
               },
             },
             404: {
               description: 'Request not found',
             },
           },
         },
         preHandler: [server.authenticate, validateParams(RequestParamsSchema)],
       },
       async (request, reply) => {
         const { id } = request.params as z.infer<typeof RequestParamsSchema>;
         const userId = request.user.sub;

         const requestRecord = await server.prisma.request.findFirst({
           where: {
             id: BigInt(id),
             submittedByUserId: userId,
           },
           include: {
             venue: {
               select: {
                 id: true,
                 name: true,
                 urlName: true,
               },
             },
           },
         });

         if (!requestRecord) {
           return reply.code(404).send({
             type: 'resource_not_found',
             title: 'Request Not Found',
             detail: 'Request not found or access denied',
           });
         }

         return reply.send({
           id: Number(requestRecord.id),
           venueId: requestRecord.venueId,
           venueName: requestRecord.venue.name,
           venueUrlName: requestRecord.venue.urlName,
           artist: requestRecord.artist,
           title: requestRecord.title,
           keyChange: requestRecord.keyChange,
           notes: requestRecord.notes,
           requestedAt: requestRecord.requestedAt.toISOString(),
           processed: requestRecord.processed,
           processedAt: requestRecord.processedAt?.toISOString() || null,
         });
       }
     );
   };
   ```

**Deliverables:**
- ✅ `POST /v1/singer/requests` - Authenticated request submission
- ✅ `GET /v1/singer/requests/:id` - View specific request
- ✅ Automatic request history tracking
- ✅ User-specific rate limiting (10 req/hour)
- ✅ Authorization: users can only view their own requests

---

### 6.3 Singer Account Management

**Objective:** Allow singers to update email, change password, and manage account with email/SMS verification.

**Duration:** 2-3 days  
**Team Size:** 1 developer

**Tasks:**

1. **Implement account management routes in `apps/api/src/routes/singer/account.ts`:**
   ```typescript
   import { FastifyPluginAsync } from 'fastify';
   import { validateBody } from '@singr/shared/validation';
   import {
     UpdateEmailSchema,
     ChangePasswordSchema,
     UpdatePhoneNumberSchema,
     VerifyPhoneNumberSchema,
   } from './schemas';
   import { verifyPassword, hashPassword, RefreshTokenService } from '@singr/auth';
   import { randomUUID } from 'crypto';
   import { createLogger } from '@singr/observability';
   import { createCommunicationQueue } from '@singr/shared/queues/communication-queue';
   import { SMSService } from '@singr/shared/services/sms/sms-service';
   import { config, TOKEN_EXPIRY } from '@singr/config';

   const logger = createLogger('routes:singer:account');

   export const accountRoute: FastifyPluginAsync = async (server) => {
     const communicationQueue = createCommunicationQueue(server.redis);
     const smsService = new SMSService();

     // Update email
     server.patch(
       '/account/email',
       {
         schema: {
           tags: ['singer'],
           summary: 'Update email',
           description: 'Change email address (requires password confirmation)',
           security: [{ bearerAuth: [] }],
           body: {
             type: 'object',
             required: ['newEmail', 'password'],
             properties: {
               newEmail: { type: 'string', format: 'email' },
               password: { type: 'string' },
             },
           },
           response: {
             200: {
               description: 'Email updated',
               type: 'object',
               properties: {
                 email: { type: 'string' },
                 isEmailVerified: { type: 'boolean' },
                 message: { type: 'string' },
               },
             },
             401: {
               description: 'Invalid password',
             },
             409: {
               description: 'Email already exists',
             },
           },
         },
         preHandler: [server.authenticate, validateBody(UpdateEmailSchema)],
         config: {
           rateLimit: {
             max: 5,
             timeWindow: '1 hour',
           },
         },
       },
       async (request, reply) => {
         const { newEmail, password } = request.body as z.infer<
           typeof UpdateEmailSchema
         >;
         const userId = request.user.sub;

         // Get user
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
           logger.warn({ userId }, 'Email update failed - invalid password');
           return reply.code(401).send({
             type: 'authentication_failed',
             title: 'Authentication Failed',
             detail: 'Current password is incorrect',
           });
         }

         // Check if new email already exists
         const existingUser = await server.prisma.user.findUnique({
           where: { email: newEmail.toLowerCase() },
         });

         if (existingUser) {
           return reply.code(409).send({
             type: 'conflict',
             title: 'Email Already Exists',
             detail: 'This email is already registered',
           });
         }

         // Update email and mark as unverified
         const updatedUser = await server.prisma.user.update({
           where: { id: userId },
           data: {
             email: newEmail.toLowerCase(),
             isEmailVerified: false,
           },
         });

         // Create verification token
         const verificationToken = randomUUID();
         await server.prisma.verificationToken.create({
           data: {
             identifier: newEmail.toLowerCase(),
             token: verificationToken,
             expiresAt: new Date(Date.now() + TOKEN_EXPIRY.EMAIL_VERIFICATION),
           },
         });

         // Enqueue verification email
         await communicationQueue.add('email', {
           type: 'email',
           to: newEmail,
           toName: user.name || undefined,
           subject: 'Verify your new email address',
           templateId: config.MAILJET_TEMPLATE_VERIFICATION,
           variables: {
             user_name: user.name || newEmail.split('@')[0],
             verification_link: `${config.APP_URL_WEB}/verify-email?token=${verificationToken}`,
             verification_code: verificationToken.substring(0, 6).toUpperCase(),
             expiry_hours: Math.floor(TOKEN_EXPIRY.EMAIL_VERIFICATION / (1000 * 60 * 60)),
           },
         });

         // Send notification to old email
         await communicationQueue.add('email', {
           type: 'email',
           to: user.email,
           toName: user.name || undefined,
           subject: 'Your Singr email has been changed',
           htmlPart: `
             <h2>Email Address Changed</h2>
             <p>Hello ${user.name || 'there'},</p>
             <p>Your Singr email address has been changed to: <strong>${newEmail}</strong></p>
             <p>If you did not make this change, please contact support immediately.</p>
           `,
           textPart: `Your Singr email address has been changed to: ${newEmail}. If you did not make this change, please contact support immediately.`,
         });

         logger.info({ userId, oldEmail: user.email, newEmail }, 'Email updated');

         return reply.send({
           email: updatedUser.email,
           isEmailVerified: updatedUser.isEmailVerified,
           message: 'Email updated. Please check your inbox to verify.',
         });
       }
     );

     // Change password
     server.post(
       '/account/password',
       {
         schema: {
           tags: ['singer'],
           summary: 'Change password',
           description: 'Change account password (revokes all sessions)',
           security: [{ bearerAuth: [] }],
           body: {
             type: 'object',
             required: ['currentPassword', 'newPassword'],
             properties: {
               currentPassword: { type: 'string' },
               newPassword: { type: 'string', minLength: 8 },
             },
           },
           response: {
             200: {
               description: 'Password changed',
               type: 'object',
               properties: {
                 message: { type: 'string' },
               },
             },
             401: {
               description: 'Invalid password',
             },
           },
         },
         preHandler: [server.authenticate, validateBody(ChangePasswordSchema)],
         config: {
           rateLimit: {
             max: 5,
             timeWindow: '1 hour',
           },
         },
       },
       async (request, reply) => {
         const { currentPassword, newPassword } = request.body as z.infer<
           typeof ChangePasswordSchema
         >;
         const userId = request.user.sub;

         // Get user
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

         // Verify current password
         const validPassword = await verifyPassword(user.passwordHash, currentPassword);

         if (!validPassword) {
           logger.warn({ userId }, 'Password change failed - invalid password');
           return reply.code(401).send({
             type: 'authentication_failed',
             title: 'Authentication Failed',
             detail: 'Current password is incorrect',
           });
         }

         // Hash new password
         const newPasswordHash = await hashPassword(newPassword);

         // Update password
         await server.prisma.user.update({
           where: { id: userId },
           data: {
             passwordHash: newPasswordHash,
             passwordAlgo: 'argon2id',
           },
         });

         // Revoke all existing sessions
         const refreshTokenService = new RefreshTokenService(server.redis);
         await refreshTokenService.revoke(userId);
         await refreshTokenService.revokeJTI(request.user.jti);

         // Send confirmation email
         await communicationQueue.add('email', {
           type: 'email',
           to: user.email,
           toName: user.name || undefined,
           subject: 'Your Singr password has been changed',
           htmlPart: `
             <h2>Password Changed</h2>
             <p>Hello ${user.name || 'there'},</p>
             <p>Your Singr password has been successfully changed.</p>
             <p>If you did not make this change, please contact support immediately.</p>
             <p><a href="${config.APP_URL_WEB}/signin">Sign in to your account</a></p>
           `,
           textPart: `Your Singr password has been successfully changed. If you did not make this change, please contact support immediately.`,
         });

         logger.info({ userId }, 'Password changed');

         return reply.send({
           message: 'Password changed successfully. Please sign in again.',
         });
       }
     );

     // Update phone number (initiates SMS verification)
     server.patch(
       '/account/phone',
       {
         schema: {
           tags: ['singer'],
           summary: 'Update phone number',
           description: 'Change phone number and initiate SMS verification',
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
         preHandler: [server.authenticate, validateBody(UpdatePhoneNumberSchema)],
         config: {
           rateLimit: {
             max: 5,
             timeWindow: '1 hour',
           },
         },
       },
       async (request, reply) => {
         const { phoneNumber, password } = request.body as z.infer<
           typeof UpdatePhoneNumberSchema
         >;
         const userId = request.user.sub;

         // Get user
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
           logger.warn({ userId }, 'Phone update failed - invalid password');
           return reply.code(401).send({
             type: 'authentication_failed',
             title: 'Authentication Failed',
             detail: 'Password is incorrect',
           });
         }

         // Generate verification code
         const verificationCode = smsService.generateVerificationCode();

         // Store pending phone number and code in Redis (5 minutes TTL)
         await server.redis.setex(
           `phone_verification:${userId}`,
           300,
           JSON.stringify({
             phoneNumber,
             code: verificationCode,
             attempts: 0,
           })
         );

         // Send SMS verification code
         await communicationQueue.add('sms', {
           type: 'sms',
           to: phoneNumber,
           body: `Your Singr verification code is: ${verificationCode}. Valid for 5 minutes.`,
         });

         logger.info({ userId, phoneNumber }, 'Phone verification code sent');

         return reply.send({
           message: 'Verification code sent to your phone',
           phoneNumber,
         });
       }
     );

     // Verify phone number
     server.post(
       '/account/phone/verify',
       {
         schema: {
           tags: ['singer'],
           summary: 'Verify phone number',
           description: 'Complete phone number verification with SMS code',
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
               description: 'Phone verified',
               type: 'object',
               properties: {
                 phoneNumber: { type: 'string' },
                 message: { type: 'string' },
               },
             },
             400: {
               description: 'Invalid or expired code',
             },
           },
         },
         preHandler: [server.authenticate, validateBody(VerifyPhoneNumberSchema)],
         config: {
           rateLimit: {
             max: 10,
             timeWindow: '15 minutes',
           },
         },
       },
       async (request, reply) => {
         const { code } = request.body as z.infer<typeof VerifyPhoneNumberSchema>;
         const userId = request.user.sub;

         // Get pending verification from Redis
         const pendingData = await server.redis.get(`phone_verification:${userId}`);

         if (!pendingData) {
           return reply.code(400).send({
             type: 'invalid_code',
             title: 'Invalid or Expired Code',
             detail: 'Verification code has expired or does not exist',
           });
         }

         const pending = JSON.parse(pendingData);

         // Check attempt count
         if (pending.attempts >= 5) {
           await server.redis.del(`phone_verification:${userId}`);
           return reply.code(429).send({
             type: 'too_many_attempts',
             title: 'Too Many Attempts',
             detail: 'Maximum verification attempts exceeded. Please request a new code.',
           });
         }

         // Verify code
         if (pending.code !== code) {
           pending.attempts++;
           await server.redis.setex(
             `phone_verification:${userId}`,
             300,
             JSON.stringify(pending)
           );

           logger.warn({ userId, attempts: pending.attempts }, 'Invalid phone verification code');

           return reply.code(400).send({
             type: 'invalid_code',
             title: 'Invalid Code',
             detail: `Verification code is incorrect. ${5 - pending.attempts} attempts remaining.`,
           });
         }

         // Update phone number
         await server.prisma.user.update({
           where: { id: userId },
           data: {
             phoneNumber: pending.phoneNumber,
           },
         });

         // Delete verification data
         await server.redis.del(`phone_verification:${userId}`);

         // Send confirmation email
         const user = await server.prisma.user.findUnique({
           where: { id: userId },
         });

         if (user) {
           await communicationQueue.add('email', {
             type: 'email',
             to: user.email,
             toName: user.name || undefined,
             subject: 'Your phone number has been verified',
             htmlPart: `
               <h2>Phone Number Verified</h2>
               <p>Hello ${user.name || 'there'},</p>
               <p>Your phone number <strong>${pending.phoneNumber}</strong> has been successfully verified.</p>
               <p>If you did not make this change, please contact support immediately.</p>
             `,
             textPart: `Your phone number ${pending.phoneNumber} has been successfully verified. If you did not make this change, please contact support immediately.`,
           });
         }

         logger.info({ userId, phoneNumber: pending.phoneNumber }, 'Phone number verified');

         return reply.send({
           phoneNumber: pending.phoneNumber,
           message: 'Phone number verified successfully',
         });
       }
     );

     // Delete account
     server.delete(
       '/account',
       {
         schema: {
           tags: ['singer'],
           summary: 'Delete account',
           description: 'Permanently delete singer account (requires password)',
           security: [{ bearerAuth: [] }],
           body: {
             type: 'object',
             required: ['password'],
             properties: {
               password: { type: 'string' },
             },
           },
           response: {
             204: {
               description: 'Account deleted',
             },
             401: {
               description: 'Invalid password',
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

         // Get user
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
           logger.warn({ userId }, 'Account deletion failed - invalid password');
           return reply.code(401).send({
             type: 'authentication_failed',
             title: 'Authentication Failed',
             detail: 'Password is incorrect',
           });
         }

         // Send goodbye email before deletion
         await communicationQueue.add('email', {
           type: 'email',
           to: user.email,
           toName: user.name || undefined,
           subject: 'Your Singr account has been deleted',
           htmlPart: `
             <h2>Account Deleted</h2>
             <p>Hello ${user.name || 'there'},</p>
             <p>Your Singr account has been permanently deleted as requested.</p>
             <p>We're sorry to see you go. If you'd like to return, you can always create a new account.</p>
             <p>If you did not request this deletion, please contact support immediately at support@singrkaraoke.com</p>
           `,
           textPart: `Your Singr account has been permanently deleted. If you did not request this, please contact support at support@singrkaraoke.com`,
         });

         // Delete user (cascades to profiles, requests, etc.)
         await server.prisma.user.delete({
           where: { id: userId },
         });

         // Revoke sessions
         const refreshTokenService = new RefreshTokenService(server.redis);
         await refreshTokenService.revoke(userId);
         await refreshTokenService.revokeJTI(request.user.jti);

         logger.info({ userId, email: user.email }, 'Account deleted');

         return reply.code(204).send();
       }
     );
   };
   ```

2. **Register all singer routes in `apps/api/src/routes/singer/index.ts`:**
   ```typescript
   import { FastifyPluginAsync } from 'fastify';
   import { profileRoute } from './profile';
   import { requestsRoute } from './requests';
   import { accountRoute } from './account';

   export const singerRoutes: FastifyPluginAsync = async (server) => {
     await server.register(profileRoute);
     await server.register(requestsRoute);
     await server.register(accountRoute);
   };
   ```

**Deliverables:**
- ✅ `PATCH /v1/singer/account/email` - Update email with verification
- ✅ `POST /v1/singer/account/password` - Change password
- ✅ `PATCH /v1/singer/account/phone` - Update phone number (initiate SMS verification)
- ✅ `POST /v1/singer/account/phone/verify` - Verify phone with SMS code
- ✅ `DELETE /v1/singer/account` - Delete account
- ✅ Password confirmation required for all operations
- ✅ Session revocation on password change
- ✅ Email notifications for security events via Mailjet
- ✅ SMS verification for phone number changes via Twilio
- ✅ Rate limiting (5 req/hour for sensitive operations)
- ✅ Attempt tracking for SMS verification (max 5 attempts)
- ✅ Redis-based pending verification storage
- ✅ BullMQ queue integration for emails/SMS
- ✅ Comprehensive audit logging
- ✅ Goodbye email on account deletion
- ✅ Confirmation emails for all account changes
- ✅ Security notifications sent to old email addresses

---
