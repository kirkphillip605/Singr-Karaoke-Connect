import { FastifyInstance } from 'fastify';
import { prisma } from '@singr/database';
import {
  NotFoundError,
  parsePaginationParams,
  createPaginationInfo,
  createSystemSchema,
  updateSystemSchema,
  type CreateSystemInput,
  type UpdateSystemInput,
} from '@singr/shared';
import { SystemService } from '../services/system.service.js';

export default async function systemsRoutes(server: FastifyInstance) {
  const systemService = new SystemService();

  // List systems
  server.get(
    '/systems',
    {
      preHandler: server.authenticate,
    },
    async (request, reply) => {
      const userId = (request.user as any).sub;
      const { limit, offset } = parsePaginationParams(
        request.query as Record<string, unknown>
      );
      const query = request.query as Record<string, unknown>;

      const customerProfile = await prisma.customerProfile.findUnique({
        where: { userId },
      });

      if (!customerProfile) {
        throw new NotFoundError('Customer profile');
      }

      const { systems, total } = await systemService.listSystems(
        customerProfile.id,
        {
          search: query.search as string | undefined,
        },
        limit,
        offset
      );

      return reply.send({
        systems,
        pagination: createPaginationInfo(total, limit || 10, offset || 0, systems.length),
      });
    }
  );

  // Create system
  server.post<{ Body: CreateSystemInput }>(
    '/systems',
    {
      preHandler: server.authenticate,
      schema: {
        body: createSystemSchema,
      },
    },
    async (request, reply) => {
      const userId = (request.user as any).sub;

      const customerProfile = await prisma.customerProfile.findUnique({
        where: { userId },
      });

      if (!customerProfile) {
        throw new NotFoundError('Customer profile');
      }

      const system = await systemService.createSystem(
        customerProfile.id,
        request.body as any
      );

      return reply.code(201).send(system);
    }
  );

  // Get system
  server.get<{ Params: { systemId: string } }>(
    '/systems/:systemId',
    {
      preHandler: server.authenticate,
    },
    async (request, reply) => {
      const userId = (request.user as any).sub;
      const { systemId } = request.params;

      const customerProfile = await prisma.customerProfile.findUnique({
        where: { userId },
      });

      if (!customerProfile) {
        throw new NotFoundError('Customer profile');
      }

      const system = await systemService.getSystem(
        systemId,
        customerProfile.id
      );

      return reply.send(system);
    }
  );

  // Update system
  server.put<{ Params: { systemId: string }; Body: UpdateSystemInput }>(
    '/systems/:systemId',
    {
      preHandler: server.authenticate,
      schema: {
        body: updateSystemSchema,
      },
    },
    async (request, reply) => {
      const userId = (request.user as any).sub;
      const { systemId } = request.params;

      const customerProfile = await prisma.customerProfile.findUnique({
        where: { userId },
      });

      if (!customerProfile) {
        throw new NotFoundError('Customer profile');
      }

      const system = await systemService.updateSystem(
        systemId,
        customerProfile.id,
        request.body as any
      );

      return reply.send(system);
    }
  );

  // Delete system
  server.delete<{ Params: { systemId: string } }>(
    '/systems/:systemId',
    {
      preHandler: server.authenticate,
    },
    async (request, reply) => {
      const userId = (request.user as any).sub;
      const { systemId } = request.params;

      const customerProfile = await prisma.customerProfile.findUnique({
        where: { userId },
      });

      if (!customerProfile) {
        throw new NotFoundError('Customer profile');
      }

      await systemService.deleteSystem(systemId, customerProfile.id);

      return reply.code(204).send();
    }
  );
}
