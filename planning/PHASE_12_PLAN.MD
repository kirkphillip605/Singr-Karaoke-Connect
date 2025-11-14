# Singr Central API Backend - Phase 12

**Document Version:** 1.0  
**Last Updated:** 2025-11-12  
**Author:** kirkphillip605  
**Status:** In Development

---

## Phase 12: Organization Users & Team Management

**Objective**: Enable customer organizations to add multiple users with role-based access to manage their venues, systems, and requests collaboratively.

### 12.1 Database Schema Extensions

```sql
-- Migration: 012_organization_users.sql

-- Organization user roles
CREATE TYPE organization_role AS ENUM (
  'owner',      -- Full access, billing, user management
  'admin',      -- Full operational access, no billing
  'manager',    -- Venue/system management, no user management
  'operator'    -- View requests, mark as processed only
);

-- Organization users table
CREATE TABLE organization_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_profile_id UUID NOT NULL REFERENCES customer_profiles(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  role organization_role NOT NULL DEFAULT 'operator',
  invited_by_user_id UUID REFERENCES singr_users(id) ON DELETE SET NULL,
  invitation_token VARCHAR(255),
  invitation_sent_at TIMESTAMPTZ,
  invitation_accepted_at TIMESTAMPTZ,
  singr_user_id UUID UNIQUE REFERENCES singr_users(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT organization_users_email_customer_unique 
    UNIQUE (customer_profile_id, email)
);

CREATE INDEX idx_org_users_customer_profile 
  ON organization_users(customer_profile_id);
CREATE INDEX idx_org_users_singr_user 
  ON organization_users(singr_user_id);
CREATE INDEX idx_org_users_invitation_token 
  ON organization_users(invitation_token) 
  WHERE invitation_token IS NOT NULL;

-- Permissions mapping table
CREATE TABLE organization_user_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_user_id UUID NOT NULL REFERENCES organization_users(id) ON DELETE CASCADE,
  permission_key VARCHAR(100) NOT NULL,
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  granted_by_user_id UUID REFERENCES singr_users(id) ON DELETE SET NULL,
  
  CONSTRAINT org_user_permissions_unique 
    UNIQUE (organization_user_id, permission_key)
);

CREATE INDEX idx_org_user_permissions_user 
  ON organization_user_permissions(organization_user_id);

-- Audit log for organization changes
CREATE TABLE organization_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_profile_id UUID NOT NULL REFERENCES customer_profiles(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES singr_users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL, -- 'user.invited', 'user.removed', 'role.changed', etc.
  target_user_id UUID REFERENCES singr_users(id) ON DELETE SET NULL,
  target_email VARCHAR(255),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_org_audit_customer 
  ON organization_audit_log(customer_profile_id, created_at DESC);
CREATE INDEX idx_org_audit_actor 
  ON organization_audit_log(actor_user_id);

-- Add trigger for updated_at
CREATE TRIGGER update_organization_users_updated_at
  BEFORE UPDATE ON organization_users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE organization_users IS 
  'Team members who can access a customer organization with specific roles';
COMMENT ON TABLE organization_user_permissions IS 
  'Granular permissions for organization users beyond their role';
COMMENT ON TABLE organization_audit_log IS 
  'Audit trail of organization membership and permission changes';
```

### 12.2 Permission System

