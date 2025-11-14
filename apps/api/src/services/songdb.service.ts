import { prisma } from '@singr/database';
import { createLogger } from '@singr/observability';
import { NotFoundError } from '@singr/shared';

const logger = createLogger('service:songdb');

export interface SongFilters {
  systemId?: string;
  search?: string;
}

export interface ImportSongInput {
  artist: string;
  title: string;
}

export interface BulkImportInput {
  openkjSystemId: number;
  songs: ImportSongInput[];
}

function normalizeSongName(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export class SongDbService {
  async searchSongs(
    customerProfileId: string,
    filters: SongFilters,
    limit: number,
    offset: number
  ) {
    const where: Record<string, unknown> = { customerProfileId };

    if (filters.systemId) {
      // Find system first
      const system = await prisma.system.findFirst({
        where: {
          id: filters.systemId,
          customerProfileId,
        },
      });

      if (!system) {
        throw new NotFoundError('System');
      }

      where.openkjSystemId = system.openkjSystemId;
    }

    if (filters.search && filters.search.length >= 2) {
      where.OR = [
        { artist: { contains: filters.search, mode: 'insensitive' } },
        { title: { contains: filters.search, mode: 'insensitive' } },
        { combined: { contains: filters.search, mode: 'insensitive' } },
        {
          normalizedCombined: {
            contains: normalizeSongName(filters.search),
            mode: 'insensitive',
          },
        },
      ];
    }

    const [songs, total] = await Promise.all([
      prisma.songDb.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: [{ artist: 'asc' }, { title: 'asc' }],
        select: {
          id: true,
          artist: true,
          title: true,
          combined: true,
          openkjSystemId: true,
          createdAt: true,
        },
      }),
      prisma.songDb.count({ where }),
    ]);

    return { songs, total };
  }

  async getSong(songId: string, customerProfileId: string) {
    const song = await prisma.songDb.findFirst({
      where: {
        id: BigInt(songId),
        customerProfileId,
      },
    });

    if (!song) {
      throw new NotFoundError('Song');
    }

    return song;
  }

  async bulkImportSongs(
    customerProfileId: string,
    input: BulkImportInput
  ): Promise<{ imported: number; skipped: number; errors: number }> {
    // Verify system exists
    const system = await prisma.system.findFirst({
      where: {
        customerProfileId,
        openkjSystemId: input.openkjSystemId,
      },
    });

    if (!system) {
      throw new NotFoundError('System');
    }

    let imported = 0;
    let skipped = 0;
    let errors = 0;

    // Process in batches of 100
    const batchSize = 100;
    for (let i = 0; i < input.songs.length; i += batchSize) {
      const batch = input.songs.slice(i, i + batchSize);

      for (const song of batch) {
        try {
          const combined = `${song.artist} - ${song.title}`;
          const normalizedCombined = normalizeSongName(combined);

          // Check if song already exists
          const existing = await prisma.songDb.findFirst({
            where: {
              customerProfileId,
              openkjSystemId: input.openkjSystemId,
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
              openkjSystemId: input.openkjSystemId,
              artist: song.artist,
              title: song.title,
              combined,
              normalizedCombined,
            },
          });

          imported++;
        } catch (error) {
          logger.error({ error, song }, 'Failed to import song');
          errors++;
        }
      }
    }

    logger.info(
      {
        customerProfileId,
        systemId: input.openkjSystemId,
        imported,
        skipped,
        errors,
        total: input.songs.length,
      },
      'Bulk import completed'
    );

    return { imported, skipped, errors };
  }

  async deleteSong(songId: string, customerProfileId: string) {
    const song = await prisma.songDb.findFirst({
      where: {
        id: BigInt(songId),
        customerProfileId,
      },
    });

    if (!song) {
      throw new NotFoundError('Song');
    }

    await prisma.songDb.delete({
      where: { id: BigInt(songId) },
    });

    logger.info({ songId, customerProfileId }, 'Song deleted');
  }

  async deleteBulkSongs(
    customerProfileId: string,
    systemId: string
  ): Promise<number> {
    // Verify system exists
    const system = await prisma.system.findFirst({
      where: {
        id: systemId,
        customerProfileId,
      },
    });

    if (!system) {
      throw new NotFoundError('System');
    }

    const result = await prisma.songDb.deleteMany({
      where: {
        customerProfileId,
        openkjSystemId: system.openkjSystemId,
      },
    });

    logger.info(
      {
        customerProfileId,
        systemId,
        deletedCount: result.count,
      },
      'Bulk delete completed'
    );

    return result.count;
  }

  async exportSongs(
    customerProfileId: string,
    systemId: string
  ): Promise<ImportSongInput[]> {
    // Verify system exists
    const system = await prisma.system.findFirst({
      where: {
        id: systemId,
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
      select: {
        artist: true,
        title: true,
      },
      orderBy: [{ artist: 'asc' }, { title: 'asc' }],
    });

    return songs;
  }
}
