import { FastifyInstance } from 'fastify';
import { prisma } from '@singr/database';
import {
  parsePaginationParams,
  createPaginationInfo,
  createRequestSchema,
  NotFoundError,
  type CreateRequestInput,
} from '@singr/shared';
import { VenueService } from '../services/venue.service.js';
import { RequestService } from '../services/request.service.js';

export default async function publicRoutes(server: FastifyInstance) {
  const venueService = new VenueService();
  const requestService = new RequestService();

  // Search public venues
  server.get('/venues', async (request, reply) => {
    const { limit, offset } = parsePaginationParams(
      request.query as Record<string, unknown>
    );
    const query = request.query as Record<string, unknown>;

    const { venues, total } = await venueService.searchPublicVenues({
      city: query.city as string | undefined,
      state: query.state as string | undefined,
      acceptingRequests:
        query.acceptingRequests === 'true'
          ? true
          : query.acceptingRequests === 'false'
          ? false
          : undefined,
      limit,
      offset,
    });

    return reply.send({
      venues,
      pagination: createPaginationInfo(total, limit || 10, offset || 0, venues.length),
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
        throw new NotFoundError('Venue');
      }

      return reply.send(venue);
    }
  );

  // Search venue songdb
  server.get<{ Params: { urlName: string } }>(
    '/venues/:urlName/songdb',
    async (request, reply) => {
      const { urlName } = request.params;
      const query = request.query as Record<string, unknown>;
      const searchQuery = query.q as string | undefined;
      const { limit, offset } = parsePaginationParams(query);

      if (!searchQuery || searchQuery.length < 2) {
        return reply.code(400).send({
          type: 'validation_error',
          title: 'Validation Error',
          detail: 'Search query must be at least 2 characters',
        });
      }

      const venue = await prisma.venue.findUnique({
        where: { urlName },
        include: { customerProfile: true },
      });

      if (!venue) {
        throw new NotFoundError('Venue');
      }

      // Search song database
      const songs = await prisma.songDb.findMany({
        where: {
          customerProfileId: venue.customerProfileId,
          OR: [
            { artist: { contains: searchQuery, mode: 'insensitive' } },
            { title: { contains: searchQuery, mode: 'insensitive' } },
            { combined: { contains: searchQuery, mode: 'insensitive' } },
          ],
        },
        take: limit,
        skip: offset,
        select: {
          id: true,
          artist: true,
          title: true,
          combined: true,
        },
      });

      return reply.send({
        songs,
        pagination: createPaginationInfo(undefined, limit || 10, offset || 0, songs.length),
      });
    }
  );

  // Submit guest request
  server.post<{
    Params: { urlName: string };
    Body: CreateRequestInput;
  }>(
    '/venues/:urlName/requests',
    {
      schema: {
        body: createRequestSchema,
      },
    },
    async (request, reply) => {
      const { urlName } = request.params;
      const { artist, title, keyChange, notes } = request.body;

      const venue = await prisma.venue.findUnique({
        where: { urlName },
      });

      if (!venue) {
        throw new NotFoundError('Venue');
      }

      const requestData = await requestService.createRequest({
        venueId: venue.id,
        artist,
        title,
        keyChange,
        notes,
      });

      return reply.code(201).send(requestData);
    }
  );
}