```typescript
// src/lib/permissions/organization-permissions.ts

import { PrismaClient } from '@prisma/client';
import { logger } from '../logger';

export const ORGANIZATION_PERMISSIONS = {
  // User management
  'org:users:invite': 'Invite new users to organization',
  'org:users:remove': 'Remove users from organization',
  'org:users:update-role': 'Change user roles',
  
  // Venue management
  'venues:create': 'Create new venues',
  'venues:update': 'Update venue details',
  'venues:delete': 'Delete venues',
  'venues:view': 'View venue details',
  
  // System management
  'systems:create': 'Create new systems',
  'systems:update': 'Update systems',
  'systems:delete': 'Delete systems',
  'systems:view': 'View systems',
  
  // Request management
  'requests:view': 'View song requests',
  'requests:process': 'Mark requests as processed',
  'requests:delete': 'Delete requests',
  
  // API key management
  'api-keys:create': 'Generate API keys',
  'api-keys:revoke': 'Revoke API keys',
  'api-keys:view': 'View API keys',
  
  // Billing (owner only)
  'billing:view': 'View subscription and invoices',
  'billing:manage': 'Manage subscription and payment methods',
} as const;

export type OrganizationPermissionKey = keyof typeof ORGANIZATION_PERMISSIONS;

// Role-based permission mapping
export const ROLE_PERMISSIONS: Record<string, OrganizationPermissionKey[]> = {
  owner: Object.keys(ORGANIZATION_PERMISSIONS) as OrganizationPermissionKey[],
  
  admin: [
    'org:users:invite',
    'venues:create', 'venues:update', 'venues:delete', 'venues:view',
    'systems:create', 'systems:update', 'systems:delete', 'systems:view',
    'requests:view', 'requests:process', 'requests:delete',
    'api-keys:create', 'api-keys:revoke', 'api-keys:view',
  ],
  
  manager: [
    'venues:update', 'venues:view',
    'systems:update', 'systems:view',
    'requests:view', 'requests:process', 'requests:delete',
    'api-keys:view',
  ],
  
  operator: [
    'venues:view',
    'systems:view',
    'requests:view',
    'requests:process',
  ],
};

export class OrganizationPermissionService {
  constructor(private prisma: PrismaClient) {}

  async getUserPermissions(
    customerProfileId: string,
    singrUserId: string
  ): Promise<Set<OrganizationPermissionKey>> {
    // Check if user is the customer profile owner
    const customerProfile = await this.prisma.customerProfile.findUnique({
      where: { id: customerProfileId },
      select: { singrUserId: true },
    });

    if (customerProfile?.singrUserId === singrUserId) {
      // Owner has all permissions
      return new Set(Object.keys(ORGANIZATION_PERMISSIONS) as OrganizationPermissionKey[]);
    }

    // Check organization user
    const orgUser = await this.prisma.organizationUser.findFirst({
      where: {
        customerProfileId,
        singrUserId,
        isActive: true,
        invitationAcceptedAt: { not: null },
      },
      include: {
        permissions: {
          select: { permissionKey: true },
        },
      },
    });

    if (!orgUser) {
      return new Set();
    }

    // Get role-based permissions
    const rolePermissions = new Set(ROLE_PERMISSIONS[orgUser.role] || []);

    // Add custom permissions
    orgUser.permissions.forEach((p) => {
      if (p.permissionKey in ORGANIZATION_PERMISSIONS) {
        rolePermissions.add(p.permissionKey as OrganizationPermissionKey);
      }
    });

    return rolePermissions;
  }

  async hasPermission(
    customerProfileId: string,
    singrUserId: string,
    permission: OrganizationPermissionKey
  ): Promise<boolean> {
    const permissions = await this.getUserPermissions(customerProfileId, singrUserId);
    return permissions.has(permission);
  }

  async requirePermission(
    customerProfileId: string,
    singrUserId: string,
    permission: OrganizationPermissionKey
  ): Promise<void> {
    const hasPermission = await this.hasPermission(
      customerProfileId,
      singrUserId,
      permission
    );

    if (!hasPermission) {
      throw new Error(`Permission denied: ${permission}`);
    }
  }
}
```

### 12.3 Organization User Service

