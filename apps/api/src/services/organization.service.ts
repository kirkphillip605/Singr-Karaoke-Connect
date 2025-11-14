import { prisma } from '@singr/database';
import { createLogger } from '@singr/observability';
import { NotFoundError, ConflictError, AuthorizationError } from '@singr/shared';
import { randomBytes } from 'crypto';

const logger = createLogger('service:organization');

export interface InviteUserInput {
  email: string;
  roleId: string;
}

export interface UpdateUserRoleInput {
  roleId: string;
}

export class OrganizationService {
  /**
   * Generate secure invitation token
   */
  private generateInvitationToken(): string {
    return randomBytes(32).toString('base64url');
  }

  /**
   * List organization users
   */
  async listOrganizationUsers(
    customerProfileId: string,
    limit: number,
    offset: number
  ) {
    const [users, total] = await Promise.all([
      prisma.organizationUser.findMany({
        where: { customerProfileId },
        take: limit,
        skip: offset,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
              imageUrl: true,
            },
          },
          role: {
            select: {
              id: true,
              slug: true,
              description: true,
            },
          },
          invitedBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.organizationUser.count({
        where: { customerProfileId },
      }),
    ]);

    return { users, total };
  }

  /**
   * Invite user to organization
   */
  async inviteUser(
    customerProfileId: string,
    invitedByUserId: string,
    input: InviteUserInput
  ) {
    // Check if user already exists in organization
    const existing = await prisma.organizationUser.findUnique({
      where: {
        ux_organization_users_customer_user: {
          customerProfileId,
          userId: input.email, // We'll use email for lookup initially
        },
      },
    });

    if (existing) {
      throw new ConflictError('User is already a member of this organization');
    }

    // Check if email is already registered
    const existingUser = await prisma.user.findUnique({
      where: { email: input.email.toLowerCase() },
    });

    const invitationToken = this.generateInvitationToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry

    const orgUser = await prisma.organizationUser.create({
      data: {
        customerProfileId,
        userId: existingUser?.id || '', // Will be filled when they accept
        invitedByUserId,
        roleId: input.roleId,
        status: 'invited',
        invitationToken,
        invitationExpiresAt: expiresAt,
      },
      include: {
        role: true,
        invitedBy: {
          select: {
            name: true,
            email: true,
          },
        },
      },
    });

    logger.info(
      {
        organizationUserId: orgUser.id,
        customerProfileId,
        email: input.email,
      },
      'User invited to organization'
    );

    // TODO: Send invitation email

    return {
      id: orgUser.id,
      email: input.email,
      role: orgUser.role,
      invitationToken,
      expiresAt,
      status: orgUser.status,
    };
  }

  /**
   * Accept organization invitation
   */
  async acceptInvitation(invitationToken: string, userId: string) {
    const invitation = await prisma.organizationUser.findFirst({
      where: {
        invitationToken,
        status: 'invited',
        invitationExpiresAt: {
          gt: new Date(),
        },
      },
      include: {
        customerProfile: {
          select: {
            id: true,
            legalBusinessName: true,
          },
        },
        role: true,
      },
    });

    if (!invitation) {
      throw new NotFoundError('Invalid or expired invitation');
    }

    // Update organization user
    const updated = await prisma.organizationUser.update({
      where: { id: invitation.id },
      data: {
        userId,
        status: 'active',
        invitationToken: null,
      },
    });

    logger.info(
      {
        organizationUserId: updated.id,
        userId,
        customerProfileId: invitation.customerProfileId,
      },
      'Invitation accepted'
    );

    return {
      organization: invitation.customerProfile,
      role: invitation.role,
    };
  }

  /**
   * Update user role
   */
  async updateUserRole(
    customerProfileId: string,
    organizationUserId: string,
    input: UpdateUserRoleInput
  ) {
    const orgUser = await prisma.organizationUser.findFirst({
      where: {
        id: organizationUserId,
        customerProfileId,
      },
    });

    if (!orgUser) {
      throw new NotFoundError('Organization user not found');
    }

    // Verify role exists
    const role = await prisma.role.findUnique({
      where: { id: input.roleId },
    });

    if (!role) {
      throw new NotFoundError('Role not found');
    }

    const updated = await prisma.organizationUser.update({
      where: { id: organizationUserId },
      data: {
        roleId: input.roleId,
      },
      include: {
        role: true,
        user: {
          select: {
            email: true,
            name: true,
          },
        },
      },
    });

    logger.info(
      {
        organizationUserId,
        customerProfileId,
        newRole: role.slug,
      },
      'User role updated'
    );

    return updated;
  }

  /**
   * Remove user from organization
   */
  async removeUser(customerProfileId: string, organizationUserId: string) {
    const orgUser = await prisma.organizationUser.findFirst({
      where: {
        id: organizationUserId,
        customerProfileId,
      },
    });

    if (!orgUser) {
      throw new NotFoundError('Organization user not found');
    }

    // Don't allow removing if it's the only owner
    if (orgUser.roleId) {
      const role = await prisma.role.findUnique({
        where: { id: orgUser.roleId },
      });

      if (role?.slug === 'customer_owner') {
        const ownerCount = await prisma.organizationUser.count({
          where: {
            customerProfileId,
            roleId: orgUser.roleId,
            status: 'active',
          },
        });

        if (ownerCount <= 1) {
          throw new ConflictError(
            'Cannot remove the last owner from the organization'
          );
        }
      }
    }

    await prisma.organizationUser.delete({
      where: { id: organizationUserId },
    });

    logger.info(
      {
        organizationUserId,
        customerProfileId,
      },
      'User removed from organization'
    );
  }

  /**
   * Get organization user permissions
   */
  async getUserPermissions(customerProfileId: string, userId: string) {
    // Check if user is the profile owner
    const profile = await prisma.customerProfile.findUnique({
      where: { id: customerProfileId },
      select: { userId: true },
    });

    if (profile?.userId === userId) {
      return {
        isOwner: true,
        role: 'customer_owner',
        permissions: ['*'], // All permissions
      };
    }

    // Check organization membership
    const orgUser = await prisma.organizationUser.findFirst({
      where: {
        customerProfileId,
        userId,
        status: 'active',
      },
      include: {
        role: {
          include: {
            rolePermissions: {
              include: {
                permission: true,
              },
            },
          },
        },
        permissions: {
          include: {
            permission: true,
          },
        },
      },
    });

    if (!orgUser) {
      throw new AuthorizationError('User is not a member of this organization');
    }

    const rolePermissions =
      orgUser.role?.rolePermissions.map((rp) => rp.permission.slug) || [];
    const customPermissions = orgUser.permissions.map((p) => p.permission.slug);

    return {
      isOwner: false,
      role: orgUser.role?.slug,
      permissions: [...new Set([...rolePermissions, ...customPermissions])],
    };
  }
}
