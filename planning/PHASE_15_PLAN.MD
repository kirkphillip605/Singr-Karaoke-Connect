# Singr Central API Backend - Phase 15

**Document Version:** 1.0  
**Last Updated:** 2025-11-12  
**Author:** kirkphillip605  
**Status:** In Development

---

## Phase 15: Admin & Support Portal Backend

**Objective**: Implement comprehensive admin tooling with full CRUD operations and delegated access system for support users to operate within customer/singer contexts.

### 15.1 Admin & Support Database Schema

```sql
-- Migration: 015_admin_support_system.sql

-- Delegated access sessions for support users
CREATE TABLE delegated_access_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  support_admin_profile_id UUID NOT NULL REFERENCES admin_profiles(id) ON DELETE CASCADE,
  target_singr_user_id UUID NOT NULL REFERENCES singr_users(id) ON DELETE CASCADE,
  target_context_type VARCHAR(20) NOT NULL, -- 'customer', 'singer'
  target_context_id UUID NOT NULL, -- customer_profile_id or singer_profile_id
  session_token VARCHAR(255) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by_admin_id UUID REFERENCES admin_profiles(id) ON DELETE SET NULL,
  
  CONSTRAINT valid_context_type CHECK (target_context_type IN ('customer', 'singer'))
);

CREATE INDEX idx_delegated_sessions_support_admin 
  ON delegated_access_sessions(support_admin_profile_id);
CREATE INDEX idx_delegated_sessions_target_user 
  ON delegated_access_sessions(target_singr_user_id);
CREATE INDEX idx_delegated_sessions_token 
  ON delegated_access_sessions(session_token) 
  WHERE revoked_at IS NULL;
CREATE INDEX idx_delegated_sessions_expires 
  ON delegated_access_sessions(expires_at) 
  WHERE revoked_at IS NULL;

-- Admin action audit log
CREATE TABLE admin_action_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_profile_id UUID NOT NULL REFERENCES admin_profiles(id) ON DELETE CASCADE,
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(50), -- 'user', 'venue', 'subscription', 'request', etc.
  target_id VARCHAR(100),
  metadata JSONB DEFAULT '{}',
  ip_address INET,
  user_agent TEXT,
  delegated_session_id UUID REFERENCES delegated_access_sessions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_admin_audit_admin 
  ON admin_action_audit_log(admin_profile_id, created_at DESC);
CREATE INDEX idx_admin_audit_action 
  ON admin_action_audit_log(action);
CREATE INDEX idx_admin_audit_target 
  ON admin_action_audit_log(target_type, target_id);
CREATE INDEX idx_admin_audit_delegated 
  ON admin_action_audit_log(delegated_session_id) 
  WHERE delegated_session_id IS NOT NULL;

COMMENT ON TABLE delegated_access_sessions IS 
  'Temporary sessions allowing support users to operate as customers or singers';
COMMENT ON TABLE admin_action_audit_log IS 
  'Comprehensive audit log of all admin and support actions';
```

### 15.2 Delegated Access Service