```typescript
// src/services/organization-user-service.ts

import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';
import { logger } from '../lib/logger';
import type { FastifyInstance } from 'fastify';

export interface InviteUserInput {
  email: string;
  role: 'admin' | 'manager' | 'operator';
  customPermissions?: string[];
}

export interface UpdateUserInput {
  role?: 'admin' | 'manager' | 'operator';
  isActive?: boolean;
  customPermissions?: string[];
}

export class OrganizationUserService {
  constructor(
    private prisma: PrismaClient,
    private server: FastifyInstance
  ) {}

  /**
   * Invite a new user to the organization
   */
  async inviteUser(
    customerProfileId: string,
    invitedByUserId: string,
    input: InviteUserInput
  ) {
    const { email, role, customPermissions = [] } = input;

    // Check if user already exists
    const existing = await this.prisma.organizationUser.findUnique({
      where: {
        organizationUsers_customerProfileId_email_key: {
          customerProfileId,
          email: email.toLowerCase(),
        },
      },
    });

    if (existing) {
      if (existing.invitationAcceptedAt) {
        throw new Error('User is already a member of this organization');
      }
      // Resend invitation
      return this.resendInvitation(existing.id, invitedByUserId);
    }

    const invitationToken = randomBytes(32).toString('hex');

    const orgUser = await this.prisma.organizationUser.create({
      data: {
        customerProfileId,
        email: email.toLowerCase(),
        role,
        invitedByUserId,
        invitationToken,
        invitationSentAt: new Date(),
      },
    });

    // Add custom permissions
    if (customPermissions.length > 0) {
      await this.prisma.organizationUserPermission.createMany({
        data: customPermissions.map((permissionKey) => ({
          organizationUserId: orgUser.id,
          permissionKey,
          grantedByUserId: invitedByUserId,
        })),
        skipDuplicates: true,
      });
    }

    // Log audit entry
    await this.prisma.organizationAuditLog.create({
      data: {
        customerProfileId,
        actorUserId: invitedByUserId,
        action: 'user.invited',
        targetEmail: email,
        metadata: { role, customPermissions },
      },
    });

    // Enqueue invitation email
    await this.server.queue.add('email', {
      type: 'organization_invitation',
      to: email,
      data: {
        invitationToken,
        role,
        inviterEmail: invitedByUserId, // Should fetch inviter details
      },
    });

    logger.info('Organization user invited', {
      customerProfileId,
      email,
      role,
      orgUserId: orgUser.id,
    });

    return {
      id: orgUser.id,
      email: orgUser.email,
      role: orgUser.role,
      invitationSentAt: orgUser.invitationSentAt,
    };
  }

  /**
   * Accept an organization invitation
   */
  async acceptInvitation(invitationToken: string, singrUserId: string) {
    const orgUser = await this.prisma.organizationUser.findFirst({
      where: {
        invitationToken,
        invitationAcceptedAt: null,
      },
    });

    if (!orgUser) {
      throw new Error('Invalid or expired invitation');
    }

    // Check if token is expired (7 days)
    const expirationDate = new Date(orgUser.invitationSentAt);
    expirationDate.setDate(expirationDate.getDate() + 7);

    if (new Date() > expirationDate) {
      throw new Error('Invitation has expired');
    }

    // Verify email matches the user's account
    const singrUser = await this.prisma.singrUser.findUnique({
      where: { id: singrUserId },
      select: { email: true },
    });

    if (singrUser?.email.toLowerCase() !== orgUser.email.toLowerCase()) {
      throw new Error('Email mismatch: This invitation was sent to a different email address');
    }

    // Accept invitation
    const updated = await this.prisma.organizationUser.update({
      where: { id: orgUser.id },
      data: {
        singrUserId,
        invitationAcceptedAt: new Date(),
        invitationToken: null,
        isActive: true,
      },
    });

    // Log audit entry
    await this.prisma.organizationAuditLog.create({
      data: {
        customerProfileId: orgUser.customerProfileId,
        actorUserId: singrUserId,
        action: 'user.accepted_invitation',
        targetUserId: singrUserId,
        targetEmail: orgUser.email,
      },
    });

    logger.info('Organization invitation accepted', {
      orgUserId: orgUser.id,
      customerProfileId: orgUser.customerProfileId,
      singrUserId,
    });

    return updated;
  }

  /**
   * Resend an invitation
   */
  async resendInvitation(orgUserId: string, resendByUserId: string) {
    const orgUser = await this.prisma.organizationUser.findUnique({
      where: { id: orgUserId },
    });

    if (!orgUser) {
      throw new Error('Organization user not found');
    }

    if (orgUser.invitationAcceptedAt) {
      throw new Error('User has already accepted the invitation');
    }

    const newToken = randomBytes(32).toString('hex');

    const updated = await this.prisma.organizationUser.update({
      where: { id: orgUserId },
      data: {
        invitationToken: newToken,
        invitationSentAt: new Date(),
      },
    });

    // Enqueue invitation email
    await this.server.queue.add('email', {
      type: 'organization_invitation',
      to: orgUser.email,
      data: {
        invitationToken: newToken,
        role: orgUser.role,
      },
    });

    logger.info('Organization invitation resent', {
      orgUserId,
      customerProfileId: orgUser.customerProfileId,
    });

    return updated;
  }

  /**
   * Update organization user role and permissions
   */
  async updateUser(
    orgUserId: string,
    updatedByUserId: string,
    input: UpdateUserInput
  ) {
    const orgUser = await this.prisma.organizationUser.findUnique({
      where: { id: orgUserId },
      include: { permissions: true },
    });

    if (!orgUser) {
      throw new Error('Organization user not found');
    }

    const updateData: any = { updatedAt: new Date() };

    if (input.role !== undefined) {
      updateData.role = input.role;
    }

    if (input.isActive !== undefined) {
      updateData.isActive = input.isActive;
    }

    const updated = await this.prisma.organizationUser.update({
      where: { id: orgUserId },
      data: updateData,
    });

    // Update custom permissions if provided
    if (input.customPermissions !== undefined) {
      // Remove existing custom permissions
      await this.prisma.organizationUserPermission.deleteMany({
        where: { organizationUserId: orgUserId },
      });

      // Add new permissions
      if (input.customPermissions.length > 0) {
        await this.prisma.organizationUserPermission.createMany({
          data: input.customPermissions.map((permissionKey) => ({
            organizationUserId: orgUserId,
            permissionKey,
            grantedByUserId: updatedByUserId,
          })),
        });
      }
    }

    // Log audit entry
    await this.prisma.organizationAuditLog.create({
      data: {
        customerProfileId: orgUser.customerProfileId,
        actorUserId: updatedByUserId,
        action: 'user.updated',
        targetUserId: orgUser.singrUserId,
        targetEmail: orgUser.email,
        metadata: input,
      },
    });

    logger.info('Organization user updated', {
      orgUserId,
      customerProfileId: orgUser.customerProfileId,
      changes: input,
    });

    return updated;
  }

  /**
   * Remove user from organization
   */
  async removeUser(orgUserId: string, removedByUserId: string) {
    const orgUser = await this.prisma.organizationUser.findUnique({
      where: { id: orgUserId },
    });

    if (!orgUser) {
      throw new Error('Organization user not found');
    }

    // Log audit entry before deletion
    await this.prisma.organizationAuditLog.create({
      data: {
        customerProfileId: orgUser.customerProfileId,
        actorUserId: removedByUserId,
        action: 'user.removed',
        targetUserId: orgUser.singrUserId,
        targetEmail: orgUser.email,
        metadata: { role: orgUser.role },
      },
    });

    await this.prisma.organizationUser.delete({
      where: { id: orgUserId },
    });

    logger.info('Organization user removed', {
      orgUserId,
      customerProfileId: orgUser.customerProfileId,
      email: orgUser.email,
    });
  }

  /**
   * List organization users
   */
  async listUsers(customerProfileId: string) {
    const users = await this.prisma.organizationUser.findMany({
      where: { customerProfileId },
      include: {
        singrUser: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
        permissions: {
          select: { permissionKey: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return users.map((user) => ({
      id: user.id,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      user: user.singrUser,
      customPermissions: user.permissions.map((p) => p.permissionKey),
      invitationSentAt: user.invitationSentAt,
      invitationAcceptedAt: user.invitationAcceptedAt,
      createdAt: user.createdAt,
    }));
  }

  /**
   * Get audit log for organization
   */
  async getAuditLog(
    customerProfileId: string,
    options: {
      limit?: number;
      offset?: number;
      action?: string;
    } = {}
  ) {
    const { limit = 50, offset = 0, action } = options;

    const where: any = { customerProfileId };
    if (action) {
      where.action = action;
    }

    const [logs, total] = await Promise.all([
      this.prisma.organizationAuditLog.findMany({
        where,
        include: {
          actorUser: {
            select: { id: true, name: true, email: true },
          },
          targetUser: {
            select: { id: true, name: true, email: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.organizationAuditLog.count({ where }),
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

### 12.4 Organization User Routes

```typescript
// src/routes/v1/customer/organization/users.ts

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { OrganizationUserService } from '../../../../services/organization-user-service';
import { OrganizationPermissionService } from '../../../../lib/permissions/organization-permissions';

const InviteUserSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'manager', 'operator']),
  customPermissions: z.array(z.string()).optional(),
});

const UpdateUserSchema = z.object({
  role: z.enum(['admin', 'manager', 'operator']).optional(),
  isActive: z.boolean().optional(),
  customPermissions: z.array(z.string()).optional(),
});

const AcceptInvitationSchema = z.object({
  invitationToken: z.string().min(1),
});

const organizationUsersRoutes: FastifyPluginAsync = async (server) => {
  const orgUserService = new OrganizationUserService(server.prisma, server);
  const permissionService = new OrganizationPermissionService(server.prisma);

  // List organization users
  server.get(
    '/organization/users',
    {
      schema: {
        tags: ['customer'],
        summary: 'List organization users',
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            description: 'List of organization users',
            type: 'object',
            properties: {
              users: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    email: { type: 'string' },
                    role: { type: 'string' },
                    isActive: { type: 'boolean' },
                    customPermissions: { type: 'array', items: { type: 'string' } },
                    invitationSentAt: { type: 'string', format: 'date-time', nullable: true },
                    invitationAcceptedAt: { type: 'string', format: 'date-time', nullable: true },
                    createdAt: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
      preHandler: [server.authenticate],
    },
    async (request, reply) => {
      const customerProfileId = request.user.activeContext?.id;

      if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
        return reply.code(403).send({
          type: 'authorization_denied',
          title: 'Customer Context Required',
          detail: 'You must be in a customer context',
        });
      }

      const users = await orgUserService.listUsers(customerProfileId);

      return reply.send({ users });
    }
  );

  // Invite user to organization
  server.post(
    '/organization/users',
    {
      schema: {
        tags: ['customer'],
        summary: 'Invite user to organization',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['email', 'role'],
          properties: {
            email: { type: 'string', format: 'email' },
            role: { type: 'string', enum: ['admin', 'manager', 'operator'] },
            customPermissions: { type: 'array', items: { type: 'string' } },
          },
        },
        response: {
          201: {
            description: 'User invited',
            type: 'object',
            properties: {
              id: { type: 'string' },
              email: { type: 'string' },
              role: { type: 'string' },
              invitationSentAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
      preHandler: [server.authenticate],
    },
    async (request, reply) => {
      const customerProfileId = request.user.activeContext?.id;

      if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
        return reply.code(403).send({
          type: 'authorization_denied',
          title: 'Customer Context Required',
          detail: 'You must be in a customer context',
        });
      }

      // Check permission
      await permissionService.requirePermission(
        customerProfileId,
        request.user.id,
        'org:users:invite'
      );

      try {
        const data = InviteUserSchema.parse(request.body);
        const result = await orgUserService.inviteUser(
          customerProfileId,
          request.user.id,
          data
        );

        return reply.code(201).send(result);
      } catch (error) {
        if (error instanceof Error) {
          return reply.code(400).send({
            type: 'invalid_request',
            title: 'Invitation Failed',
            detail: error.message,
          });
        }
        throw error;
      }
    }
  );

  // Accept organization invitation
  server.post(
    '/organization/accept-invitation',
    {
      schema: {
        tags: ['customer'],
        summary: 'Accept organization invitation',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['invitationToken'],
          properties: {
            invitationToken: { type: 'string' },
          },
        },
        response: {
          200: {
            description: 'Invitation accepted',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              customerProfileId: { type: 'string' },
            },
          },
        },
      },
      preHandler: [server.authenticate],
    },
    async (request, reply) => {
      try {
        const { invitationToken } = AcceptInvitationSchema.parse(request.body);
        
        const orgUser = await orgUserService.acceptInvitation(
          invitationToken,
          request.user.id
        );

        return reply.send({
          success: true,
          customerProfileId: orgUser.customerProfileId,
        });
      } catch (error) {
        if (error instanceof Error) {
          return reply.code(400).send({
            type: 'invalid_request',
            title: 'Invitation Failed',
            detail: error.message,
          });
        }
        throw error;
      }
    }
  );

  // Update organization user
  server.patch(
    '/organization/users/:userId',
    {
      schema: {
        tags: ['customer'],
        summary: 'Update organization user',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          properties: {
            userId: { type: 'string', format: 'uuid' },
          },
        },
        body: {
          type: 'object',
          properties: {
            role: { type: 'string', enum: ['admin', 'manager', 'operator'] },
            isActive: { type: 'boolean' },
            customPermissions: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      preHandler: [server.authenticate],
    },
    async (request, reply) => {
      const { userId } = request.params as { userId: string };
      const customerProfileId = request.user.activeContext?.id;

      if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
        return reply.code(403).send({
          type: 'authorization_denied',
          title: 'Customer Context Required',
        });
      }

      // Check permission
      await permissionService.requirePermission(
        customerProfileId,
        request.user.id,
        'org:users:update-role'
      );

      try {
        const data = UpdateUserSchema.parse(request.body);
        const result = await orgUserService.updateUser(userId, request.user.id, data);

        return reply.send(result);
      } catch (error) {
        if (error instanceof Error) {
          return reply.code(400).send({
            type: 'invalid_request',
            title: 'Update Failed',
            detail: error.message,
          });
        }
        throw error;
      }
    }
  );

  // Remove organization user
  server.delete(
    '/organization/users/:userId',
    {
      schema: {
        tags: ['customer'],
        summary: 'Remove user from organization',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          properties: {
            userId: { type: 'string', format: 'uuid' },
          },
        },
        response: {
          204: { description: 'User removed' },
        },
      },
      preHandler: [server.authenticate],
    },
    async (request, reply) => {
      const { userId } = request.params as { userId: string };
      const customerProfileId = request.user.activeContext?.id;

      if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
        return reply.code(403).send({
          type: 'authorization_denied',
          title: 'Customer Context Required',
        });
      }

      // Check permission
      await permissionService.requirePermission(
        customerProfileId,
        request.user.id,
        'org:users:remove'
      );

      try {
        await orgUserService.removeUser(userId, request.user.id);
        return reply.code(204).send();
      } catch (error) {
        if (error instanceof Error) {
          return reply.code(400).send({
            type: 'invalid_request',
            title: 'Remove Failed',
            detail: error.message,
          });
        }
        throw error;
      }
    }
  );

  // Get organization audit log
  server.get(
    '/organization/audit-log',
    {
      schema: {
        tags: ['customer'],
        summary: 'Get organization audit log',
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
            offset: { type: 'integer', minimum: 0, default: 0 },
            action: { type: 'string' },
          },
        },
      },
      preHandler: [server.authenticate],
    },
    async (request, reply) => {
      const customerProfileId = request.user.activeContext?.id;

      if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
        return reply.code(403).send({
          type: 'authorization_denied',
          title: 'Customer Context Required',
        });
      }

      const { limit, offset, action } = request.query as {
        limit?: number;
        offset?: number;
        action?: string;
      };

      const result = await orgUserService.getAuditLog(customerProfileId, {
        limit,
        offset,
        action,
      });

      return reply.send(result);
    }
  );
};

export default organizationUsersRoutes;
```

---
