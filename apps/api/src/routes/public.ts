import { FastifyInstance } from 'fastify';
import { prisma } from '@singr/database';
import { parsePaginationParams, createPaginationInfo } from '@singr/shared';

export default async function publicRoutes(server: FastifyInstance) {
  // Get public venues
  server.get('/venues', async (request, reply) => {
    const { limit, offset } = parsePaginationParams(request.query as Record<string, unknown>);

    const venues = await prisma.venue.findMany({
      where: {
        acceptingRequests: true,
      },
      take: limit,
      skip: offset,
      select: {
        id: true,
        name: true,
        urlName: true,
        city: true,
        state: true,
        address: true,
        phoneNumber: true,
        website: true,
        acceptingRequests: true,
      },
    });

    return reply.send({
      venues,
      pagination: createPaginationInfo(undefined, limit, offset, venues.length),
    });
  });

  // Get venue by URL name
  server.get<{ Params: { urlName: string } }>(
    '/venues/:urlName',
    async (request, reply) => {
      const { urlName } = request.params;

      const venue = await prisma.venue.findUnique({
        where: { urlName },
        select: {
          id: true,
          name: true,
          urlName: true,
          city: true,
          state: true,
          address: true,
          postalCode: true,
          country: true,
          phoneNumber: true,
          website: true,
          acceptingRequests: true,
        },
      });

      if (!venue) {
        return reply.code(404).send({
          type: 'resource_not_found',
          title: 'Not Found',
          detail: 'Venue not found',
        });
      }

      return reply.send(venue);
    }
  );
}
