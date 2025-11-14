import { prisma } from '@singr/database';
import {
  NotFoundError,
  ConflictError,
  type CreateVenueInput,
  type UpdateVenueInput,
} from '@singr/shared';

export class VenueService {
  async createVenue(customerProfileId: string, data: CreateVenueInput) {
    // Check if URL name is already taken
    const existing = await prisma.venue.findUnique({
      where: { urlName: data.urlName },
    });

    if (existing) {
      throw new ConflictError('URL name is already taken');
    }

    // Get next OpenKJ venue ID
    const state = await prisma.state.upsert({
      where: { customerProfileId },
      update: { serial: { increment: 1 } },
      create: { customerProfileId, serial: 1 },
    });

    // Create venue with geographic point if coordinates would be provided
    const venue = await prisma.venue.create({
      data: {
        customerProfileId,
        openkjVenueId: Number(state.serial),
        name: data.name,
        urlName: data.urlName,
        address: data.address,
        city: data.city,
        state: data.state,
        postalCode: data.postalCode,
        country: data.country,
        phoneNumber: data.phoneNumber,
        website: data.website,
        acceptingRequests: data.acceptingRequests,
      },
    });

    return venue;
  }

  async updateVenue(
    venueId: string,
    customerProfileId: string,
    data: UpdateVenueInput
  ) {
    // Verify ownership
    const venue = await prisma.venue.findFirst({
      where: { id: venueId, customerProfileId },
    });

    if (!venue) {
      throw new NotFoundError('Venue');
    }

    const updated = await prisma.venue.update({
      where: { id: venueId },
      data: {
        name: data.name,
        address: data.address,
        city: data.city,
        state: data.state,
        postalCode: data.postalCode,
        country: data.country,
        phoneNumber: data.phoneNumber,
        website: data.website,
        acceptingRequests: data.acceptingRequests,
      },
    });

    return updated;
  }

  async deleteVenue(venueId: string, customerProfileId: string) {
    // Verify ownership
    const venue = await prisma.venue.findFirst({
      where: { id: venueId, customerProfileId },
    });

    if (!venue) {
      throw new NotFoundError('Venue');
    }

    await prisma.venue.delete({
      where: { id: venueId },
    });
  }

  async getVenue(venueId: string, customerProfileId: string) {
    const venue = await prisma.venue.findFirst({
      where: { id: venueId, customerProfileId },
    });

    if (!venue) {
      throw new NotFoundError('Venue');
    }

    return venue;
  }

  async listVenues(customerProfileId: string, limit: number, offset: number) {
    const [venues, total] = await Promise.all([
      prisma.venue.findMany({
        where: { customerProfileId },
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.venue.count({
        where: { customerProfileId },
      }),
    ]);

    return { venues, total };
  }

  async searchPublicVenues(filters: {
    city?: string;
    state?: string;
    acceptingRequests?: boolean;
    limit: number;
    offset: number;
  }) {
    const where: Record<string, unknown> = {};

    if (filters.city) {
      where.city = { contains: filters.city, mode: 'insensitive' };
    }
    if (filters.state) {
      where.state = { contains: filters.state, mode: 'insensitive' };
    }
    if (filters.acceptingRequests !== undefined) {
      where.acceptingRequests = filters.acceptingRequests;
    }

    const [venues, total] = await Promise.all([
      prisma.venue.findMany({
        where,
        take: filters.limit,
        skip: filters.offset,
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          urlName: true,
          city: true,
          state: true,
          address: true,
          postalCode: true,
          phoneNumber: true,
          website: true,
          acceptingRequests: true,
        },
      }),
      prisma.venue.count({ where }),
    ]);

    return { venues, total };
  }
}
