# Singr Central API Backend - Phase 14

**Document Version:** 1.0  
**Last Updated:** 2025-11-12  
**Author:** kirkphillip605  
**Status:** In Development

---

## Phase 14: Request Interface API

**Objective**: Create a modern REST API with proper authentication headers for standalone request interface applications (desktop/web), allowing customers who don't use OpenKJ to receive song requests through native apps.

### 14.1 Request Interface Authentication

The standalone request interface will authenticate using OpenKJ API keys but via proper `Authorization` headers instead of body-based authentication. This makes the API easier to integrate with standard HTTP clients and future karaoke host software partnerships.

```typescript
// src/lib/middleware/request-interface-auth.ts

import type { FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { logger } from '../logger';

export interface RequestInterfaceAuthUser {
  customerProfileId: string;
  apiKeyId: string;
  hasActiveSubscription: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    requestInterfaceUser?: RequestInterfaceAuthUser;
  }
}

/**
 * Authenticate request interface using API key from Authorization header
 * Format: Authorization: Bearer <api_key>
 */
export async function authenticateRequestInterface(
  request: FastifyRequest,
  reply: FastifyReply,
  prisma: PrismaClient
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader) {
    return reply.code(401).send({
      type: 'authentication_required',
      title: 'Authentication Required',
      detail: 'Missing Authorization header',
    });
  }

  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return reply.code(401).send({
      type: 'invalid_authentication',
      title: 'Invalid Authentication',
      detail: 'Authorization header must use Bearer scheme',
    });
  }

  // Find matching API key
  const apiKeys = await prisma.apiKey.findMany({
    where: {
      status: 'active',
      revokedAt: null,
    },
    include: {
      customerProfile: {
        include: {
          subscriptions: {
            where: {
              status: {
                in: ['active', 'trialing'],
              },
            },
            take: 1,
            orderBy: { createdAt: 'desc' },
          },
        },
      },
    },
  });

  let matchedKey = null;

  for (const key of apiKeys) {
    const isMatch = await bcrypt.compare(token, key.apiKeyHash);
    if (isMatch) {
      matchedKey = key;
      break;
    }
  }

  if (!matchedKey) {
    logger.warn('Request interface authentication failed - invalid API key', {
      ip: request.ip,
    });

    return reply.code(401).send({
      type: 'invalid_credentials',
      title: 'Invalid API Key',
      detail: 'The provided API key is not valid',
    });
  }

  // Update last used timestamp
  await prisma.apiKey.update({
    where: { id: matchedKey.id },
    data: { lastUsedAt: new Date() },
  });

  const hasActiveSubscription = matchedKey.customerProfile.subscriptions.length > 0;

  // Attach auth info to request
  request.requestInterfaceUser = {
    customerProfileId: matchedKey.customerProfileId,
    apiKeyId: matchedKey.id,
    hasActiveSubscription,
  };

  logger.info('Request interface authenticated', {
    customerProfileId: matchedKey.customerProfileId,
    apiKeyId: matchedKey.id,
  });
}
```

### 14.2 Request Interface Service

