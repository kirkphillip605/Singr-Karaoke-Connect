import { FastifyInstance } from 'fastify';
import { prisma } from '@singr/database';
import { NotFoundError } from '@singr/shared';
import { AnalyticsService } from '../services/analytics.service.js';

export default async function analyticsRoutes(server: FastifyInstance) {
  const analyticsService = new AnalyticsService();

  // Helper to parse date range from query
  const parseDateRange = (query: Record<string, unknown>) => {
    if (query.startDate && query.endDate) {
      return {
        startDate: new Date(query.startDate as string),
        endDate: new Date(query.endDate as string),
      };
    }
    return undefined;
  };

  // Get overall statistics
  server.get(
    '/stats',
    {
      preHandler: server.authenticate,
    },
    async (request, reply) => {
      const userId = request.user!.sub;
      const query = request.query as Record<string, unknown>;

      const customerProfile = await prisma.customerProfile.findUnique({
        where: { userId },
      });

      if (!customerProfile) {
        throw new NotFoundError('Customer profile');
      }

      const dateRange = parseDateRange(query);
      const stats = await analyticsService.getOverallStats(
        customerProfile.id,
        dateRange
      );

      return reply.send(stats);
    }
  );

  // Get venue statistics
  server.get(
    '/stats/venues',
    {
      preHandler: server.authenticate,
    },
    async (request, reply) => {
      const userId = request.user!.sub;
      const query = request.query as Record<string, unknown>;

      const customerProfile = await prisma.customerProfile.findUnique({
        where: { userId },
      });

      if (!customerProfile) {
        throw new NotFoundError('Customer profile');
      }

      const dateRange = parseDateRange(query);
      const stats = await analyticsService.getVenueStats(
        customerProfile.id,
        dateRange
      );

      return reply.send({ venues: stats });
    }
  );

  // Get system statistics
  server.get(
    '/stats/systems',
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

      const stats = await analyticsService.getSystemStats(customerProfile.id);

      return reply.send({ systems: stats });
    }
  );

  // Get request trends
  server.get(
    '/stats/trends',
    {
      preHandler: server.authenticate,
    },
    async (request, reply) => {
      const userId = request.user!.sub;
      const query = request.query as Record<string, unknown>;
      const days = Math.min(
        parseInt(String(query.days || 30), 10),
        365
      );

      const customerProfile = await prisma.customerProfile.findUnique({
        where: { userId },
      });

      if (!customerProfile) {
        throw new NotFoundError('Customer profile');
      }

      const trends = await analyticsService.getRequestTrends(
        customerProfile.id,
        days
      );

      return reply.send({ trends });
    }
  );

  // Get top songs
  server.get(
    '/stats/top-songs',
    {
      preHandler: server.authenticate,
    },
    async (request, reply) => {
      const userId = request.user!.sub;
      const query = request.query as Record<string, unknown>;
      const limit = Math.min(parseInt(String(query.limit || 50), 10), 200);

      const customerProfile = await prisma.customerProfile.findUnique({
        where: { userId },
      });

      if (!customerProfile) {
        throw new NotFoundError('Customer profile');
      }

      const dateRange = parseDateRange(query);
      const topSongs = await analyticsService.getTopSongs(
        customerProfile.id,
        limit,
        dateRange
      );

      return reply.send({ songs: topSongs });
    }
  );

  // Get singer leaderboard
  server.get(
    '/stats/singers',
    {
      preHandler: server.authenticate,
    },
    async (request, reply) => {
      const userId = request.user!.sub;
      const query = request.query as Record<string, unknown>;
      const limit = Math.min(parseInt(String(query.limit || 20), 10), 100);

      const customerProfile = await prisma.customerProfile.findUnique({
        where: { userId },
      });

      if (!customerProfile) {
        throw new NotFoundError('Customer profile');
      }

      const dateRange = parseDateRange(query);
      const leaderboard = await analyticsService.getSingerLeaderboard(
        customerProfile.id,
        limit,
        dateRange
      );

      return reply.send({ singers: leaderboard });
    }
  );
}
