import { FastifyInstance } from 'fastify';
import { prisma } from '@singr/database';
import { NotFoundError } from '@singr/shared';

export default async function singerRoutes(server: FastifyInstance) {
  // Get singer profile
  server.get(
    '/profile',
    {
      preHandler: server.authenticate,
    },
    async (request, reply) => {
      const userId = request.user!.sub;

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
      const userId = request.user!.sub;
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
      const userId = request.user!.sub;

      const profile = await prisma.singerProfile.findUnique({
        where: { userId },
      });

      if (!profile) {
        throw new NotFoundError('Singer profile');
      }

      const favorites = await prisma.singerFavoriteSong.findMany({
        where: { singerProfileId: profile.id },
        select: {
          id: true,
          artist: true,
          title: true,
          keyChange: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      return reply.send({ songs: favorites });
    }
  );
}
