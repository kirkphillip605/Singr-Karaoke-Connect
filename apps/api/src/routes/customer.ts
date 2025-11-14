import { FastifyInstance } from 'fastify';
import { prisma } from '@singr/database';
import {
  NotFoundError,
  createVenueSchema,
  updateVenueSchema,
  parsePaginationParams,
  createPaginationInfo,
  type CreateVenueInput,
  type UpdateVenueInput,
} from '@singr/shared';
import { VenueService } from '../services/venue.service.js';
import { RequestService } from '../services/request.service.js';

export default async function customerRoutes(server: FastifyInstance) {
  const venueService = new VenueService();
  const requestService = new RequestService();

  // Get customer profile
  server.get(
    '/profile',
    {
      preHandler: server.authenticate,
    },
    async (request, reply) => {
      const userId = (request.user as any).sub;

      const profile = await prisma.customerProfile.findUnique({
        where: { userId },
        select: {
          id: true,
          legalBusinessName: true,
          dbaName: true,
          contactEmail: true,
          contactPhone: true,
          timezone: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!profile) {
        throw new NotFoundError('Customer profile');
      }

      return reply.send(profile);
    }
  );

  // List venues
  server.get(
    '/venues',
    {
      preHandler: server.authenticate,
    },
    async (request, reply) => {
      const userId = (request.user as any).sub;
      const { limit, offset } = parsePaginationParams(
        request.query as Record<string, unknown>
      );

      const customerProfile = await prisma.customerProfile.findUnique({
        where: { userId },
      });

      if (!customerProfile) {
        throw new NotFoundError('Customer profile');
      }

      const { venues, total } = await venueService.listVenues(
        customerProfile.id,
        limit,
        offset
      );

      return reply.send({
        venues,
        pagination: createPaginationInfo(total, limit || 10, offset || 0, venues.length),
      });
    }
  );

  // Create venue
  server.post<{ Body: CreateVenueInput }>(
    '/venues',
    {
      preHandler: server.authenticate,
      schema: {
        body: createVenueSchema,
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

      const venue = await venueService.createVenue(
        customerProfile.id,
        request.body
      );

      return reply.code(201).send(venue);
    }
  );

  // Get venue
  server.get<{ Params: { venueId: string } }>(
    '/venues/:venueId',
    {
      preHandler: server.authenticate,
    },
    async (request, reply) => {
      const userId = (request.user as any).sub;
      const { venueId } = request.params;

      const customerProfile = await prisma.customerProfile.findUnique({
        where: { userId },
      });

      if (!customerProfile) {
        throw new NotFoundError('Customer profile');
      }

      const venue = await venueService.getVenue(venueId, customerProfile.id);
      return reply.send(venue);
    }
  );

  // Update venue
  server.put<{ Params: { venueId: string }; Body: UpdateVenueInput }>(
    '/venues/:venueId',
    {
      preHandler: server.authenticate,
      schema: {
        body: updateVenueSchema,
      },
    },
    async (request, reply) => {
      const userId = (request.user as any).sub;
      const { venueId } = request.params;

      const customerProfile = await prisma.customerProfile.findUnique({
        where: { userId },
      });

      if (!customerProfile) {
        throw new NotFoundError('Customer profile');
      }

      const venue = await venueService.updateVenue(
        venueId,
        customerProfile.id,
        request.body
      );

      return reply.send(venue);
    }
  );

  // Delete venue
  server.delete<{ Params: { venueId: string } }>(
    '/venues/:venueId',
    {
      preHandler: server.authenticate,
    },
    async (request, reply) => {
      const userId = (request.user as any).sub;
      const { venueId } = request.params;

      const customerProfile = await prisma.customerProfile.findUnique({
        where: { userId },
      });

      if (!customerProfile) {
        throw new NotFoundError('Customer profile');
      }

      await venueService.deleteVenue(venueId, customerProfile.id);
      return reply.code(204).send();
    }
  );

  // Get venue requests
  server.get<{ Params: { venueId: string } }>(
    '/venues/:venueId/requests',
    {
      preHandler: server.authenticate,
    },
    async (request, reply) => {
      const userId = (request.user as any).sub;
      const { venueId } = request.params;
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

      const { requests, total } = await requestService.listVenueRequests(
        venueId,
        customerProfile.id,
        {
          processed: query.processed ? query.processed === 'true' : undefined,
          limit,
          offset,
        }
      );

      return reply.send({
        requests,
        pagination: createPaginationInfo(total, limit || 10, offset || 0, requests.length),
      });
    }
  );

  // Update request
  server.patch<{
    Params: { venueId: string; requestId: string };
    Body: { processed?: boolean; notes?: string };
  }>(
    '/venues/:venueId/requests/:requestId',
    {
      preHandler: server.authenticate,
    },
    async (request, reply) => {
      const userId = (request.user as any).sub;
      const { venueId, requestId } = request.params;

      const customerProfile = await prisma.customerProfile.findUnique({
        where: { userId },
      });

      if (!customerProfile) {
        throw new NotFoundError('Customer profile');
      }

      const updated = await requestService.updateRequest(
        requestId,
        venueId,
        customerProfile.id,
        request.body
      );

      return reply.send(updated);
    }
  );

  // Delete request
  server.delete<{ Params: { venueId: string; requestId: string } }>(
    '/venues/:venueId/requests/:requestId',
    {
      preHandler: server.authenticate,
    },
    async (request, reply) => {
      const userId = (request.user as any).sub;
      const { venueId, requestId } = request.params;

      const customerProfile = await prisma.customerProfile.findUnique({
        where: { userId },
      });

      if (!customerProfile) {
        throw new NotFoundError('Customer profile');
      }

      await requestService.deleteRequest(
        requestId,
        venueId,
        customerProfile.id
      );

      return reply.code(204).send();
    }
  );
}
