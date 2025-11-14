import { FastifyInstance } from 'fastify';
import { prisma } from '@singr/database';
import { NotFoundError, AuthorizationError } from '@singr/shared';

export default async function customerRoutes(server: FastifyInstance) {
  // Get customer venues
  server.get(
    '/venues',
    {
      preHandler: server.authenticate,
    },
    async (request, reply) => {
      const userId = request.user!.sub;

      const customerProfile = await prisma.customerProfile.findUnique({
        where: { userId },
      });

      if (!customerProfile) {
        throw new NotFoundError('Customer profile');
      }

      const venues = await prisma.venue.findMany({
        where: { customerProfileId: customerProfile.id },
        select: {
          id: true,
          name: true,
          urlName: true,
          city: true,
          state: true,
          acceptingRequests: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      return reply.send({ venues });
    }
  );

  // Get venue requests
  server.get<{ Params: { venueId: string } }>(
    '/venues/:venueId/requests',
    {
      preHandler: server.authenticate,
    },
    async (request, reply) => {
      const userId = request.user!.sub;
      const { venueId } = request.params;

      const customerProfile = await prisma.customerProfile.findUnique({
        where: { userId },
      });

      if (!customerProfile) {
        throw new NotFoundError('Customer profile');
      }

      // Verify venue ownership
      const venue = await prisma.venue.findFirst({
        where: {
          id: venueId,
          customerProfileId: customerProfile.id,
        },
      });

      if (!venue) {
        throw new AuthorizationError('Access denied to this venue');
      }

      const requests = await prisma.request.findMany({
        where: {
          venueId,
          processed: false,
        },
        select: {
          id: true,
          artist: true,
          title: true,
          keyChange: true,
          notes: true,
          requestedAt: true,
          processed: true,
          singerProfile: {
            select: {
              nickname: true,
              user: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
        orderBy: { requestedAt: 'asc' },
      });

      return reply.send({ requests });
    }
  );
}