```typescript
// src/services/request-interface-service.ts

import { PrismaClient } from '@prisma/client';
import { logger } from '../lib/logger';

export interface RequestFilters {
  venueId?: string;
  processed?: boolean;
  limit?: number;
  offset?: number;
  singerName?: string;
  songSearch?: string;
}

export class RequestInterfaceService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Get requests for customer with filters
   */
  async getRequests(customerProfileId: string, filters: RequestFilters = {}) {
    const {
      venueId,
      processed = false,
      limit = 100,
      offset = 0,
      singerName,
      songSearch,
    } = filters;

    const where: any = {
      venue: {
        customerProfileId,
      },
      processed,
    };

    if (venueId) {
      where.venueId = venueId;
    }

    if (singerName) {
      where.singerUser = {
        name: {
          contains: singerName,
          mode: 'insensitive',
        },
      };
    }

    if (songSearch) {
      where.OR = [
        {
          artist: {
            contains: songSearch,
            mode: 'insensitive',
          },
        },
        {
          title: {
            contains: songSearch,
            mode: 'insensitive',
          },
        },
      ];
    }

    const [requests, total] = await Promise.all([
      this.prisma.request.findMany({
        where,
        include: {
          venue: {
            select: {
              id: true,
              name: true,
              urlName: true,
            },
          },
          singerUser: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: { requestedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.request.count({ where }),
    ]);

    return {
      requests: requests.map((r) => ({
        id: r.requestId.toString(),
        venueId: r.venueId,
        venueName: r.venue.name,
        singer: r.singerUser?.name || 'Anonymous',
        artist: r.artist,
        title: r.title,
        keyChange: r.keyChange,
        processed: r.processed,
        requestedAt: r.requestedAt,
      })),
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    };
  }

  /**
   * Get request statistics
   */
  async getStats(customerProfileId: string, venueId?: string) {
    const where: any = {
      venue: {
        customerProfileId,
      },
    };

    if (venueId) {
      where.venueId = venueId;
    }

    const [total, pending, processedToday] = await Promise.all([
      this.prisma.request.count({ where }),
      this.prisma.request.count({
        where: { ...where, processed: false },
      }),
      this.prisma.request.count({
        where: {
          ...where,
          processed: true,
          updatedAt: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
          },
        },
      }),
    ]);

    return {
      total,
      pending,
      processedToday,
    };
  }

  /**
   * Mark request as processed
   */
  async markAsProcessed(
    customerProfileId: string,
    requestId: string
  ) {
    const request = await this.prisma.request.findFirst({
      where: {
        requestId: BigInt(requestId),
        venue: {
          customerProfileId,
        },
      },
    });

    if (!request) {
      throw new Error('Request not found or access denied');
    }

    const updated = await this.prisma.request.update({
      where: { requestId: BigInt(requestId) },
      data: { processed: true },
    });

    logger.info('Request marked as processed via interface', {
      requestId,
      customerProfileId,
    });

    return updated;
  }

  /**
   * Mark request as unprocessed (undo)
   */
  async markAsUnprocessed(
    customerProfileId: string,
    requestId: string
  ) {
    const request = await this.prisma.request.findFirst({
      where: {
        requestId: BigInt(requestId),
        venue: {
          customerProfileId,
        },
      },
    });

    if (!request) {
      throw new Error('Request not found or access denied');
    }

    const updated = await this.prisma.request.update({
      where: { requestId: BigInt(requestId) },
      data: { processed: false },
    });

    logger.info('Request marked as unprocessed via interface', {
      requestId,
      customerProfileId,
    });

    return updated;
  }

  /**
   * Bulk mark requests as processed
   */
  async bulkMarkAsProcessed(
    customerProfileId: string,
    requestIds: string[]
  ) {
    const result = await this.prisma.request.updateMany({
      where: {
        requestId: {
          in: requestIds.map((id) => BigInt(id)),
        },
        venue: {
          customerProfileId,
        },
      },
      data: { processed: true },
    });

    logger.info('Bulk mark as processed via interface', {
      customerProfileId,
      count: result.count,
    });

    return result;
  }

  /**
   * Delete request
   */
  async deleteRequest(
    customerProfileId: string,
    requestId: string
  ) {
    const request = await this.prisma.request.findFirst({
      where: {
        requestId: BigInt(requestId),
        venue: {
          customerProfileId,
        },
      },
    });

    if (!request) {
      throw new Error('Request not found or access denied');
    }

    await this.prisma.request.delete({
      where: { requestId: BigInt(requestId) },
    });

    logger.info('Request deleted via interface', {
      requestId,
      customerProfileId,
    });
  }

  /**
   * Get venues for customer
   */
  async getVenues(customerProfileId: string) {
    const venues = await this.prisma.venue.findMany({
      where: { customerProfileId },
      select: {
        id: true,
        name: true,
        urlName: true,
        acceptingRequests: true,
        address: true,
        city: true,
        state: true,
        _count: {
          select: {
            requests: {
              where: { processed: false },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return venues.map((v) => ({
      id: v.id,
      name: v.name,
      urlName: v.urlName,
      acceptingRequests: v.acceptingRequests,
      location: `${v.city}, ${v.state}`,
      pendingRequests: v._count.requests,
    }));
  }
}
```

### 14.3 Request Interface Routes

