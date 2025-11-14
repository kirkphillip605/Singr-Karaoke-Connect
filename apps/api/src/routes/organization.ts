import { FastifyInstance } from 'fastify';
import { prisma } from '@singr/database';
import {
  NotFoundError,
  parsePaginationParams,
  createPaginationInfo,
} from '@singr/shared';
import { OrganizationService } from '../services/organization.service.js';
import { z } from 'zod';

const inviteUserSchema = z.object({
  email: z.string().email('Valid email required'),
  roleId: z.string().uuid('Valid role ID required'),
});

const updateUserRoleSchema = z.object({
  roleId: z.string().uuid('Valid role ID required'),
});

export default async function organizationRoutes(server: FastifyInstance) {
  const organizationService = new OrganizationService();

  // List organization users
  server.get(
    '/team',
    {
      preHandler: server.authenticate,
    },
    async (request, reply) => {
      const userId = (request.user as any).sub;
      const { limit, offset } = parsePaginationParams(
        request.query as Record<string, unknown>
      );

      const customerProfile = await prisma.customerProfile.findUnique({
        where: { userId },
      });

      if (!customerProfile) {
        throw new NotFoundError('Customer profile');
      }

      const { users, total } = await organizationService.listOrganizationUsers(
        customerProfile.id,
        limit,
        offset
      );

      return reply.send({
        users,
        pagination: createPaginationInfo(total, limit, offset, users.length),
      });
    }
  );

  // Invite user to organization
  server.post(
    '/team/invite',
    {
      preHandler: server.authenticate,
      schema: {
        body: inviteUserSchema,
      },
    },
    async (request, reply) => {
      const userId = (request.user as any).sub;
      const body = request.body as z.infer<typeof inviteUserSchema>;

      const customerProfile = await prisma.customerProfile.findUnique({
        where: { userId },
      });

      if (!customerProfile) {
        throw new NotFoundError('Customer profile');
      }

      const invitation = await organizationService.inviteUser(
        customerProfile.id,
        userId,
        body
      );

      return reply.code(201).send(invitation);
    }
  );

  // Accept invitation
  server.post<{ Body: { token: string } }>(
    '/team/accept-invitation',
    {
      preHandler: server.authenticate,
    },
    async (request, reply) => {
      const userId = (request.user as any).sub;
      const { token } = request.body;

      if (!token) {
        return reply.code(400).send({
          type: 'validation_error',
          title: 'Validation Error',
          detail: 'Invitation token is required',
        });
      }

      const result = await organizationService.acceptInvitation(token, userId);

      return reply.send(result);
    }
  );

  // Update user role
  server.put<{
    Params: { organizationUserId: string };
    Body: z.infer<typeof updateUserRoleSchema>;
  }>(
    '/team/:organizationUserId/role',
    {
      preHandler: server.authenticate,
      schema: {
        body: updateUserRoleSchema,
      },
    },
    async (request, reply) => {
      const userId = (request.user as any).sub;
      const { organizationUserId } = request.params;

      const customerProfile = await prisma.customerProfile.findUnique({
        where: { userId },
      });

      if (!customerProfile) {
        throw new NotFoundError('Customer profile');
      }

      const updated = await organizationService.updateUserRole(
        customerProfile.id,
        organizationUserId,
        request.body
      );

      return reply.send(updated);
    }
  );

  // Remove user from organization
  server.delete<{ Params: { organizationUserId: string } }>(
    '/team/:organizationUserId',
    {
      preHandler: server.authenticate,
    },
    async (request, reply) => {
      const userId = (request.user as any).sub;
      const { organizationUserId } = request.params;

      const customerProfile = await prisma.customerProfile.findUnique({
        where: { userId },
      });

      if (!customerProfile) {
        throw new NotFoundError('Customer profile');
      }

      await organizationService.removeUser(
        customerProfile.id,
        organizationUserId
      );

      return reply.code(204).send();
    }
  );

  // Get user permissions in organization
  server.get(
    '/team/permissions',
    {
      preHandler: server.authenticate,
    },
    async (request, reply) => {
      const userId = (request.user as any).sub;
      const query = request.query as Record<string, unknown>;
      const customerProfileId = query.customerProfileId as string | undefined;

      if (!customerProfileId) {
        return reply.code(400).send({
          type: 'validation_error',
          title: 'Validation Error',
          detail: 'customerProfileId query parameter is required',
        });
      }

      const permissions = await organizationService.getUserPermissions(
        customerProfileId,
        userId
      );

      return reply.send(permissions);
    }
  );

  // List available roles
  server.get('/roles', async (request, reply) => {
    const roles = await prisma.role.findMany({
      where: {
        slug: {
          in: ['customer_owner', 'customer_admin', 'customer_manager', 'customer_staff'],
        },
      },
      select: {
        id: true,
        slug: true,
        description: true,
      },
      orderBy: { slug: 'asc' },
    });

    return reply.send({ roles });
  });
}