```typescript
// src/services/delegated-access-service.ts

import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';
import { logger } from '../lib/logger';

export interface DelegatedAccessSession {
  id: string;
  sessionToken: string;
  targetUserId: string;
  targetContextType: 'customer' | 'singer';
  targetContextId: string;
  expiresAt: Date;
}

export class DelegatedAccessService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Create delegated access session
   * Allows support user to operate as a customer or singer
   */
  async createDelegatedSession(
    supportAdminProfileId: string,
    targetUserId: string,
    contextType: 'customer' | 'singer',
    durationHours: number = 4
  ): Promise<DelegatedAccessSession> {
    // Verify target user exists and has the requested context
    const targetUser = await this.prisma.singrUser.findUnique({
      where: { id: targetUserId },
      include: {
        customerProfile: true,
        singerProfile: true,
      },
    });

    if (!targetUser) {
      throw new Error('Target user not found');
    }

    let targetContextId: string;

    if (contextType === 'customer') {
      if (!targetUser.customerProfile) {
        throw new Error('User does not have a customer profile');
      }
      targetContextId = targetUser.customerProfile.id;
    } else {
      if (!targetUser.singerProfile) {
        throw new Error('User does not have a singer profile');
      }
      targetContextId = targetUser.singerProfile.id;
    }

    // Generate session token
    const sessionToken = randomBytes(48).toString('hex');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + durationHours);

    // Create session
    const session = await this.prisma.delegatedAccessSession.create({
      data: {
        supportAdminProfileId,
        targetSingrUserId: targetUserId,
        targetContextType: contextType,
        targetContextId,
        sessionToken,
        expiresAt,
        createdByAdminId: supportAdminProfileId,
      },
    });

    // Log admin action
    await this.prisma.adminActionAuditLog.create({
      data: {
        adminProfileId: supportAdminProfileId,
        action: 'delegated_access.created',
        targetType: 'singr_user',
        targetId: targetUserId,
        metadata: {
          contextType,
          contextId: targetContextId,
          expiresAt: expiresAt.toISOString(),
        },
      },
    });

    logger.info('Delegated access session created', {
      supportAdminProfileId,
      targetUserId,
      contextType,
      sessionId: session.id,
      expiresAt,
    });

    return {
      id: session.id,
      sessionToken: session.sessionToken,
      targetUserId: session.targetSingrUserId,
      targetContextType: session.targetContextType as 'customer' | 'singer',
      targetContextId: session.targetContextId,
      expiresAt: session.expiresAt,
    };
  }

  /**
   * Validate and retrieve delegated session
   */
  async validateDelegatedSession(sessionToken: string) {
    const session = await this.prisma.delegatedAccessSession.findFirst({
      where: {
        sessionToken,
        revokedAt: null,
        expiresAt: {
          gt: new Date(),
        },
      },
      include: {
        supportAdminProfile: {
          include: {
            singrUser: {
              select: {
                id: true,
                email: true,
                name: true,
              },
            },
          },
        },
        targetSingrUser: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });

    if (!session) {
      throw new Error('Invalid or expired delegated session');
    }

    return session;
  }

  /**
   * Revoke delegated session
   */
  async revokeDelegatedSession(sessionId: string, revokedByAdminId: string) {
    const session = await this.prisma.delegatedAccessSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new Error('Session not found');
    }

    await this.prisma.delegatedAccessSession.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });

    // Log admin action
    await this.prisma.adminActionAuditLog.create({
      data: {
        adminProfileId: revokedByAdminId,
        action: 'delegated_access.revoked',
        targetType: 'delegated_session',
        targetId: sessionId,
        metadata: {
          originalSupportAdminId: session.supportAdminProfileId,
          targetUserId: session.targetSingrUserId,
        },
      },
    });

    logger.info('Delegated access session revoked', {
      sessionId,
      revokedByAdminId,
    });
  }

  /**
   * List active delegated sessions
   */
  async listActiveSessions(supportAdminProfileId?: string) {
    const where: any = {
      revokedAt: null,
      expiresAt: {
        gt: new Date(),
      },
    };

    if (supportAdminProfileId) {
      where.supportAdminProfileId = supportAdminProfileId;
    }

    const sessions = await this.prisma.delegatedAccessSession.findMany({
      where,
      include: {
        supportAdminProfile: {
          include: {
            singrUser: {
              select: {
                id: true,
                email: true,
                name: true,
              },
            },
          },
        },
        targetSingrUser: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return sessions;
  }

  /**
   * Cleanup expired sessions
   */
  async cleanupExpiredSessions() {
    const result = await this.prisma.delegatedAccessSession.updateMany({
      where: {
        revokedAt: null,
        expiresAt: {
          lt: new Date(),
        },
      },
      data: {
        revokedAt: new Date(),
      },
    });

    logger.info('Cleaned up expired delegated sessions', {
      count: result.count,
    });

    return result.count;
  }
}
```

### 15.3 Admin Utility Service

