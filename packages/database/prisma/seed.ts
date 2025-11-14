import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create default roles
  const roles = [
    {
      slug: 'super_admin',
      description: 'Platform super administrator',
      isSystem: true,
    },
    {
      slug: 'customer_owner',
      description: 'Customer account owner',
      isSystem: true,
    },
    {
      slug: 'customer_admin',
      description: 'Customer administrator',
      isSystem: true,
    },
    {
      slug: 'customer_manager',
      description: 'Customer venue manager',
      isSystem: true,
    },
    {
      slug: 'customer_staff',
      description: 'Customer staff member',
      isSystem: true,
    },
    {
      slug: 'singer',
      description: 'Singer user',
      isSystem: true,
    },
  ];

  for (const role of roles) {
    await prisma.role.upsert({
      where: { slug: role.slug },
      update: {},
      create: role,
    });
  }

  console.log('✅ Roles created');

  // Create default permissions
  const permissions = [
    // Venue permissions
    { slug: 'venues:read', description: 'View venues' },
    { slug: 'venues:create', description: 'Create venues' },
    { slug: 'venues:update', description: 'Update venues' },
    { slug: 'venues:delete', description: 'Delete venues' },

    // System permissions
    { slug: 'systems:read', description: 'View systems' },
    { slug: 'systems:create', description: 'Create systems' },
    { slug: 'systems:update', description: 'Update systems' },
    { slug: 'systems:delete', description: 'Delete systems' },

    // Song database permissions
    { slug: 'songdb:read', description: 'View song database' },
    { slug: 'songdb:create', description: 'Add songs' },
    { slug: 'songdb:update', description: 'Update songs' },
    { slug: 'songdb:delete', description: 'Delete songs' },
    { slug: 'songdb:import', description: 'Import songs' },
    { slug: 'songdb:export', description: 'Export songs' },

    // Request permissions
    { slug: 'requests:read', description: 'View requests' },
    { slug: 'requests:update', description: 'Update requests' },
    { slug: 'requests:delete', description: 'Delete requests' },

    // Organization permissions
    { slug: 'organization:read', description: 'View organization' },
    { slug: 'organization:invite', description: 'Invite users' },
    { slug: 'organization:remove', description: 'Remove users' },

    // Billing permissions
    { slug: 'billing:read', description: 'View billing' },
    { slug: 'billing:manage', description: 'Manage billing' },

    // API key permissions
    { slug: 'api_keys:read', description: 'View API keys' },
    { slug: 'api_keys:create', description: 'Create API keys' },
    { slug: 'api_keys:revoke', description: 'Revoke API keys' },

    // Analytics permissions
    { slug: 'analytics:read', description: 'View analytics' },
    { slug: 'reports:create', description: 'Create reports' },
  ];

  for (const permission of permissions) {
    await prisma.permission.upsert({
      where: { slug: permission.slug },
      update: {},
      create: permission,
    });
  }

  console.log('✅ Permissions created');

  // Assign permissions to roles
  const customerOwnerPermissions = permissions.map((p) => p.slug);
  const customerAdminPermissions = permissions
    .filter((p) => !p.slug.includes('billing:manage'))
    .map((p) => p.slug);
  const customerManagerPermissions = [
    'venues:read',
    'venues:update',
    'systems:read',
    'songdb:read',
    'songdb:update',
    'requests:read',
    'requests:update',
    'analytics:read',
  ];
  const customerStaffPermissions = [
    'venues:read',
    'systems:read',
    'songdb:read',
    'requests:read',
    'requests:update',
  ];

  const assignPermissionsToRole = async (
    roleSlug: string,
    permissionSlugs: string[]
  ) => {
    const role = await prisma.role.findUnique({ where: { slug: roleSlug } });
    if (!role) return;

    for (const permSlug of permissionSlugs) {
      const permission = await prisma.permission.findUnique({
        where: { slug: permSlug },
      });
      if (!permission) continue;

      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: role.id,
            permissionId: permission.id,
          },
        },
        update: {},
        create: {
          roleId: role.id,
          permissionId: permission.id,
        },
      });
    }
  };

  await assignPermissionsToRole('customer_owner', customerOwnerPermissions);
  await assignPermissionsToRole('customer_admin', customerAdminPermissions);
  await assignPermissionsToRole('customer_manager', customerManagerPermissions);
  await assignPermissionsToRole('customer_staff', customerStaffPermissions);

  console.log('✅ Role permissions assigned');

  console.log('🎉 Database seeding completed!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
