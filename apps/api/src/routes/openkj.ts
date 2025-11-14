import { FastifyInstance } from 'fastify';
import { prisma } from '@singr/database';
import { NotFoundError, AuthorizationError } from '@singr/shared';
import { ApiKeyService } from '../services/apikey.service.js';

/**
 * OpenKJ Compatibility Layer
 * 
 * Provides endpoints compatible with OpenKJ karaoke software for:
 * - Song database synchronization
 * - Request submission and management
 * - Venue information
 */
export default async function openkjRoutes(server: FastifyInstance) {
  const apiKeyService = new ApiKeyService();

  // API Key authentication middleware for OpenKJ
  const authenticateApiKey = async (request: any, reply: any) => {
    const apiKey = request.headers['x-api-key'] || request.headers['authorization']?.replace('****** ', '');

    if (!apiKey) {
      return reply.code(401).send({
        error: 'API key required',
        message: 'Provide API key in X-API-Key header or Authorization header',
      });
    }

    const verification = await apiKeyService.verifyApiKey(apiKey);

    if (!verification.valid || !verification.customerProfileId) {
      return reply.code(401).send({
        error: 'Invalid API key',
        message: 'The provided API key is invalid or has been revoked',
      });
    }

    // Attach customer profile to request
    request.customerProfileId = verification.customerProfileId;
    request.apiKeyId = verification.apiKeyId;
  };

  // Get venue info by OpenKJ venue ID
  server.get<{ Params: { venueId: string } }>(
    '/venues/:venueId',
    {
      preHandler: authenticateApiKey,
    },
    async (request, reply) => {
      const { venueId } = request.params;
      const customerProfileId = (request as any).customerProfileId;

      const venue = await prisma.venue.findFirst({
        where: {
          openkjVenueId: parseInt(venueId, 10),
          customerProfileId,
        },
        select: {
          id: true,
          openkjVenueId: true,
          name: true,
          urlName: true,
          address: true,
          city: true,
          state: true,
          postalCode: true,
          acceptingRequests: true,
        },
      });

      if (!venue) {
        throw new NotFoundError('Venue');
      }

      return reply.send({
        venue_id: venue.openkjVenueId,
        name: venue.name,
        url_name: venue.urlName,
        address: venue.address,
        city: venue.city,
        state: venue.state,
        postal_code: venue.postalCode,
        accepting_requests: venue.acceptingRequests,
      });
    }
  );

  // Get song database for a system
  server.get<{ Params: { systemId: string } }>(
    '/systems/:systemId/songs',
    {
      preHandler: authenticateApiKey,
    },
    async (request, reply) => {
      const { systemId } = request.params;
      const customerProfileId = (request as any).customerProfileId;
      const query = request.query as Record<string, unknown>;
      const limit = Math.min(parseInt(String(query.limit || 1000), 10), 10000);
      const offset = parseInt(String(query.offset || 0), 10);

      // Verify system exists
      const system = await prisma.system.findFirst({
        where: {
          openkjSystemId: parseInt(systemId, 10),
          customerProfileId,
        },
      });

      if (!system) {
        throw new NotFoundError('System');
      }

      const songs = await prisma.songDb.findMany({
        where: {
          customerProfileId,
          openkjSystemId: system.openkjSystemId,
        },
        take: limit,
        skip: offset,
        orderBy: [{ artist: 'asc' }, { title: 'asc' }],
        select: {
          id: true,
          artist: true,
          title: true,
          combined: true,
        },
      });

      return reply.send({
        system_id: system.openkjSystemId,
        total: songs.length,
        songs: songs.map((song) => ({
          song_id: song.id.toString(),
          artist: song.artist,
          title: song.title,
          combined: song.combined,
        })),
      });
    }
  );

  // Sync songs to system (bulk upsert)
  server.post<{
    Params: { systemId: string };
    Body: { songs: Array<{ artist: string; title: string }> };
  }>(
    '/systems/:systemId/songs/sync',
    {
      preHandler: authenticateApiKey,
    },
    async (request, reply) => {
      const { systemId } = request.params;
      const customerProfileId = (request as any).customerProfileId;
      const { songs } = request.body;

      if (!Array.isArray(songs) || songs.length === 0) {
        return reply.code(400).send({
          error: 'Invalid request',
          message: 'songs array is required and must not be empty',
        });
      }

      // Verify system exists
      const system = await prisma.system.findFirst({
        where: {
          openkjSystemId: parseInt(systemId, 10),
          customerProfileId,
        },
      });

      if (!system) {
        throw new NotFoundError('System');
      }

      let imported = 0;
      let skipped = 0;

      // Process in batches
      for (const song of songs) {
        const combined = `${song.artist} - ${song.title}`;
        const normalizedCombined = combined
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .replace(/\s+/g, ' ')
          .trim();

        // Check if exists
        const existing = await prisma.songDb.findFirst({
          where: {
            customerProfileId,
            openkjSystemId: system.openkjSystemId,
            normalizedCombined,
          },
        });

        if (existing) {
          skipped++;
          continue;
        }

        await prisma.songDb.create({
          data: {
            customerProfileId,
            openkjSystemId: system.openkjSystemId,
            artist: song.artist,
            title: song.title,
            combined,
            normalizedCombined,
          },
        });

        imported++;
      }

      return reply.send({
        system_id: system.openkjSystemId,
        total_submitted: songs.length,
        imported,
        skipped,
      });
    }
  );

  // Get requests for a venue
  server.get<{ Params: { venueId: string } }>(
    '/venues/:venueId/requests',
    {
      preHandler: authenticateApiKey,
    },
    async (request, reply) => {
      const { venueId } = request.params;
      const customerProfileId = (request as any).customerProfileId;
      const query = request.query as Record<string, unknown>;
      const processed = query.processed === 'true';
      const limit = Math.min(parseInt(String(query.limit || 100), 10), 500);

      // Verify venue exists
      const venue = await prisma.venue.findFirst({
        where: {
          openkjVenueId: parseInt(venueId, 10),
          customerProfileId,
        },
      });

      if (!venue) {
        throw new NotFoundError('Venue');
      }

      const requests = await prisma.request.findMany({
        where: {
          venueId: venue.id,
          processed,
        },
        take: limit,
        orderBy: { requestedAt: 'asc' },
        select: {
          id: true,
          artist: true,
          title: true,
          keyChange: true,
          notes: true,
          requestedAt: true,
          processed: true,
          processedAt: true,
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
      });

      return reply.send({
        venue_id: venue.openkjVenueId,
        total: requests.length,
        requests: requests.map((r) => ({
          request_id: r.id.toString(),
          artist: r.artist,
          title: r.title,
          key_change: r.keyChange,
          notes: r.notes,
          singer_name:
            r.singerProfile?.nickname || r.singerProfile?.user?.name || 'Guest',
          requested_at: r.requestedAt.toISOString(),
          processed: r.processed,
          processed_at: r.processedAt?.toISOString() || null,
        })),
      });
    }
  );

  // Mark request as processed
  server.post<{
    Params: { venueId: string; requestId: string };
  }>(
    '/venues/:venueId/requests/:requestId/process',
    {
      preHandler: authenticateApiKey,
    },
    async (request, reply) => {
      const { venueId, requestId } = request.params;
      const customerProfileId = (request as any).customerProfileId;

      // Verify venue exists
      const venue = await prisma.venue.findFirst({
        where: {
          openkjVenueId: parseInt(venueId, 10),
          customerProfileId,
        },
      });

      if (!venue) {
        throw new NotFoundError('Venue');
      }

      // Verify request belongs to venue
      const requestRecord = await prisma.request.findFirst({
        where: {
          id: BigInt(requestId),
          venueId: venue.id,
        },
      });

      if (!requestRecord) {
        throw new NotFoundError('Request');
      }

      const updated = await prisma.request.update({
        where: { id: BigInt(requestId) },
        data: {
          processed: true,
          processedAt: new Date(),
        },
      });

      return reply.send({
        request_id: updated.id.toString(),
        processed: updated.processed,
        processed_at: updated.processedAt?.toISOString(),
      });
    }
  );

  // API health check
  server.get('/health', async (request, reply) => {
    return reply.send({
      status: 'ok',
      version: '1.0.0',
      service: 'OpenKJ Compatibility Layer',
    });
  });
}
