import { FastifyInstance } from 'fastify';
import { prisma } from '@singr/database';
import {
  NotFoundError,
  parsePaginationParams,
  createPaginationInfo,
  bulkImportSongsSchema,
  type BulkImportSongsInput,
} from '@singr/shared';
import { SongDbService } from '../services/songdb.service.js';

export default async function songdbRoutes(server: FastifyInstance) {
  const songDbService = new SongDbService();

  // Search songs
  server.get(
    '/songdb',
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

      const { songs, total } = await songDbService.searchSongs(
        customerProfile.id,
        {
          systemId: query.systemId as string | undefined,
          search: query.search as string | undefined,
        },
        limit,
        offset
      );

      return reply.send({
        songs,
        pagination: createPaginationInfo(total, limit, offset, songs.length),
      });
    }
  );

  // Get single song
  server.get<{ Params: { songId: string } }>(
    '/songdb/:songId',
    {
      preHandler: server.authenticate,
    },
    async (request, reply) => {
      const userId = (request.user as any).sub;
      const { songId } = request.params;

      const customerProfile = await prisma.customerProfile.findUnique({
        where: { userId },
      });

      if (!customerProfile) {
        throw new NotFoundError('Customer profile');
      }

      const song = await songDbService.getSong(songId, customerProfile.id);

      return reply.send(song);
    }
  );

  // Bulk import songs
  server.post<{ Body: BulkImportSongsInput }>(
    '/songdb/import',
    {
      preHandler: server.authenticate,
      schema: {
        body: bulkImportSongsSchema,
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

      const result = await songDbService.bulkImportSongs(
        customerProfile.id,
        request.body
      );

      return reply.send(result);
    }
  );

  // Export songs for a system
  server.get<{ Params: { systemId: string } }>(
    '/systems/:systemId/songs/export',
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

      const songs = await songDbService.exportSongs(
        customerProfile.id,
        systemId
      );

      // Return as CSV or JSON based on Accept header
      const acceptHeader = request.headers.accept || '';

      if (acceptHeader.includes('text/csv')) {
        // Generate CSV
        let csv = 'Artist,Title\n';
        songs.forEach((song) => {
          csv += `"${song.artist.replace(/"/g, '""')}","${song.title.replace(
            /"/g,
            '""'
          )}"\n`;
        });

        return reply
          .header('Content-Type', 'text/csv')
          .header(
            'Content-Disposition',
            `attachment; filename="songs-${systemId}.csv"`
          )
          .send(csv);
      }

      // Default to JSON
      return reply.send({ songs });
    }
  );

  // Delete single song
  server.delete<{ Params: { songId: string } }>(
    '/songdb/:songId',
    {
      preHandler: server.authenticate,
    },
    async (request, reply) => {
      const userId = (request.user as any).sub;
      const { songId } = request.params;

      const customerProfile = await prisma.customerProfile.findUnique({
        where: { userId },
      });

      if (!customerProfile) {
        throw new NotFoundError('Customer profile');
      }

      await songDbService.deleteSong(songId, customerProfile.id);

      return reply.code(204).send();
    }
  );

  // Bulk delete all songs for a system
  server.delete<{ Params: { systemId: string } }>(
    '/systems/:systemId/songs',
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

      const deletedCount = await songDbService.deleteBulkSongs(
        customerProfile.id,
        systemId
      );

      return reply.send({ deletedCount });
    }
  );
}
