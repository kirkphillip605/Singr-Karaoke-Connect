import { FastifyInstance } from 'fastify';
import { prisma } from '@singr/database';
import {
  NotFoundError,
  AuthorizationError,
  parsePaginationParams,
  createPaginationInfo,
} from '@singr/shared';

/**
 * Admin routes for platform-level administration
 * Requires super_admin role
 */
export default async function adminRoutes(server: FastifyInstance) {
  // Middleware to check super_admin role
  const requireSuperAdmin = async (request: any, reply: any) => {
    await server.authenticate(request, reply);

    const userId = ((request.user as any)?.sub);

    // Check if user has super_admin role
    const userRole = await prisma.userRole.findFirst({
      where: {
        userId,
        role: {
          slug: 'super_admin',
        },
      },
      include: {
        role: true,
      },
    });

    if (!userRole) {
      throw new AuthorizationError('Super admin access required');
    }

    request.isAdmin = true;
  };

  // Platform statistics
  server.get(
    '/stats',
    {
      preHandler: requireSuperAdmin,
    },
    async (request, reply) => {
      const [
        totalUsers,
        totalCustomers,
        totalSingers,
        totalVenues,
        totalRequests,
        activeToday,
      ] = await Promise.all([
        prisma.user.count(),
        prisma.customerProfile.count(),
        prisma.singerProfile.count(),
        prisma.venue.count(),
        prisma.request.count(),
        prisma.user.count({
          where: {
            lastLoginAt: {
              gte: new Date(new Date().setHours(0, 0, 0, 0)),
            },
          },
        }),
      ]);

      return reply.send({
        totalUsers,
        totalCustomers,
        totalSingers,
        totalVenues,
        totalRequests,
        activeToday,
        timestamp: new Date().toISOString(),
      });
    }
  );

  // List all users
  server.get(
    '/users',
    {
      preHandler: requireSuperAdmin,
    },
    async (request, reply) => {
      const { limit, offset } = parsePaginationParams(
        request.query as Record<string, unknown>
      );
      const query = request.query as Record<string, unknown>;

      const where: Record<string, unknown> = {};

      if (query.email) {
        where.email = {
          contains: query.email as string,
          mode: 'insensitive',
        };
      }

      if (query.verified !== undefined) {
        where.emailVerified = query.verified === 'true' ? { not: null } : null;
      }

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          take: limit,
          skip: offset,
          select: {
            id: true,
            email: true,
            name: true,
            emailVerified: true,
            imageUrl: true,
            createdAt: true,
            lastLoginAt: true,
            customerProfile: {
              select: {
                id: true,
                legalBusinessName: true,
              },
            },
            singerProfile: {
              select: {
                id: true,
                nickname: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.user.count({ where }),
      ]);

      return reply.send({
        users,
        pagination: createPaginationInfo(total, limit, offset, users.length),
      });
    }
  );

  // Get user details
  server.get<{ Params: { userId: string } }>(
    '/users/:userId',
    {
      preHandler: requireSuperAdmin,
    },
    async (request, reply) => {
      const { userId } = request.params;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          customerProfile: {
            include: {
              venues: {
                select: {
                  id: true,
                  name: true,
                  city: true,
                  state: true,
                },
              },
            },
          },
          singerProfile: {
            include: {
              favoriteSongs: {
                take: 10,
              },
              favoriteVenues: {
                take: 10,
                include: {
                  venue: {
                    select: {
                      name: true,
                      city: true,
                      state: true,
                    },
                  },
                },
              },
            },
          },
          userRoles: {
            include: {
              role: true,
            },
          },
        },
      });

      if (!user) {
        throw new NotFoundError('User');
      }

      return reply.send(user);
    }
  );

  // List all venues
  server.get(
    '/venues',
    {
      preHandler: requireSuperAdmin,
    },
    async (request, reply) => {
      const { limit, offset } = parsePaginationParams(
        request.query as Record<string, unknown>
      );
      const query = request.query as Record<string, unknown>;

      const where: Record<string, unknown> = {};

      if (query.search) {
        where.OR = [
          { name: { contains: query.search as string, mode: 'insensitive' } },
          { city: { contains: query.search as string, mode: 'insensitive' } },
          { state: { contains: query.search as string, mode: 'insensitive' } },
        ];
      }

      const [venues, total] = await Promise.all([
        prisma.venue.findMany({
          where,
          take: limit,
          skip: offset,
          include: {
            customerProfile: {
              select: {
                legalBusinessName: true,
                user: {
                  select: {
                    email: true,
                    name: true,
                  },
                },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.venue.count({ where }),
      ]);

      return reply.send({
        venues,
        pagination: createPaginationInfo(total, limit, offset, venues.length),
      });
    }
  );

  // List audit logs
  server.get(
    '/audit-logs',
    {
      preHandler: requireSuperAdmin,
    },
    async (request, reply) => {
      const { limit, offset } = parsePaginationParams(
        request.query as Record<string, unknown>
      );

      const [logs, total] = await Promise.all([
        prisma.auditLog.findMany({
          take: limit,
          skip: offset,
          include: {
            user: {
              select: {
                email: true,
                name: true,
              },
            },
          },
          orderBy: { timestamp: 'desc' },
        }),
        prisma.auditLog.count(),
      ]);

      return reply.send({
        logs,
        pagination: createPaginationInfo(total, limit, offset, logs.length),
      });
    }
  );

  // Get recent activity
  server.get(
    '/activity',
    {
      preHandler: requireSuperAdmin,
    },
    async (request, reply) => {
      const query = request.query as Record<string, unknown>;
      const hours = Math.min(parseInt(String(query.hours || 24), 10), 168); // Max 1 week
      const since = new Date();
      since.setHours(since.getHours() - hours);

      const [newUsers, newVenues, newRequests, apiKeysCreated] =
        await Promise.all([
          prisma.user.count({
            where: { createdAt: { gte: since } },
          }),
          prisma.venue.count({
            where: { createdAt: { gte: since } },
          }),
          prisma.request.count({
            where: { requestedAt: { gte: since } },
          }),
          prisma.apiKey.count({
            where: { createdAt: { gte: since } },
          }),
        ]);

      return reply.send({
        period: `Last ${hours} hours`,
        newUsers,
        newVenues,
        newRequests,
        apiKeysCreated,
        since: since.toISOString(),
      });
    }
  );
}
