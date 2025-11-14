import { FastifyInstance } from 'fastify';
import { prisma } from '@singr/database';
import {
  NotFoundError,
  ConflictError,
  parsePaginationParams,
  createPaginationInfo,
  createRequestSchema,
  type CreateRequestInput,
} from '@singr/shared';
import { RequestService } from '../services/request.service.js';

export default async function singerRoutes(server: FastifyInstance) {
  const requestService = new RequestService();

  // Get singer profile
  server.get(
    '/profile',
    {
      preHandler: server.authenticate,
    },
    async (request, reply) => {
      const userId = (request.user as any).sub;

      const profile = await prisma.singerProfile.findUnique({
        where: { userId },
        select: {
          id: true,
          nickname: true,
          avatarUrl: true,
          preferences: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!profile) {
        throw new NotFoundError('Singer profile');
      }

      return reply.send(profile);
    }
  );

  // Update singer profile
  server.put(
    '/profile',
    {
      preHandler: server.authenticate,
    },
    async (request, reply) => {
      const userId = (request.user as any).sub;
      const body = request.body as Record<string, unknown>;

      const profile = await prisma.singerProfile.update({
        where: { userId },
        data: {
          nickname: body.nickname as string | undefined,
          avatarUrl: body.avatarUrl as string | undefined,
          preferences: body.preferences as Record<string, unknown> | undefined,
        },
        select: {
          id: true,
          nickname: true,
          avatarUrl: true,
          preferences: true,
          updatedAt: true,
        },
      });

      return reply.send(profile);
    }
  );

  // Get favorite songs
  server.get(
    '/favorites/songs',
    {
      preHandler: server.authenticate,
    },
    async (request, reply) => {
      const userId = (request.user as any).sub;
      const { limit, offset } = parsePaginationParams(
        request.query as Record<string, unknown>
      );

      const profile = await prisma.singerProfile.findUnique({
        where: { userId },
      });

      if (!profile) {
        throw new NotFoundError('Singer profile');
      }

      const [favorites, total] = await Promise.all([
        prisma.singerFavoriteSong.findMany({
          where: { singerProfileId: profile.id },
          select: {
            id: true,
            artist: true,
            title: true,
            keyChange: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.singerFavoriteSong.count({
          where: { singerProfileId: profile.id },
        }),
      ]);

      return reply.send({
        songs: favorites,
        pagination: createPaginationInfo(total, limit, offset, favorites.length),
      });
    }
  );

  // Add favorite song
  server.post(
    '/favorites/songs',
    {
      preHandler: server.authenticate,
    },
    async (request, reply) => {
      const userId = (request.user as any).sub;
      const body = request.body as Record<string, unknown>;

      const profile = await prisma.singerProfile.findUnique({
        where: { userId },
      });

      if (!profile) {
        throw new NotFoundError('Singer profile');
      }

      // Check if already favorited
      const existing = await prisma.singerFavoriteSong.findFirst({
        where: {
          singerProfileId: profile.id,
          artist: body.artist as string,
          title: body.title as string,
          keyChange: (body.keyChange as number) || 0,
        },
      });

      if (existing) {
        throw new ConflictError('Song already in favorites');
      }

      const favorite = await prisma.singerFavoriteSong.create({
        data: {
          singerProfileId: profile.id,
          artist: body.artist as string,
          title: body.title as string,
          keyChange: (body.keyChange as number) || 0,
        },
      });

      return reply.code(201).send(favorite);
    }
  );

  // Remove favorite song
  server.delete<{ Params: { songId: string } }>(
    '/favorites/songs/:songId',
    {
      preHandler: server.authenticate,
    },
    async (request, reply) => {
      const userId = (request.user as any).sub;
      const { songId } = request.params;

      const profile = await prisma.singerProfile.findUnique({
        where: { userId },
      });

      if (!profile) {
        throw new NotFoundError('Singer profile');
      }

      await prisma.singerFavoriteSong.delete({
        where: {
          id: songId,
          singerProfileId: profile.id,
        },
      });

      return reply.code(204).send();
    }
  );

  // Get favorite venues
  server.get(
    '/favorites/venues',
    {
      preHandler: server.authenticate,
    },
    async (request, reply) => {
      const userId = (request.user as any).sub;

      const profile = await prisma.singerProfile.findUnique({
        where: { userId },
      });

      if (!profile) {
        throw new NotFoundError('Singer profile');
      }

      const favorites = await prisma.singerFavoriteVenue.findMany({
        where: { singerProfileId: profile.id },
        include: {
          venue: {
            select: {
              id: true,
              name: true,
              urlName: true,
              city: true,
              state: true,
              acceptingRequests: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      return reply.send({
        venues: favorites.map((f) => f.venue),
      });
    }
  );

  // Add favorite venue
  server.post(
    '/favorites/venues',
    {
      preHandler: server.authenticate,
    },
    async (request, reply) => {
      const userId = (request.user as any).sub;
      const body = request.body as Record<string, unknown>;
      const venueId = body.venueId as string;

      const profile = await prisma.singerProfile.findUnique({
        where: { userId },
      });

      if (!profile) {
        throw new NotFoundError('Singer profile');
      }

      // Check if venue exists
      const venue = await prisma.venue.findUnique({
        where: { id: venueId },
      });

      if (!venue) {
        throw new NotFoundError('Venue');
      }

      // Check if already favorited
      const existing = await prisma.singerFavoriteVenue.findUnique({
        where: {
          singerProfileId_venueId: {
            singerProfileId: profile.id,
            venueId,
          },
        },
      });

      if (existing) {
        throw new ConflictError('Venue already in favorites');
      }

      await prisma.singerFavoriteVenue.create({
        data: {
          singerProfileId: profile.id,
          venueId,
        },
      });

      return reply.code(201).send({ message: 'Venue added to favorites' });
    }
  );

  // Remove favorite venue
  server.delete<{ Params: { venueId: string } }>(
    '/favorites/venues/:venueId',
    {
      preHandler: server.authenticate,
    },
    async (request, reply) => {
      const userId = (request.user as any).sub;
      const { venueId } = request.params;

      const profile = await prisma.singerProfile.findUnique({
        where: { userId },
      });

      if (!profile) {
        throw new NotFoundError('Singer profile');
      }

      await prisma.singerFavoriteVenue.delete({
        where: {
          singerProfileId_venueId: {
            singerProfileId: profile.id,
            venueId,
          },
        },
      });

      return reply.code(204).send();
    }
  );

  // Get request history
  server.get(
    '/history',
    {
      preHandler: server.authenticate,
    },
    async (request, reply) => {
      const userId = (request.user as any).sub;
      const { limit, offset } = parsePaginationParams(
        request.query as Record<string, unknown>
      );
      const query = request.query as Record<string, unknown>;

      const profile = await prisma.singerProfile.findUnique({
        where: { userId },
      });

      if (!profile) {
        throw new NotFoundError('Singer profile');
      }

      const { history, total } = await requestService.getSingerHistory(
        profile.id,
        limit,
        offset,
        query.venueId as string | undefined
      );

      return reply.send({
        history,
        pagination: createPaginationInfo(total, limit, offset, history.length),
      });
    }
  );

  // Submit authenticated request
  server.post<{
    Params: { venueUrlName: string };
    Body: CreateRequestInput;
  }>(
    '/venues/:venueUrlName/requests',
    {
      preHandler: server.authenticate,
      schema: {
        body: createRequestSchema,
      },
    },
    async (request, reply) => {
      const userId = (request.user as any).sub;
      const { venueUrlName } = request.params;
      const { artist, title, keyChange, notes } = request.body;

      const profile = await prisma.singerProfile.findUnique({
        where: { userId },
      });

      if (!profile) {
        throw new NotFoundError('Singer profile');
      }

      const venue = await prisma.venue.findUnique({
        where: { urlName: venueUrlName },
      });

      if (!venue) {
        throw new NotFoundError('Venue');
      }

      const requestData = await requestService.createRequest({
        venueId: venue.id,
        singerProfileId: profile.id,
        submittedByUserId: userId,
        artist,
        title,
        keyChange,
        notes,
      });

      return reply.code(201).send(requestData);
    }
  );
}
