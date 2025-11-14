import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID as uuidv4 } from 'crypto';

import { prisma } from '@singr/database';
import {
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
  generateTokenPair,
  verifyToken,
  RefreshTokenService,
} from '@singr/auth';
import {
  signUpSchema,
  signInSchema,
  refreshTokenSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  type SignUpInput,
  type SignInInput,
  type RefreshTokenInput,
  type ForgotPasswordInput,
  type ResetPasswordInput,
  ValidationError,
  AuthenticationError,
  ConflictError,
  NotFoundError,
} from '@singr/shared';

export default async function authRoutes(server: FastifyInstance) {
  // Sign up
  server.post<{ Body: SignUpInput }>(
    '/signup',
    {
      schema: {
        body: signUpSchema,
        response: {
          201: {
            type: 'object',
            properties: {
              user: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  email: { type: 'string' },
                  name: { type: 'string' },
                },
              },
              accessToken: { type: 'string' },
              refreshToken: { type: 'string' },
              expiresIn: { type: 'number' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { email, password, name, accountType, customerData, singerData } =
        request.body;

      // Validate password strength
      const passwordValidation = validatePasswordStrength(password);
      if (!passwordValidation.valid) {
        throw new ValidationError(
          'Password validation failed',
          passwordValidation.errors.map((err) => ({
            field: 'password',
            message: err,
          }))
        );
      }

      // Check if user already exists
      const existingUser = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
      });

      if (existingUser) {
        throw new ConflictError('User with this email already exists');
      }

      const passwordHash = await hashPassword(password);

      // Create user with profile
      const user = await prisma.user.create({
        data: {
          email: email.toLowerCase(),
          passwordHash,
          passwordAlgo: 'argon2id',
          name,
          ...(accountType === 'customer' && {
            customerProfile: {
              create: {
                legalBusinessName: customerData?.legalBusinessName,
                contactEmail: customerData?.contactEmail || email,
                timezone: customerData?.timezone || 'UTC',
              },
            },
          }),
          ...(accountType === 'singer' && {
            singerProfile: {
              create: {
                nickname: singerData?.nickname,
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
        accountType === 'customer' ? 'customer_owner' : 'singer';
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

      // Generate tokens
      const tokens = generateTokenPair(user.id, user.email);

      request.log.info(
        { userId: user.id, email: user.email, accountType },
        'User created'
      );

      return reply.code(201).send({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
        ...tokens,
      });
    }
  );

  // Sign in
  server.post<{ Body: SignInInput }>(
    '/signin',
    {
      schema: {
        body: signInSchema,
      },
    },
    async (request, reply) => {
      const { email, password } = request.body;

      const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
      });

      if (!user || !user.passwordHash) {
        throw new AuthenticationError('Invalid email or password');
      }

      const isValidPassword = await verifyPassword(user.passwordHash, password);

      if (!isValidPassword) {
        throw new AuthenticationError('Invalid email or password');
      }

      // Update last login
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });

      // Generate tokens
      const tokens = generateTokenPair(user.id, user.email);

      request.log.info({ userId: user.id, email: user.email }, 'User signed in');

      return reply.send({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
        ...tokens,
      });
    }
  );

  // Refresh token
  server.post<{ Body: RefreshTokenInput }>(
    '/refresh',
    {
      schema: {
        body: refreshTokenSchema,
      },
    },
    async (request, reply) => {
      const { refreshToken } = request.body;

      try {
        const decoded = verifyToken(refreshToken);

        // Check if token is revoked
        const refreshTokenService = new RefreshTokenService(server.redis);
        const isRevoked = await refreshTokenService.isJTIRevoked(decoded.jti);

        if (isRevoked) {
          throw new AuthenticationError('Token has been revoked');
        }

        // Generate new token pair
        const tokens = generateTokenPair(decoded.sub, decoded.email);

        // Revoke old refresh token
        await refreshTokenService.revokeToken(
          decoded.jti,
          7 * 24 * 60 * 60 // 7 days
        );

        return reply.send(tokens);
      } catch (error) {
        throw new AuthenticationError('Invalid or expired refresh token');
      }
    }
  );

  // Sign out
  server.post(
    '/logout',
    {
      preHandler: server.authenticate,
    },
    async (request, reply) => {
      const user = request.user as any;

      // Revoke current token
      const refreshTokenService = new RefreshTokenService(server.redis);
      await refreshTokenService.revokeToken(
        user.jti,
        15 * 60 // 15 minutes
      );

      request.log.info({ userId: user.sub }, 'User logged out');

      return reply.code(204).send();
    }
  );

  // Forgot password
  server.post<{ Body: ForgotPasswordInput }>(
    '/forgot-password',
    {
      schema: {
        body: forgotPasswordSchema,
      },
    },
    async (request, reply) => {
      const { email } = request.body;

      const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
      });

      // Always return success to prevent email enumeration
      if (!user) {
        return reply.send({
          message: 'If the email exists, a password reset link has been sent',
        });
      }

      // Create reset token
      const resetToken = randomUUID();
      await prisma.verificationToken.create({
        data: {
          identifier: `reset:${user.email}`,
          token: resetToken,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
        },
      });

      // TODO: Send email with reset link
      request.log.info({ userId: user.id }, 'Password reset requested');

      return reply.send({
        message: 'If the email exists, a password reset link has been sent',
      });
    }
  );

  // Reset password
  server.post<{ Body: ResetPasswordInput }>(
    '/reset-password',
    {
      schema: {
        body: resetPasswordSchema,
      },
    },
    async (request, reply) => {
      const { token, newPassword } = request.body;

      // Validate password strength
      const passwordValidation = validatePasswordStrength(newPassword);
      if (!passwordValidation.valid) {
        throw new ValidationError(
          'Password validation failed',
          passwordValidation.errors.map((err) => ({
            field: 'newPassword',
            message: err,
          }))
        );
      }

      // Find and verify token
      const verificationToken = await prisma.verificationToken.findFirst({
        where: {
          token,
          identifier: { startsWith: 'reset:' },
          expiresAt: { gt: new Date() },
        },
      });

      if (!verificationToken) {
        throw new ValidationError('Invalid or expired reset token');
      }

      const email = verificationToken.identifier.replace('reset:', '');
      const user = await prisma.user.findUnique({ where: { email } });

      if (!user) {
        throw new NotFoundError('User');
      }

      // Update password
      const passwordHash = await hashPassword(newPassword);
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash },
      });

      // Delete verification token
      await prisma.verificationToken.delete({
        where: {
          identifier_token: {
            identifier: verificationToken.identifier,
            token: verificationToken.token,
          },
        },
      });

      // Revoke all existing tokens
      const refreshTokenService = new RefreshTokenService(server.redis);
      await refreshTokenService.revokeAllUserTokens(user.id);

      request.log.info({ userId: user.id }, 'Password reset completed');

      return reply.send({ message: 'Password reset successfully' });
    }
  );
}