```typescript
// src/routes/v1/request-interface/index.ts

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { RequestInterfaceService } from '../../../services/request-interface-service';
import { authenticateRequestInterface } from '../../../lib/middleware/request-interface-auth';

const GetRequestsSchema = z.object({
  venueId: z.string().uuid().optional(),
  processed: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  singerName: z.string().optional(),
  songSearch: z.string().optional(),
});

const MarkProcessedSchema = z.object({
  requestIds: z.array(z.string()),
});

const requestInterfaceRoutes: FastifyPluginAsync = async (server) => {
  const service = new RequestInterfaceService(server.prisma);

  // Middleware to authenticate all request interface routes
  server.addHook('preHandler', async (request, reply) => {
    await authenticateRequestInterface(request, reply, server.prisma);
  });

  // Get venues
  server.get(
    '/request-interface/venues',
    {
      schema: {
        tags: ['request-interface'],
        summary: 'Get venues',
        description: 'Get all venues for authenticated customer',
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            description: 'List of venues',
            type: 'object',
            properties: {
              venues: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    urlName: { type: 'string' },
                    acceptingRequests: { type: 'boolean' },
                    location: { type: 'string' },
                    pendingRequests: { type: 'integer' },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      if (!request.requestInterfaceUser) {
        return reply.code(401).send({
          type: 'authentication_required',
          title: 'Authentication Required',
        });
      }

      const venues = await service.getVenues(
        request.requestInterfaceUser.customerProfileId
      );

      return reply.send({ venues });
    }
  );

  // Get requests
  server.get(
    '/request-interface/requests',
    {
      schema: {
        tags: ['request-interface'],
        summary: 'Get song requests',
        description: 'Get song requests with optional filters',
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            venueId: { type: 'string', format: 'uuid' },
            processed: { type: 'boolean', default: false },
            limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
            offset: { type: 'integer', minimum: 0, default: 0 },
            singerName: { type: 'string' },
            songSearch: { type: 'string' },
          },
        },
        response: {
          200: {
            description: 'List of requests',
            type: 'object',
            properties: {
              requests: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    venueId: { type: 'string' },
                    venueName: { type: 'string' },
                    singer: { type: 'string' },
                    artist: { type: 'string' },
                    title: { type: 'string' },
                    keyChange: { type: 'integer' },
                    processed: { type: 'boolean' },
                    requestedAt: { type: 'string', format: 'date-time' },
                  },
                },
              },
              pagination: {
                type: 'object',
                properties: {
                  total: { type: 'integer' },
                  limit: { type: 'integer' },
                  offset: { type: 'integer' },
                  hasMore: { type: 'boolean' },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      if (!request.requestInterfaceUser) {
        return reply.code(401).send({
          type: 'authentication_required',
          title: 'Authentication Required',
        });
      }

      const filters = GetRequestsSchema.parse(request.query);

      const result = await service.getRequests(
        request.requestInterfaceUser.customerProfileId,
        filters
      );

      return reply.send(result);
    }
  );

  // Get request statistics
  server.get(
    '/request-interface/stats',
    {
      schema: {
        tags: ['request-interface'],
        summary: 'Get request statistics',
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            venueId: { type: 'string', format: 'uuid' },
          },
        },
        response: {
          200: {
            description: 'Request statistics',
            type: 'object',
            properties: {
              total: { type: 'integer' },
              pending: { type: 'integer' },
              processedToday: { type: 'integer' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      if (!request.requestInterfaceUser) {
        return reply.code(401).send({
          type: 'authentication_required',
          title: 'Authentication Required',
        });
      }

      const { venueId } = request.query as { venueId?: string };

      const stats = await service.getStats(
        request.requestInterfaceUser.customerProfileId,
        venueId
      );

      return reply.send(stats);
    }
  );

  // Mark request as processed
  server.patch(
    '/request-interface/requests/:requestId/process',
    {
      schema: {
        tags: ['request-interface'],
        summary: 'Mark request as processed',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          properties: {
            requestId: { type: 'string' },
          },
        },
        response: {
          200: {
            description: 'Request processed',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      if (!request.requestInterfaceUser) {
        return reply.code(401).send({
          type: 'authentication_required',
          title: 'Authentication Required',
        });
      }

      const { requestId } = request.params as { requestId: string };

      try {
        await service.markAsProcessed(
          request.requestInterfaceUser.customerProfileId,
          requestId
        );

        return reply.send({ success: true });
      } catch (error) {
        if (error instanceof Error && error.message.includes('not found')) {
          return reply.code(404).send({
            type: 'resource_not_found',
            title: 'Request Not Found',
            detail: error.message,
          });
        }
        throw error;
      }
    }
  );

  // Mark request as unprocessed
  server.patch(
    '/request-interface/requests/:requestId/unprocess',
    {
      schema: {
        tags: ['request-interface'],
        summary: 'Mark request as unprocessed',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          properties: {
            requestId: { type: 'string' },
          },
        },
        response: {
          200: {
            description: 'Request unprocessed',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      if (!request.requestInterfaceUser) {
        return reply.code(401).send({
          type: 'authentication_required',
          title: 'Authentication Required',
        });
      }

      const { requestId } = request.params as { requestId: string };

      try {
        await service.markAsUnprocessed(
          request.requestInterfaceUser.customerProfileId,
          requestId
        );

        return reply.send({ success: true });
      } catch (error) {
        if (error instanceof Error && error.message.includes('not found')) {
          return reply.code(404).send({
            type: 'resource_not_found',
            title: 'Request Not Found',
            detail: error.message,
          });
        }
        throw error;
      }
    }
  );

  // Bulk mark as processed
  server.post(
    '/request-interface/requests/bulk/process',
    {
      schema: {
        tags: ['request-interface'],
        summary: 'Bulk mark requests as processed',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['requestIds'],
          properties: {
            requestIds: {
              type: 'array',
              items: { type: 'string' },
              minItems: 1,
              maxItems: 100,
            },
          },
        },
        response: {
          200: {
            description: 'Requests processed',
            type: 'object',
            properties: {
              processedCount: { type: 'integer' },
            },
          },
        },
      },
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      if (!request.requestInterfaceUser) {
        return reply.code(401).send({
          type: 'authentication_required',
          title: 'Authentication Required',
        });
      }

      const { requestIds } = MarkProcessedSchema.parse(request.body);

      const result = await service.bulkMarkAsProcessed(
        request.requestInterfaceUser.customerProfileId,
        requestIds
      );

      return reply.send({ processedCount: result.count });
    }
  );

  // Delete request
  server.delete(
    '/request-interface/requests/:requestId',
    {
      schema: {
        tags: ['request-interface'],
        summary: 'Delete request',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          properties: {
            requestId: { type: 'string' },
          },
        },
        response: {
          204: { description: 'Request deleted' },
        },
      },
    },
    async (request, reply) => {
      if (!request.requestInterfaceUser) {
        return reply.code(401).send({
          type: 'authentication_required',
          title: 'Authentication Required',
        });
      }

      const { requestId } = request.params as { requestId: string };

      try {
        await service.deleteRequest(
          request.requestInterfaceUser.customerProfileId,
          requestId
        );

        return reply.code(204).send();
      } catch (error) {
        if (error instanceof Error && error.message.includes('not found')) {
          return reply.code(404).send({
            type: 'resource_not_found',
            title: 'Request Not Found',
            detail: error.message,
          });
        }
        throw error;
      }
    }
  );
};

export default requestInterfaceRoutes;
```