```typescript
// src/services/admin-utility-service.ts

import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { logger } from '../lib/logger';

export class AdminUtilityService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Generate password reset token for user (admin tool)
   */
  async generatePasswordResetForUser(
    adminProfileId: string,
    targetUserId: string
  ) {
    const user = await this.prisma.singrUser.findUnique({
      where: { id: targetUserId },
    });

    if (!user) {
      throw new Error('User not found');
    }

    const token = randomBytes(32).toString('hex');
    const expires = new Date();
    expires.setHours(expires.getHours() + 24);

    await this.prisma.verificationToken.create({
      data: {
        identifier: user.email,
        token: await bcrypt.hash(token, 10),
        expires,
      },
    });

    // Log admin action
    await this.prisma.adminActionAuditLog.create({
      data: {
        adminProfileId,
        action: 'password_reset.generated',
        targetType: 'singr_user',
        targetId: targetUserId,
        metadata: {
          userEmail: user.email,
          expiresAt: expires.toISOString(),
        },
      },
    });

    logger.info('Password reset generated by admin', {
      adminProfileId,
      targetUserId,
      email: user.email,
    });

    return {
      token,
      resetUrl: `${process.env.APP_URL}/auth/reset-password?token=${token}`,
      expiresAt: expires,
    };
  }

  /**
   * Clear all requests for a venue (mark as processed)
   */
  async clearVenueRequests(
    adminProfileId: string,
    venueId: string,
    markAsProcessed: boolean = true
  ) {
    const venue = await this.prisma.venue.findUnique({
      where: { id: venueId },
      select: {
        id: true,
        name: true,
        customerProfileId: true,
      },
    });

    if (!venue) {
      throw new Error('Venue not found');
    }

    let result;

    if (markAsProcessed) {
      result = await this.prisma.request.updateMany({
        where: {
          venueId,
          processed: false,
        },
        data: {
          processed: true,
        },
      });
    } else {
      result = await this.prisma.request.deleteMany({
        where: { venueId },
      });
    }

    // Log admin action
    await this.prisma.adminActionAuditLog.create({
      data: {
        adminProfileId,
        action: markAsProcessed ? 'venue.requests_cleared' : 'venue.requests_deleted',
        targetType: 'venue',
        targetId: venueId,
        metadata: {
          venueName: venue.name,
          customerProfileId: venue.customerProfileId,
          count: result.count,
        },
      },
    });

    logger.info('Venue requests cleared by admin', {
      adminProfileId,
      venueId,
      count: result.count,
      markAsProcessed,
    });

    return {
      clearedCount: result.count,
      venueName: venue.name,
    };
  }

  /**
   * Toggle venue accepting status
   */
  async toggleVenueAccepting(
    adminProfileId: string,
    venueId: string,
    accepting: boolean
  ) {
    const venue = await this.prisma.venue.update({
      where: { id: venueId },
      data: { acceptingRequests: accepting },
    });

    // Log admin action
    await this.prisma.adminActionAuditLog.create({
      data: {
        adminProfileId,
        action: 'venue.accepting_toggled',
        targetType: 'venue',
        targetId: venueId,
        metadata: {
          venueName: venue.name,
          accepting,
        },
      },
    });

    logger.info('Venue accepting toggled by admin', {
      adminProfileId,
      venueId,
      accepting,
    });

    return venue;
  }

  /**
   * Get platform statistics
   */
  async getPlatformStats() {
    const [
      totalUsers,
      totalCustomers,
      totalSingers,
      activeSubscriptions,
      totalVenues,
      totalRequests,
      requestsToday,
    ] = await Promise.all([
      this.prisma.singrUser.count(),
      this.prisma.customerProfile.count(),
      this.prisma.singerProfile.count(),
      this.prisma.subscription.count({
        where: {
          status: {
            in: ['active', 'trialing'],
          },
        },
      }),
      this.prisma.venue.count(),
      this.prisma.request.count(),
      this.prisma.request.count({
        where: {
          requestedAt: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
          },
        },
      }),
    ]);

    return {
      totalUsers,
      totalCustomers,
      totalSingers,
      activeSubscriptions,
      totalVenues,
      totalRequests,
      requestsToday,
    };
  }

  /**
   * Search users (admin tool)
   */
  async searchUsers(query: string, limit: number = 20) {
    const users = await this.prisma.singrUser.findMany({
      where: {
        OR: [
          {
            email: {
              contains: query,
              mode: 'insensitive',
            },
          },
          {
            name: {
              contains: query,
              mode: 'insensitive',
            },
          },
        ],
      },
      include: {
        customerProfile: {
          select: {
            id: true,
            businessName: true,
          },
        },
        singerProfile: {
          select: {
            id: true,
            nickname: true,
          },
        },
        adminProfile: {
          select: {
            id: true,
            adminLevel: true,
          },
        },
      },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });

    return users.map((user) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      hasCustomerProfile: !!user.customerProfile,
      hasSingerProfile: !!user.singerProfile,
      hasAdminProfile: !!user.adminProfile,
      customerBusinessName: user.customerProfile?.businessName,
      singerNickname: user.singerProfile?.nickname,
      adminLevel: user.adminProfile?.adminLevel,
      createdAt: user.createdAt,
    }));
  }

  /**
   * Get admin audit log
   */
  async getAdminAuditLog(options: {
    adminProfileId?: string;
    action?: string;
    targetType?: string;
    limit?: number;
    offset?: number;
  } = {}) {
    const { adminProfileId, action, targetType, limit = 50, offset = 0 } = options;

    const where: any = {};

    if (adminProfileId) {
      where.adminProfileId = adminProfileId;
    }

    if (action) {
      where.action = action;
    }

    if (targetType) {
      where.targetType = targetType;
    }

    const [logs, total] = await Promise.all([
      this.prisma.adminActionAuditLog.findMany({
        where,
        include: {
          adminProfile: {
            include: {
              singrUser: {
                select: {
                  id: true,
                  email: true,
                  name: true,
                },
              },
            },
          },
          delegatedSession: {
            select: {
              id: true,
              targetSingrUserId: true,
              targetContextType: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.adminActionAuditLog.count({ where }),
    ]);

    return {
      logs,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    };
  }
}
```

