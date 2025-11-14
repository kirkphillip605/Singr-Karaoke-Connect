import { prisma } from '@singr/database';
import { NotFoundError, AuthorizationError } from '@singr/shared';

export class RequestService {
  async createRequest(data: {
    venueId: string;
    singerProfileId?: string;
    submittedByUserId?: string;
    artist: string;
    title: string;
    keyChange?: number;
    notes?: string;
  }) {
    // Verify venue exists and is accepting requests
    const venue = await prisma.venue.findUnique({
      where: { id: data.venueId },
    });

    if (!venue) {
      throw new NotFoundError('Venue');
    }

    if (!venue.acceptingRequests) {
      throw new AuthorizationError('Venue is not accepting requests');
    }

    const request = await prisma.request.create({
      data: {
        venueId: data.venueId,
        singerProfileId: data.singerProfileId,
        submittedByUserId: data.submittedByUserId,
        artist: data.artist,
        title: data.title,
        keyChange: data.keyChange || 0,
        notes: data.notes,
        processed: false,
      },
    });

    // If singer is logged in, add to history
    if (data.singerProfileId) {
      await prisma.singerRequestHistory.create({
        data: {
          singerProfileId: data.singerProfileId,
          venueId: data.venueId,
          artist: data.artist,
          title: data.title,
          keyChange: data.keyChange || 0,
          songFingerprint: `${data.artist}:${data.title}`.toLowerCase(),
        },
      });
    }

    return request;
  }

  async listVenueRequests(
    venueId: string,
    customerProfileId: string,
    filters: {
      processed?: boolean;
      limit: number;
      offset: number;
    }
  ) {
    // Verify venue ownership
    const venue = await prisma.venue.findFirst({
      where: { id: venueId, customerProfileId },
    });

    if (!venue) {
      throw new NotFoundError('Venue');
    }

    const where: Record<string, unknown> = { venueId };
    if (filters.processed !== undefined) {
      where.processed = filters.processed;
    }

    const [requests, total] = await Promise.all([
      prisma.request.findMany({
        where,
        take: filters.limit,
        skip: filters.offset,
        include: {
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
        orderBy: { requestedAt: 'asc' },
      }),
      prisma.request.count({ where }),
    ]);

    return { requests, total };
  }

  async updateRequest(
    requestId: string,
    venueId: string,
    customerProfileId: string,
    data: {
      processed?: boolean;
      notes?: string;
    }
  ) {
    // Verify venue ownership
    const venue = await prisma.venue.findFirst({
      where: { id: venueId, customerProfileId },
    });

    if (!venue) {
      throw new NotFoundError('Venue');
    }

    // Verify request belongs to venue
    const request = await prisma.request.findFirst({
      where: { id: BigInt(requestId), venueId },
    });

    if (!request) {
      throw new NotFoundError('Request');
    }

    const updated = await prisma.request.update({
      where: { id: BigInt(requestId) },
      data: {
        processed: data.processed,
        notes: data.notes,
        processedAt: data.processed ? new Date() : null,
      },
    });

    return updated;
  }

  async deleteRequest(
    requestId: string,
    venueId: string,
    customerProfileId: string
  ) {
    // Verify venue ownership
    const venue = await prisma.venue.findFirst({
      where: { id: venueId, customerProfileId },
    });

    if (!venue) {
      throw new NotFoundError('Venue');
    }

    // Verify request belongs to venue
    const request = await prisma.request.findFirst({
      where: { id: BigInt(requestId), venueId },
    });

    if (!request) {
      throw new NotFoundError('Request');
    }

    await prisma.request.delete({
      where: { id: BigInt(requestId) },
    });
  }

  async getSingerHistory(
    singerProfileId: string,
    limit: number,
    offset: number,
    venueId?: string
  ) {
    const where: Record<string, unknown> = { singerProfileId };
    if (venueId) {
      where.venueId = venueId;
    }

    const [history, total] = await Promise.all([
      prisma.singerRequestHistory.findMany({
        where,
        take: limit,
        skip: offset,
        include: {
          venue: {
            select: {
              id: true,
              name: true,
              city: true,
              state: true,
            },
          },
        },
        orderBy: { requestedAt: 'desc' },
      }),
      prisma.singerRequestHistory.count({ where }),
    ]);

    return { history, total };
  }
}
