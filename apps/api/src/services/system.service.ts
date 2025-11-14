import { prisma } from '@singr/database';
import { createLogger } from '@singr/observability';
import { NotFoundError, ConflictError } from '@singr/shared';

const logger = createLogger('service:system');

export interface SystemFilters {
  search?: string;
}

export interface CreateSystemInput {
  name: string;
  configuration?: Record<string, unknown>;
}

export interface UpdateSystemInput {
  name?: string;
  configuration?: Record<string, unknown>;
}

export class SystemService {
  async listSystems(
    customerProfileId: string,
    filters: SystemFilters,
    limit: number,
    offset: number
  ) {
    const where: Record<string, unknown> = { customerProfileId };

    if (filters.search) {
      where.name = { contains: filters.search, mode: 'insensitive' };
    }

    const [systems, total] = await Promise.all([
      prisma.system.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { name: 'asc' },
      }),
      prisma.system.count({ where }),
    ]);

    // Get song counts for each system
    const systemIds = systems.map((s) => s.openkjSystemId);
    const songCounts = await prisma.songDb.groupBy({
      by: ['openkjSystemId'],
      where: {
        customerProfileId,
        openkjSystemId: { in: systemIds },
      },
      _count: { id: true },
    });

    const songCountMap = new Map(
      songCounts.map((sc) => [sc.openkjSystemId, sc._count.id])
    );

    return {
      systems: systems.map((s) => ({
        id: s.id,
        openkjSystemId: s.openkjSystemId,
        name: s.name,
        configuration: s.configuration || {},
        songCount: songCountMap.get(s.openkjSystemId) || 0,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
      total,
    };
  }

  async getSystem(systemId: string, customerProfileId: string) {
    const system = await prisma.system.findFirst({
      where: {
        id: systemId,
        customerProfileId,
      },
    });

    if (!system) {
      throw new NotFoundError('System');
    }

    // Get song count
    const songCount = await prisma.songDb.count({
      where: {
        customerProfileId,
        openkjSystemId: system.openkjSystemId,
      },
    });

    return {
      id: system.id,
      openkjSystemId: system.openkjSystemId,
      name: system.name,
      configuration: system.configuration || {},
      songCount,
      createdAt: system.createdAt,
      updatedAt: system.updatedAt,
    };
  }

  async createSystem(
    customerProfileId: string,
    input: CreateSystemInput
  ) {
    // Get next OpenKJ system ID
    const state = await prisma.state.upsert({
      where: { customerProfileId },
      update: { serial: { increment: 1 } },
      create: { customerProfileId, serial: 1 },
    });

    const system = await prisma.system.create({
      data: {
        customerProfileId,
        openkjSystemId: Number(state.serial),
        name: input.name,
        configuration: (input.configuration || {}) as any,
      },
    });

    logger.info(
      { systemId: system.id, customerProfileId },
      'System created'
    );

    return {
      id: system.id,
      openkjSystemId: system.openkjSystemId,
      name: system.name,
      configuration: system.configuration || {},
      songCount: 0,
      createdAt: system.createdAt,
      updatedAt: system.updatedAt,
    };
  }

  async updateSystem(
    systemId: string,
    customerProfileId: string,
    input: UpdateSystemInput
  ) {
    const system = await prisma.system.findFirst({
      where: {
        id: systemId,
        customerProfileId,
      },
    });

    if (!system) {
      throw new NotFoundError('System');
    }

    const updateData: Record<string, unknown> = {};

    if (input.name !== undefined) updateData.name = input.name;
    if (input.configuration !== undefined) {
      updateData.configuration = {
        ...(system.configuration as Record<string, unknown>),
        ...input.configuration,
      };
    }

    const updated = await prisma.system.update({
      where: { id: systemId },
      data: updateData,
    });

    // Get song count
    const songCount = await prisma.songDb.count({
      where: {
        customerProfileId,
        openkjSystemId: updated.openkjSystemId,
      },
    });

    logger.info({ systemId, customerProfileId }, 'System updated');

    return {
      id: updated.id,
      openkjSystemId: updated.openkjSystemId,
      name: updated.name,
      configuration: updated.configuration || {},
      songCount,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }

  async deleteSystem(systemId: string, customerProfileId: string) {
    const system = await prisma.system.findFirst({
      where: {
        id: systemId,
        customerProfileId,
      },
    });

    if (!system) {
      throw new NotFoundError('System');
    }

    // Check if system has songs
    const songCount = await prisma.songDb.count({
      where: {
        customerProfileId,
        openkjSystemId: system.openkjSystemId,
      },
    });

    if (songCount > 0) {
      throw new ConflictError(
        `Cannot delete system with ${songCount} songs. Please delete all songs first.`
      );
    }

    await prisma.system.delete({
      where: { id: systemId },
    });

    logger.info(
      { systemId, customerProfileId, name: system.name },
      'System deleted'
    );
  }
}