### 15.4 Admin Utility Routes

```typescript
// src/routes/v1/admin/utilities.ts

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AdminUtilityService } from '../../../services/admin-utility-service';
import { DelegatedAccessService } from '../../../services/delegated-access-service';

const CreateDelegatedSessionSchema = z.object({
  targetUserId: z.string().uuid(),
  contextType: z.enum(['customer', 'singer']),
  durationHours: z.number().int().min(1).max(24).default(4),
});

const ClearVenueRequestsSchema = z.object({
  venueId: z.string().uuid(),
  markAsProcessed: z.boolean().default(true),
});

const adminUtilityRoutes: FastifyPluginAsync = async (server) => {
  const utilityService = new AdminUtilityService(server.prisma);
  const delegatedService = new DelegatedAccessService(server.prisma);

  // All routes require admin authentication
  server.addHook('preHandler', server.authenticate);
  server.addHook('preHandler', async (request, reply) => {
    if (!request.user.adminProfile) {
      return reply.code(403).send({
        type: 'forbidden',
        title: 'Admin Access Required',
        detail: 'This endpoint requires admin privileges',
      });
    }
  });

  // Get platform statistics
  server.get(
    '/admin/stats',
    {
      schema: {
        tags: ['admin'],
        summary: 'Get platform statistics',
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            description: 'Platform statistics',
            type: 'object',
            properties: {
              totalUsers: { type: 'integer' },
              totalCustomers: { type: 'integer' },
              totalSingers: { type: 'integer' },
              activeSubscriptions: { type: 'integer' },
              totalVenues: { type: 'integer' },
              totalRequests: { type: 'integer' },
              requestsToday: { type: 'integer' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const stats = await utilityService.getPlatformStats();
      return reply.send(stats);
    }
  );

  // Search users
  server.get(
    '/admin/users/search',
    {
      schema: {
        tags: ['admin'],
        summary: 'Search users',
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          required: ['q'],
          properties: {
            q: { type: 'string', minLength: 2 },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          },
        },
      },
    },
    async (request, reply) => {
      const { q, limit } = request.query as { q: string; limit?: number };

      const users = await utilityService.searchUsers(q, limit);
      return reply.send({ users });
    }
  );

  // Generate password reset for user
  server.post(
    '/admin/users/:userId/password-reset',
    {
      schema: {
        tags: ['admin'],
        summary: 'Generate password reset for user',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          properties: {
            userId: { type: 'string', format: 'uuid' },
          },
        },
        response: {
          200: {
            description: 'Password reset generated',
            type: 'object',
            properties: {
              token: { type: 'string' },
              resetUrl: { type: 'string' },
              expiresAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { userId } = request.params as { userId: string };

      // Only super_admin can generate password resets
      if (request.user.adminProfile?.adminLevel !== 'super_admin') {
        return reply.code(403).send({
          type: 'forbidden',
          title: 'Insufficient Permissions',
          detail: 'Only super admins can generate password resets',
        });
      }

      try {
        const result = await utilityService.generatePasswordResetForUser(
          request.user.adminProfile.id,
          userId
        );

        return reply.send(result);
      } catch (error) {
        if (error instanceof Error) {
          return reply.code(400).send({
            type: 'invalid_request',
            title: 'Failed',
            detail: error.message,
          });
        }
        throw error;
      }
    }
  );

  // Clear venue requests
  server.post(
    '/admin/venues/:venueId/clear-requests',
    {
      schema: {
        tags: ['admin'],
        summary: 'Clear all venue requests',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          properties: {
            venueId: { type: 'string', format: 'uuid' },
          },
        },
        body: {
          type: 'object',
          properties: {
            markAsProcessed: { type: 'boolean', default: true },
          },
        },
        response: {
          200: {
            description: 'Requests cleared',
            type: 'object',
            properties: {
              clearedCount: { type: 'integer' },
              venueName: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { venueId } = request.params as { venueId: string };
      const { markAsProcessed } = ClearVenueRequestsSchema.parse(request.body);

      try {
        const result = await utilityService.clearVenueRequests(
          request.user.adminProfile!.id,
          venueId,
          markAsProcessed
        );

        return reply.send(result);
      } catch (error) {
        if (error instanceof Error) {
          return reply.code(400).send({
            type: 'invalid_request',
            title: 'Failed',
            detail: error.message,
          });
        }
        throw error;
      }
    }
  );

  // Create delegated access session
  server.post(
    '/admin/delegated-access',
    {
      schema: {
        tags: ['admin'],
        summary: 'Create delegated access session',
        description: 'Allows support to operate as a customer or singer',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['targetUserId', 'contextType'],
          properties: {
            targetUserId: { type: 'string', format: 'uuid' },
            contextType: { type: 'string', enum: ['customer', 'singer'] },
            durationHours: { type: 'integer', minimum: 1, maximum: 24, default: 4 },
          },
        },
        response: {
          201: {
            description: 'Delegated session created',
            type: 'object',
            properties: {
              id: { type: 'string' },
              sessionToken: { type: 'string' },
              targetUserId: { type: 'string' },
              targetContextType: { type: 'string' },
              targetContextId: { type: 'string' },
              expiresAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const data = CreateDelegatedSessionSchema.parse(request.body);

      try {
        const session = await delegatedService.createDelegatedSession(
          request.user.adminProfile!.id,
          data.targetUserId,
          data.contextType,
          data.durationHours
        );

        return reply.code(201).send(session);
      } catch (error) {
        if (error instanceof Error) {
          return reply.code(400).send({
            type: 'invalid_request',
            title: 'Failed',
            detail: error.message,
          });
        }
        throw error;
      }
    }
  );

  // List active delegated sessions
  server.get(
    '/admin/delegated-access',
    {
      schema: {
        tags: ['admin'],
        summary: 'List active delegated access sessions',
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            description: 'List of active sessions',
            type: 'object',
            properties: {
              sessions: {
                type: 'array',
                items: { type: 'object' },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const sessions = await delegatedService.listActiveSessions();
      return reply.send({ sessions });
    }
  );

  // Revoke delegated session
  server.delete(
    '/admin/delegated-access/:sessionId',
    {
      schema: {
        tags: ['admin'],
        summary: 'Revoke delegated access session',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', format: 'uuid' },
          },
        },
        response: {
          204: { description: 'Session revoked' },
        },
      },
    },
    async (request, reply) => {
      const { sessionId } = request.params as { sessionId: string };

      try {
        await delegatedService.revokeDelegatedSession(
          sessionId,
          request.user.adminProfile!.id
        );

        return reply.code(204).send();
      } catch (error) {
        if (error instanceof Error) {
          return reply.code(400).send({
            type: 'invalid_request',
            title: 'Failed',
            detail: error.message,
          });
        }
        throw error;
      }
    }
  );

  // Get admin audit log
  server.get(
    '/admin/audit-log',
    {
      schema: {
        tags: ['admin'],
        summary: 'Get admin audit log',
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            adminProfileId: { type: 'string', format: 'uuid' },
            action: { type: 'string' },
            targetType: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
            offset: { type: 'integer', minimum: 0, default: 0 },
          },
        },
      },
    },
    async (request, reply) => {
      const options = request.query as {
        adminProfileId?: string;
        action?: string;
        targetType?: string;
        limit?: number;
        offset?: number;
      };

      const result = await utilityService.getAdminAuditLog(options);
      return reply.send(result);
    }
  );
};

export default adminUtilityRoutes;
```

---
