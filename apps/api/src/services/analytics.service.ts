import { prisma } from '@singr/database';
// Logger available for future use if needed
// import { createLogger } from '@singr/observability';
// const logger = createLogger('service:analytics');

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

export interface VenueStats {
  venueId: string;
  venueName: string;
  totalRequests: number;
  processedRequests: number;
  uniqueSingers: number;
  topSongs: Array<{
    artist: string;
    title: string;
    requestCount: number;
  }>;
}

export interface SystemStats {
  systemId: string;
  systemName: string;
  songCount: number;
  recentlyAdded: number;
}

export interface OverallStats {
  totalVenues: number;
  totalSystems: number;
  totalSongs: number;
  totalRequests: number;
  processedRequests: number;
  pendingRequests: number;
  uniqueSingers: number;
  activeToday: number;
}

export class AnalyticsService {
  /**
   * Get overall statistics for customer
   */
  async getOverallStats(
    customerProfileId: string,
    dateRange?: DateRange
  ): Promise<OverallStats> {
    const where: Record<string, unknown> = {};

    if (dateRange) {
      where.requestedAt = {
        gte: dateRange.startDate,
        lte: dateRange.endDate,
      };
    }

    const [
      totalVenues,
      totalSystems,
      totalSongs,
      totalRequests,
      processedRequests,
      uniqueSingers,
      activeToday,
    ] = await Promise.all([
      // Venue count
      prisma.venue.count({
        where: { customerProfileId },
      }),

      // System count
      prisma.system.count({
        where: { customerProfileId },
      }),

      // Song count
      prisma.songDb.count({
        where: { customerProfileId },
      }),

      // Total requests
      prisma.request.count({
        where: {
          venue: { customerProfileId },
          ...where,
        },
      }),

      // Processed requests
      prisma.request.count({
        where: {
          venue: { customerProfileId },
          processed: true,
          ...where,
        },
      }),

      // Unique singers (with profiles)
      prisma.request
        .groupBy({
          by: ['singerProfileId'],
          where: {
            venue: { customerProfileId },
            singerProfileId: { not: null },
            ...where,
          },
        })
        .then((groups) => groups.length),

      // Active today
      prisma.request.count({
        where: {
          venue: { customerProfileId },
          requestedAt: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
          },
        },
      }),
    ]);