### 14.4 Request Interface Example Client

```typescript
// examples/request-interface-client.ts
// Example implementation for standalone request interface application

import axios, { AxiosInstance } from 'axios';

export interface RequestInterfaceConfig {
  apiUrl: string;
  apiKey: string;
}

export class RequestInterfaceClient {
  private client: AxiosInstance;

  constructor(config: RequestInterfaceConfig) {
    this.client = axios.create({
      baseURL: config.apiUrl,
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Get all venues
   */
  async getVenues() {
    const response = await this.client.get('/v1/request-interface/venues');
    return response.data.venues;
  }

  /**
   * Get pending requests for a venue
   */
  async getPendingRequests(venueId?: string) {
    const response = await this.client.get('/v1/request-interface/requests', {
      params: {
        venueId,
        processed: false,
        limit: 100,
      },
    });
    return response.data;
  }

  /**
   * Get request statistics
   */
  async getStats(venueId?: string) {
    const response = await this.client.get('/v1/request-interface/stats', {
      params: { venueId },
    });
    return response.data;
  }

  /**
   * Mark request as processed
   */
  async markAsProcessed(requestId: string) {
    const response = await this.client.patch(
      `/v1/request-interface/requests/${requestId}/process`
    );
    return response.data;
  }

  /**
   * Bulk mark requests as processed
   */
  async bulkMarkAsProcessed(requestIds: string[]) {
    const response = await this.client.post(
      '/v1/request-interface/requests/bulk/process',
      { requestIds }
    );
    return response.data;
  }

  /**
   * Delete request
   */
  async deleteRequest(requestId: string) {
    await this.client.delete(`/v1/request-interface/requests/${requestId}`);
  }

  /**
   * Search requests
   */
  async searchRequests(options: {
    venueId?: string;
    singerName?: string;
    songSearch?: string;
    processed?: boolean;
  }) {
    const response = await this.client.get('/v1/request-interface/requests', {
      params: options,
    });
    return response.data;
  }
}

// Usage example
async function example() {
  const client = new RequestInterfaceClient({
    apiUrl: 'https://api.singrkaraoke.com',
    apiKey: 'sk_live_xxxxxxxxxxxxx',
  });

  // Get venues
  const venues = await client.getVenues();
  console.log('Venues:', venues);

  // Get pending requests for first venue
  if (venues.length > 0) {
    const requests = await client.getPendingRequests(venues[0].id);
    console.log('Pending requests:', requests.requests);

    // Mark first request as processed
    if (requests.requests.length > 0) {
      await client.markAsProcessed(requests.requests[0].id);
      console.log('Request marked as processed');
    }
  }

  // Get statistics
  const stats = await client.getStats();
  console.log('Stats:', stats);
}
```

---
