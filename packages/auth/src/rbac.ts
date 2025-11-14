import { prisma } from '@singr/database';
import { createLogger } from '@singr/observability';

const logger = createLogger('auth:rbac');

export interface UserPermissions {
  roles: string[];
  permissions: string[];
}

/**
 * Get all permissions for a user
 */
export async function getUserPermissions(
  userId: string
): Promise<UserPermissions> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        userRoles: {
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
          },
        },
      },
    });

    if (!user) {
      return { roles: [], permissions: [] };
    }

    const roles = user.userRoles.map((ur: { role: { slug: string } }) => ur.role.slug);
    const permissions = new Set<string>();

    user.userRoles.forEach((ur: { role: { rolePermissions: Array<{ permission: { slug: string } }> } }) => {
      ur.role.rolePermissions.forEach((rp: { permission: { slug: string } }) => {
        permissions.add(rp.permission.slug);
      });
    });

    return {
      roles,
      permissions: Array.from(permissions),
    };
  } catch (error) {
    logger.error({ error, userId }, 'Failed to get user permissions');
    throw error;
  }
}

/**
 * Check if user has a specific permission
 */
export async function hasPermission(
  userId: string,
  permissionSlug: string
): Promise<boolean> {
  const userPerms = await getUserPermissions(userId);
  return userPerms.permissions.includes(permissionSlug);
}

/**
 * Check if user has any of the specified permissions
 */
export async function hasAnyPermission(
  userId: string,
  permissionSlugs: string[]
): Promise<boolean> {
  const userPerms = await getUserPermissions(userId);
  return permissionSlugs.some((p) => userPerms.permissions.includes(p));
}

/**
 * Check if user has all of the specified permissions
 */
export async function hasAllPermissions(
  userId: string,
  permissionSlugs: string[]
): Promise<boolean> {
  const userPerms = await getUserPermissions(userId);
  return permissionSlugs.every((p) => userPerms.permissions.includes(p));
}

/**
 * Check if user has a specific role
 */
export async function hasRole(userId: string, roleSlug: string): Promise<boolean> {
  const userPerms = await getUserPermissions(userId);
  return userPerms.roles.includes(roleSlug);
}

/**
 * Get organization-specific permissions for a user
 */
export async function getOrganizationPermissions(
  userId: string,
  customerProfileId: string
): Promise<UserPermissions> {
  try {
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
      return { roles: [], permissions: [] };
    }

    const roles = orgUser.role ? [(orgUser.role as any).slug] : [];
    const permissions = new Set<string>();

    // Add role permissions
    if (orgUser.role) {
      ((orgUser.role as any).rolePermissions || []).forEach((rp: { permission: { slug: string } }) => {
        permissions.add(rp.permission.slug);
      });
    }

    // Add override permissions
    ((orgUser as any).permissions || []).forEach((up: { permission: { slug: string } }) => {
      permissions.add(up.permission.slug);
    });

    return {
      roles,
      permissions: Array.from(permissions),
    };
  } catch (error) {
    logger.error(
      { error, userId, customerProfileId },
      'Failed to get organization permissions'
    );
    throw error;
  }
}