    return {
      totalVenues,
      totalSystems,
      totalSongs,
      totalRequests,
      processedRequests,
      pendingRequests: totalRequests - processedRequests,
      uniqueSingers,
      activeToday,
    };
  }

  /**
   * Get statistics per venue
   */
  async getVenueStats(
    customerProfileId: string,
    dateRange?: DateRange
  ): Promise<VenueStats[]> {
    const venues = await prisma.venue.findMany({
      where: { customerProfileId },
      select: {
        id: true,
        name: true,
      },
    });

    const stats: VenueStats[] = [];

    for (const venue of venues) {
      const where: Record<string, unknown> = { venueId: venue.id };

      if (dateRange) {
        where.requestedAt = {
          gte: dateRange.startDate,
          lte: dateRange.endDate,
        };
      }

      const [totalRequests, processedRequests, uniqueSingers, topSongsData] =
        await Promise.all([
          // Total requests
          prisma.request.count({ where }),

          // Processed requests
          prisma.request.count({
            where: { ...where, processed: true },
          }),

          // Unique singers
          prisma.request
            .groupBy({
              by: ['singerProfileId'],
              where: {
                ...where,
                singerProfileId: { not: null },
              },
            })
            .then((groups) => groups.length),

          // Top songs
          prisma.request.groupBy({
            by: ['artist', 'title'],
            where,
            _count: { id: true },
            orderBy: { _count: { id: 'desc' } },
            take: 10,
          }),
        ]);

      stats.push({
        venueId: venue.id,
        venueName: venue.name,
        totalRequests,
        processedRequests,
        uniqueSingers,
        topSongs: topSongsData.map((song) => ({
          artist: song.artist,
          title: song.title,
          requestCount: song._count.id,
        })),
      });
    }

    return stats;
  }

  /**
   * Get system statistics
   */
  async getSystemStats(customerProfileId: string): Promise<SystemStats[]> {
    const systems = await prisma.system.findMany({
      where: { customerProfileId },
      select: {
        id: true,
        openkjSystemId: true,
        name: true,
      },
    });

    const stats: SystemStats[] = [];
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    for (const system of systems) {
      const [songCount, recentlyAdded] = await Promise.all([
        prisma.songDb.count({
          where: {
            customerProfileId,
            openkjSystemId: system.openkjSystemId,
          },
        }),

        prisma.songDb.count({
          where: {
            customerProfileId,
            openkjSystemId: system.openkjSystemId,
            createdAt: { gte: thirtyDaysAgo },
          },
        }),
      ]);

      stats.push({
        systemId: system.id,
        systemName: system.name,
        songCount,
        recentlyAdded,
      });
    }

    return stats;
  }

  /**
   * Get request trends (daily counts)
   */
  async getRequestTrends(
    customerProfileId: string,
    days: number = 30
  ): Promise<Array<{ date: string; requests: number; processed: number }>> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const requests = await prisma.request.findMany({
      where: {
        venue: { customerProfileId },
        requestedAt: { gte: startDate },
      },
      select: {
        requestedAt: true,
        processed: true,
      },
    });

    // Group by date
    const trendMap = new Map<
      string,
      { requests: number; processed: number }
    >();

    for (const request of requests) {
      const dateKey = request.requestedAt.toISOString().split('T')[0];
      if (!dateKey) continue;
      const existing = trendMap.get(dateKey) || { requests: 0, processed: 0 };

      existing.requests++;
      if (request.processed) {
        existing.processed++;
      }

      trendMap.set(dateKey, existing);
    }

    // Convert to array and sort
    return Array.from(trendMap.entries())
      .map(([date, counts]) => ({
        date,
        requests: counts.requests,
        processed: counts.processed,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Get top songs across all venues
   */
  async getTopSongs(
    customerProfileId: string,
    limit: number = 50,
    dateRange?: DateRange
  ): Promise<Array<{ artist: string; title: string; requestCount: number }>> {
    const where: Record<string, unknown> = {
      venue: { customerProfileId },
    };

    if (dateRange) {
      where.requestedAt = {
        gte: dateRange.startDate,
        lte: dateRange.endDate,
      };
    }

    const topSongs = await prisma.request.groupBy({
      by: ['artist', 'title'],
      where,
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: limit,
    });

    return topSongs.map((song) => ({
      artist: song.artist,
      title: song.title,
      requestCount: song._count.id,
    }));
  }

  /**
   * Get singer leaderboard (most active singers)
   */
  async getSingerLeaderboard(
    customerProfileId: string,
    limit: number = 20,
    dateRange?: DateRange
  ): Promise<
    Array<{
      singerProfileId: string;
      singerName: string;
      requestCount: number;
    }>
  > {
    const where: Record<string, unknown> = {
      venue: { customerProfileId },
      singerProfileId: { not: null },
    };

    if (dateRange) {
      where.requestedAt = {
        gte: dateRange.startDate,
        lte: dateRange.endDate,
      };
    }

    const topSingers = await prisma.request.groupBy({
      by: ['singerProfileId'],
      where,
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: limit,
    });

    // Fetch singer details
    const singerIds = topSingers
      .map((s) => s.singerProfileId)
      .filter((id): id is string => id !== null);

    const singers = await prisma.singerProfile.findMany({
      where: { id: { in: singerIds } },
      select: {
        id: true,
        nickname: true,
        user: {
          select: {
            name: true,
          },
        },
      },
    });

    const singerMap = new Map(singers.map((s) => [s.id, s]));

    return topSingers
      .filter((s) => s.singerProfileId)
      .map((s) => {
        const singer = singerMap.get(s.singerProfileId!);
        return {
          singerProfileId: s.singerProfileId!,
          singerName: singer?.nickname || singer?.user.name || 'Unknown',
          requestCount: s._count.id,
        };
      });
  }
}
