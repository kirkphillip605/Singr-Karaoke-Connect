# Singr Central API Backend - Phase 10

**Document Version:** 1.0  
**Last Updated:** 2025-11-12  
**Author:** kirkphillip605  
**Status:** In Development

---

## Phase 10: Customer Request Management

### 10.1 Request Queue Management

**Objective:** Allow customers to view and manage incoming song requests in real-time.

**Tasks:**

1. **Create request management schemas in `apps/api/src/routes/customer/schemas.ts`:**
   ```typescript
   // Add to existing schemas
   export const RequestQueueQuerySchema = PaginationSchema.extend({
     venueId: z.string().uuid().optional(),
     processed: z.coerce.boolean().optional(),
     startDate: z.string().datetime().optional(),
     endDate: z.string().datetime().optional(),
     search: z.string().max(200).optional(),
   });

   export const RequestParamsSchema = z.object({
     id: z.coerce.number().int().positive(),
   });

   export const UpdateRequestSchema = z.object({
     processed: z.boolean().optional(),
     notes: z.string().max(500).optional(),
   });

   export const ProcessRequestSchema = z.object({
     processed: z.boolean(),
   });

   export const BulkProcessRequestsSchema = z.object({
     requestIds: z.array(z.number().int().positive()).min(1).max(100),
     processed: z.boolean(),
   });

   export const RequestResponseSchema = z.object({
     id: z.number(),
     venueId: z.string().uuid(),
     venueName: z.string(),
     artist: z.string(),
     title: z.string(),
     keyChange: z.number(),
     notes: z.string().nullable(),
     singerProfileId: z.string().uuid().nullable(),
     singerName: z.string().nullable(),
     submittedByUserId: z.string().uuid().nullable(),
     requestedAt: z.string().datetime(),
     processed: z.boolean(),
     processedAt: z.string().datetime().nullable(),
   });
   ```

2. **Create request management service in `packages/shared/src/services/customer-request-service.ts`:**
   ```typescript
   import { PrismaClient } from '@prisma/database';
   import { createLogger } from '@singr/observability';
   import { createCommunicationQueue } from '../queues/communication-queue';
   import { Redis } from 'ioredis';

   const logger = createLogger('services:customer-request');

   export interface RequestFilters {
     venueId?: string;
     processed?: boolean;
     startDate?: Date;
     endDate?: Date;
     search?: string;
   }

   export class CustomerRequestService {
     constructor(
       private prisma: PrismaClient,
       private redis: Redis
     ) {}

     async listRequests(
       customerProfileId: string,
       filters: RequestFilters,
       pagination: { page: number; limit: number }
     ) {
       const where: any = {
         venue: { customerProfileId },
       };

       if (filters.venueId) {
         where.venueId = filters.venueId;
       }

       if (filters.processed !== undefined) {
         where.processed = filters.processed;
       }

       if (filters.startDate) {
         where.requestedAt = { gte: filters.startDate };
       }

       if (filters.endDate) {
         where.requestedAt = {
           ...where.requestedAt,
           lte: filters.endDate,
         };
       }

       if (filters.search) {
         where.OR = [
           { artist: { contains: filters.search, mode: 'insensitive' } },
           { title: { contains: filters.search, mode: 'insensitive' } },
         ];
       }

       const [requests, total] = await Promise.all([
         this.prisma.request.findMany({
           where,
           skip: (pagination.page - 1) * pagination.limit,
           take: pagination.limit,
           orderBy: { requestedAt: 'desc' },
           include: {
             venue: {
               select: {
                 id: true,
                 name: true,
               },
             },
             singerProfile: {
               select: {
                 id: true,
                 nickname: true,
                 user: {
                   select: { name: true },
                 },
               },
             },
           },
         }),
         this.prisma.request.count({ where }),
       ]);

       return {
         data: requests.map((r) => ({
           id: Number(r.id),
           venueId: r.venueId,
           venueName: r.venue.name,
           artist: r.artist,
           title: r.title,
           keyChange: r.keyChange,
           notes: r.notes,
           singerProfileId: r.singerProfileId,
           singerName: r.singerProfile
             ? r.singerProfile.nickname || r.singerProfile.user.name
             : null,
           submittedByUserId: r.submittedByUserId,
           requestedAt: r.requestedAt.toISOString(),
           processed: r.processed,
           processedAt: r.processedAt?.toISOString() || null,
         })),
         pagination: {
           page: pagination.page,
           limit: pagination.limit,
           total,
           totalPages: Math.ceil(total / pagination.limit),
         },
       };
     }

     async getRequest(requestId: number, customerProfileId: string) {
       const request = await this.prisma.request.findFirst({
         where: {
           id: BigInt(requestId),
           venue: { customerProfileId },
         },
         include: {
           venue: {
             select: {
               id: true,
               name: true,
             },
           },
           singerProfile: {
             select: {
               id: true,
               nickname: true,
               user: {
                 select: { name: true, email: true },
               },
             },
           },
         },
       });

       if (!request) {
         throw new Error('Request not found');
       }

       return {
         id: Number(request.id),
         venueId: request.venueId,
         venueName: request.venue.name,
         artist: request.artist,
         title: request.title,
         keyChange: request.keyChange,
         notes: request.notes,
         singerProfileId: request.singerProfileId,
         singerName: request.singerProfile
           ? request.singerProfile.nickname || request.singerProfile.user.name
           : null,
         singerEmail: request.singerProfile?.user.email || null,
         submittedByUserId: request.submittedByUserId,
         requestedAt: request.requestedAt.toISOString(),
         processed: request.processed,
         processedAt: request.processedAt?.toISOString() || null,
       };
     }

     async processRequest(
       requestId: number,
       customerProfileId: string,
       processed: boolean
     ) {
       const request = await this.prisma.request.findFirst({
         where: {
           id: BigInt(requestId),
           venue: { customerProfileId },
         },
       });

       if (!request) {
         throw new Error('Request not found');
       }

       const updated = await this.prisma.request.update({
         where: { id: BigInt(requestId) },
         data: {
           processed,
           processedAt: processed ? new Date() : null,
         },
         include: {
           venue: {
             select: {
               id: true,
               name: true,
             },
           },
           singerProfile: {
             select: {
               id: true,
               nickname: true,
               user: {
                 select: { name: true },
               },
             },
           },
         },
       });

       logger.info(
         {
           requestId,
           customerProfileId,
           processed,
         },
         'Request processed'
       );

       return {
         id: Number(updated.id),
         venueId: updated.venueId,
         venueName: updated.venue.name,
         artist: updated.artist,
         title: updated.title,
         keyChange: updated.keyChange,
         notes: updated.notes,
         singerProfileId: updated.singerProfileId,
         singerName: updated.singerProfile
           ? updated.singerProfile.nickname || updated.singerProfile.user.name
           : null,
         submittedByUserId: updated.submittedByUserId,
         requestedAt: updated.requestedAt.toISOString(),
         processed: updated.processed,
         processedAt: updated.processedAt?.toISOString() || null,
       };
     }

     async bulkProcessRequests(
       requestIds: number[],
       customerProfileId: string,
       processed: boolean
     ) {
       // Verify all requests belong to customer
       const requests = await this.prisma.request.findMany({
         where: {
           id: { in: requestIds.map((id) => BigInt(id)) },
           venue: { customerProfileId },
         },
       });

       if (requests.length !== requestIds.length) {
         throw new Error('Some requests not found or access denied');
       }

       const result = await this.prisma.request.updateMany({
         where: {
           id: { in: requestIds.map((id) => BigInt(id)) },
         },
         data: {
           processed,
           processedAt: processed ? new Date() : null,
         },
       });

       logger.info(
         {
           customerProfileId,
           count: result.count,
           processed,
         },
         'Bulk requests processed'
       );

       return result.count;
     }

     async deleteRequest(requestId: number, customerProfileId: string) {
       const request = await this.prisma.request.findFirst({
         where: {
           id: BigInt(requestId),
           venue: { customerProfileId },
         },
       });

       if (!request) {
         throw new Error('Request not found');
       }

       await this.prisma.request.delete({
         where: { id: BigInt(requestId) },
       });

       logger.info(
         {
           requestId,
           customerProfileId,
         },
         'Request deleted'
       );
     }

     async bulkDeleteRequests(
       customerProfileId: string,
       venueId?: string,
       processed?: boolean
     ) {
       const where: any = {
         venue: { customerProfileId },
       };

       if (venueId) {
         where.venueId = venueId;
       }

       if (processed !== undefined) {
         where.processed = processed;
       }

       const result = await this.prisma.request.deleteMany({ where });

       logger.info(
         {
           customerProfileId,
           venueId,
           processed,
           count: result.count,
         },
         'Bulk requests deleted'
       );

       return result.count;
     }

     async getRequestStats(customerProfileId: string, venueId?: string) {
       const where: any = {
         venue: { customerProfileId },
       };

       if (venueId) {
         where.venueId = venueId;
       }

       const now = new Date();
       const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

       const [total, pending, processed, todayCount] = await Promise.all([
         this.prisma.request.count({ where }),
         this.prisma.request.count({
           where: { ...where, processed: false },
         }),
         this.prisma.request.count({
           where: { ...where, processed: true },
         }),
         this.prisma.request.count({
           where: {
             ...where,
             requestedAt: { gte: startOfToday },
           },
         }),
       ]);

       return {
         total,
         pending,
         processed,
         todayCount,
       };
     }

     async getRecentRequests(
       customerProfileId: string,
       venueId?: string,
       limit: number = 10
     ) {
       const where: any = {
         venue: { customerProfileId },
         processed: false,
       };

       if (venueId) {
         where.venueId = venueId;
       }

       const requests = await this.prisma.request.findMany({
         where,
         take: limit,
         orderBy: { requestedAt: 'desc' },
         include: {
           venue: {
             select: {
               id: true,
               name: true,
             },
           },
           singerProfile: {
             select: {
               id: true,
               nickname: true,
               user: {
                 select: { name: true },
               },
             },
           },
         },
       });

       return requests.map((r) => ({
         id: Number(r.id),
         venueId: r.venueId,
         venueName: r.venue.name,
         artist: r.artist,
         title: r.title,
         keyChange: r.keyChange,
         singerName: r.singerProfile
           ? r.singerProfile.nickname || r.singerProfile.user.name
           : 'Guest',
         requestedAt: r.requestedAt.toISOString(),
       }));
     }
   }
   ```

3. **Implement request management routes in `apps/api/src/routes/customer/requests.ts`:**
   ```typescript
   import { FastifyPluginAsync } from 'fastify';
   import { validateQuery, validateParams, validateBody } from '@singr/shared/validation';
   import { requirePermission } from '@singr/auth';
   import {
     RequestQueueQuerySchema,
     RequestParamsSchema,
     ProcessRequestSchema,
     BulkProcessRequestsSchema,
   } from './schemas';
   import { CustomerRequestService } from '@singr/shared/services/customer-request-service';
   import { createLogger } from '@singr/observability';

   const logger = createLogger('routes:customer:requests');

   export const requestsRoute: FastifyPluginAsync = async (server) => {
     const requestService = new CustomerRequestService(server.prisma, server.redis);

     // List requests
     server.get(
       '/requests',
       {
         schema: {
           tags: ['customer'],
           summary: 'List requests',
           description: 'Get all song requests for customer venues',
           security: [{ bearerAuth: [] }],
           querystring: {
             type: 'object',
             properties: {
               page: { type: 'integer', minimum: 1, default: 1 },
               limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
               venueId: { type: 'string', format: 'uuid' },
               processed: { type: 'boolean' },
               startDate: { type: 'string', format: 'date-time' },
               endDate: { type: 'string', format: 'date-time' },
               search: { type: 'string' },
             },
           },
           response: {
             200: {
               description: 'List of requests',
               type: 'object',
               properties: {
                 data: {
                   type: 'array',
                   items: {
                     type: 'object',
                     properties: {
                       id: { type: 'integer' },
                       venueId: { type: 'string', format: 'uuid' },
                       venueName: { type: 'string' },
                       artist: { type: 'string' },
                       title: { type: 'string' },
                       keyChange: { type: 'integer' },
                       singerName: { type: 'string' },
                       requestedAt: { type: 'string', format: 'date-time' },
                       processed: { type: 'boolean' },
                     },
                   },
                 },
                 pagination: {
                   type: 'object',
                   properties: {
                     page: { type: 'integer' },
                     limit: { type: 'integer' },
                     total: { type: 'integer' },
                     totalPages: { type: 'integer' },
                   },
                 },
               },
             },
           },
         },
         preHandler: [
           server.authenticate,
           requirePermission('requests:read'),
           validateQuery(RequestQueueQuerySchema),
         ],
       },
       async (request, reply) => {
         const query = request.query as z.infer<typeof RequestQueueQuerySchema>;
         const customerProfileId = request.user.activeContext?.id;

         if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
           return reply.code(403).send({
             type: 'authorization_denied',
             title: 'Customer Context Required',
             detail: 'You must be in a customer context to access this resource',
           });
         }

         const { page, limit, startDate, endDate, ...filters } = query;

         const result = await requestService.listRequests(
           customerProfileId,
           {
             ...filters,
             startDate: startDate ? new Date(startDate) : undefined,
             endDate: endDate ? new Date(endDate) : undefined,
           },
           { page, limit }
         );

         return reply.send(result);
       }
     );

     // Get request stats
     server.get(
       '/requests/stats',
       {
         schema: {
           tags: ['customer'],
           summary: 'Get request statistics',
           description: 'Get aggregate request statistics',
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
                 processed: { type: 'integer' },
                 todayCount: { type: 'integer' },
               },
             },
           },
         },
         preHandler: [server.authenticate, requirePermission('requests:read')],
       },
       async (request, reply) => {
         const { venueId } = request.query as { venueId?: string };
         const customerProfileId = request.user.activeContext?.id;

         if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
           return reply.code(403).send({
             type: 'authorization_denied',
             title: 'Customer Context Required',
             detail: 'You must be in a customer context to access this resource',
           });
         }

         const stats = await requestService.getRequestStats(customerProfileId, venueId);

         return reply.send(stats);
       }
     );

     // Get recent requests
     server.get(
       '/requests/recent',
       {
         schema: {
           tags: ['customer'],
           summary: 'Get recent requests',
           description: 'Get most recent pending requests',
           security: [{ bearerAuth: [] }],
           querystring: {
             type: 'object',
             properties: {
               venueId: { type: 'string', format: 'uuid' },
               limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
             },
           },
           response: {
             200: {
               description: 'Recent requests',
               type: 'array',
               items: {
                 type: 'object',
                 properties: {
                   id: { type: 'integer' },
                   venueId: { type: 'string', format: 'uuid' },
                   venueName: { type: 'string' },
                   artist: { type: 'string' },
                   title: { type: 'string' },
                   singerName: { type: 'string' },
                   requestedAt: { type: 'string', format: 'date-time' },
                 },
               },
             },
           },
         },
         preHandler: [server.authenticate, requirePermission('requests:read')],
       },
       async (request, reply) => {
         const { venueId, limit = 10 } = request.query as {
           venueId?: string;
           limit?: number;
         };
         const customerProfileId = request.user.activeContext?.id;

         if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
           return reply.code(403).send({
             type: 'authorization_denied',
             title: 'Customer Context Required',
             detail: 'You must be in a customer context to access this resource',
           });
         }

         const requests = await requestService.getRecentRequests(
           customerProfileId,
           venueId,
           limit
         );

         return reply.send(requests);
       }
     );

     // Get request details
     server.get(
       '/requests/:id',
       {
         schema: {
           tags: ['customer'],
           summary: 'Get request',
           description: 'Get details of a specific request',
           security: [{ bearerAuth: [] }],
           params: {
             type: 'object',
             properties: {
               id: { type: 'integer' },
             },
           },
           response: {
             200: {
               description: 'Request details',
               type: 'object',
               properties: {
                 id: { type: 'integer' },
                 venueId: { type: 'string', format: 'uuid' },
                 venueName: { type: 'string' },
                 artist: { type: 'string' },
                 title: { type: 'string' },
                 keyChange: { type: 'integer' },
                 notes: { type: 'string' },
                 singerName: { type: 'string' },
                 singerEmail: { type: 'string' },
                 requestedAt: { type: 'string', format: 'date-time' },
                 processed: { type: 'boolean' },
                 processedAt: { type: 'string', format: 'date-time' },
               },
             },
             404: {
               description: 'Request not found',
             },
           },
         },
         preHandler: [
           server.authenticate,
           requirePermission('requests:read'),
           validateParams(RequestParamsSchema),
         ],
       },
       async (request, reply) => {
         const { id } = request.params as z.infer<typeof RequestParamsSchema>;
         const customerProfileId = request.user.activeContext?.id;

         if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
           return reply.code(403).send({
             type: 'authorization_denied',
             title: 'Customer Context Required',
             detail: 'You must be in a customer context to access this resource',
           });
         }

         try {
           const requestData = await requestService.getRequest(id, customerProfileId);
           return reply.send(requestData);
         } catch (error) {
           if (error instanceof Error && error.message.includes('not found')) {
             return reply.code(404).send({
               type: 'resource_not_found',
               title: 'Request Not Found',
               detail: 'Request not found or access denied',
             });
           }
           throw error;
         }
       }
     );

   };

     // Process/unprocess single request
     server.patch(
       '/requests/:id/process',
       {
         schema: {
           tags: ['customer'],
           summary: 'Process request',
           description: 'Mark request as processed or unprocessed',
           security: [{ bearerAuth: [] }],
           params: {
             type: 'object',
             properties: {
               id: { type: 'integer' },
             },
           },
           body: {
             type: 'object',
             required: ['processed'],
             properties: {
               processed: { type: 'boolean' },
             },
           },
           response: {
             200: {
               description: 'Request processed',
               type: 'object',
               properties: {
                 id: { type: 'integer' },
                 processed: { type: 'boolean' },
                 processedAt: { type: 'string', format: 'date-time' },
               },
             },
             404: {
               description: 'Request not found',
             },
           },
         },
         preHandler: [
           server.authenticate,
           requirePermission('requests:process'),
           validateParams(RequestParamsSchema),
           validateBody(ProcessRequestSchema),
         ],
       },
       async (request, reply) => {
         const { id } = request.params as z.infer<typeof RequestParamsSchema>;
         const { processed } = request.body as z.infer<typeof ProcessRequestSchema>;
         const customerProfileId = request.user.activeContext?.id;

         if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
           return reply.code(403).send({
             type: 'authorization_denied',
             title: 'Customer Context Required',
             detail: 'You must be in a customer context to process requests',
           });
         }

         try {
           const result = await requestService.processRequest(
             id,
             customerProfileId,
             processed
           );
           return reply.send(result);
         } catch (error) {
           if (error instanceof Error && error.message.includes('not found')) {
             return reply.code(404).send({
               type: 'resource_not_found',
               title: 'Request Not Found',
               detail: 'Request not found or access denied',
             });
           }
           throw error;
         }
       }
     );

     // Bulk process requests
     server.post(
       '/requests/bulk/process',
       {
         schema: {
           tags: ['customer'],
           summary: 'Bulk process requests',
           description: 'Mark multiple requests as processed or unprocessed',
           security: [{ bearerAuth: [] }],
           body: {
             type: 'object',
             required: ['requestIds', 'processed'],
             properties: {
               requestIds: {
                 type: 'array',
                 minItems: 1,
                 maxItems: 100,
                 items: { type: 'integer' },
               },
               processed: { type: 'boolean' },
             },
           },
           response: {
             200: {
               description: 'Requests processed',
               type: 'object',
               properties: {
                 updatedCount: { type: 'integer' },
               },
             },
             400: {
               description: 'Some requests not found',
             },
           },
         },
         preHandler: [
           server.authenticate,
           requirePermission('requests:process'),
           validateBody(BulkProcessRequestsSchema),
         ],
       },
       async (request, reply) => {
         const { requestIds, processed } = request.body as z.infer<
           typeof BulkProcessRequestsSchema
         >;
         const customerProfileId = request.user.activeContext?.id;

         if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
           return reply.code(403).send({
             type: 'authorization_denied',
             title: 'Customer Context Required',
             detail: 'You must be in a customer context to process requests',
           });
         }

         try {
           const count = await requestService.bulkProcessRequests(
             requestIds,
             customerProfileId,
             processed
           );

           return reply.send({ updatedCount: count });
         } catch (error) {
           if (error instanceof Error && error.message.includes('not found')) {
             return reply.code(400).send({
               type: 'invalid_request',
               title: 'Invalid Request',
               detail: error.message,
             });
           }
           throw error;
         }
       }
     );

     // Delete single request
     server.delete(
       '/requests/:id',
       {
         schema: {
           tags: ['customer'],
           summary: 'Delete request',
           description: 'Delete a specific request',
           security: [{ bearerAuth: [] }],
           params: {
             type: 'object',
             properties: {
               id: { type: 'integer' },
             },
           },
           response: {
             204: {
               description: 'Request deleted',
             },
             404: {
               description: 'Request not found',
             },
           },
         },
         preHandler: [
           server.authenticate,
           requirePermission('requests:process'),
           validateParams(RequestParamsSchema),
         ],
       },
       async (request, reply) => {
         const { id } = request.params as z.infer<typeof RequestParamsSchema>;
         const customerProfileId = request.user.activeContext?.id;

         if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
           return reply.code(403).send({
             type: 'authorization_denied',
             title: 'Customer Context Required',
             detail: 'You must be in a customer context to delete requests',
           });
         }

         try {
           await requestService.deleteRequest(id, customerProfileId);
           return reply.code(204).send();
         } catch (error) {
           if (error instanceof Error && error.message.includes('not found')) {
             return reply.code(404).send({
               type: 'resource_not_found',
               title: 'Request Not Found',
               detail: 'Request not found or access denied',
             });
           }
           throw error;
         }
       }
     );

     // Bulk delete requests
     server.delete(
       '/requests',
       {
         schema: {
           tags: ['customer'],
           summary: 'Bulk delete requests',
           description: 'Delete all requests or filtered set',
           security: [{ bearerAuth: [] }],
           querystring: {
             type: 'object',
             properties: {
               venueId: { type: 'string', format: 'uuid' },
               processed: { type: 'boolean' },
             },
           },
           response: {
             200: {
               description: 'Requests deleted',
               type: 'object',
               properties: {
                 deletedCount: { type: 'integer' },
               },
             },
           },
         },
         preHandler: [
           server.authenticate,
           requirePermission('requests:process'),
           validateQuery(
             z.object({
               venueId: z.string().uuid().optional(),
               processed: z.coerce.boolean().optional(),
             })
           ),
         ],
         config: {
           rateLimit: {
             max: 5,
             timeWindow: '1 hour',
           },
         },
       },
       async (request, reply) => {
         const { venueId, processed } = request.query as {
           venueId?: string;
           processed?: boolean;
         };
         const customerProfileId = request.user.activeContext?.id;

         if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
           return reply.code(403).send({
             type: 'authorization_denied',
             title: 'Customer Context Required',
             detail: 'You must be in a customer context to delete requests',
           });
         }

         const deletedCount = await requestService.bulkDeleteRequests(
           customerProfileId,
           venueId,
           processed
         );

         return reply.send({ deletedCount });
       }
     );
   };
   ```

4. **Register requests route in `apps/api/src/routes/customer/index.ts`:**
   ```typescript
   import { FastifyPluginAsync } from 'fastify';
   import { venuesRoute } from './venues';
   import { systemsRoute } from './systems';
   import { songdbRoute } from './songdb';
   import { requestsRoute } from './requests';

   export const customerRoutes: FastifyPluginAsync = async (server) => {
     await server.register(venuesRoute);
     await server.register(systemsRoute);
     await server.register(songdbRoute);
     await server.register(requestsRoute);
   };
   ```

**Deliverables:**
- ✅ `GET /v1/customer/requests` - List all requests with filters
- ✅ `GET /v1/customer/requests/stats` - Get request statistics
- ✅ `GET /v1/customer/requests/recent` - Get recent pending requests
- ✅ `GET /v1/customer/requests/:id` - Get request details
- ✅ `PATCH /v1/customer/requests/:id/process` - Mark as processed/unprocessed
- ✅ `POST /v1/customer/requests/bulk/process` - Bulk process (max 100)
- ✅ `DELETE /v1/customer/requests/:id` - Delete single request
- ✅ `DELETE /v1/customer/requests` - Bulk delete by filters
- ✅ Filter by venue, processed status, date range, search
- ✅ Singer information included
- ✅ Request statistics (total, pending, processed, today)
- ✅ RBAC permission checks (requests:read, requests:process)
- ✅ Customer context validation
- ✅ Pagination support
- ✅ Rate limiting on bulk operations

---

### 10.2 Real-Time Request Notifications

**Objective:** Implement WebSocket connections for real-time request updates.

**Duration:** 2-3 days  
**Team Size:** 1 developer

**Tasks:**

1. **Install WebSocket dependencies:**
   ```bash
   pnpm add @fastify/websocket ws
   pnpm add -D @types/ws
   ```

2. **Create WebSocket authentication middleware in `packages/auth/src/websocket-auth.ts`:**
   ```typescript
   import { FastifyRequest } from 'fastify';
   import { verifyToken } from './jwt';
   import { createLogger } from '@singr/observability';

   const logger = createLogger('auth:websocket');

   export interface WebSocketUser {
     sub: string;
     email: string;
     roles: string[];
     activeContext?: {
       type: 'customer' | 'singer';
       id: string;
     };
   }

   export async function authenticateWebSocket(
     request: FastifyRequest
   ): Promise<WebSocketUser | null> {
     try {
       // Get token from query parameter
       const token = request.query?.token as string;

       if (!token) {
         logger.warn('WebSocket connection attempted without token');
         return null;
       }

       // Verify JWT
       const payload = await verifyToken(token);

       if (!payload) {
         logger.warn('WebSocket connection attempted with invalid token');
         return null;
       }

       return {
         sub: payload.sub,
         email: payload.email,
         roles: payload.roles || [],
         activeContext: payload.activeContext,
       };
     } catch (error) {
       logger.error({ error }, 'WebSocket authentication error');
       return null;
     }
   }
   ```

3. **Create WebSocket manager in `packages/shared/src/services/websocket-manager.ts`:**
   ```typescript
   import { WebSocket } from 'ws';
   import { createLogger } from '@singr/observability';
   import { Redis } from 'ioredis';

   const logger = createLogger('services:websocket-manager');

   export interface WebSocketClient {
     id: string;
     socket: WebSocket;
     userId: string;
     customerProfileId?: string;
     venueIds: Set<string>;
   }

   export class WebSocketManager {
     private clients: Map<string, WebSocketClient> = new Map();
     private customerClients: Map<string, Set<string>> = new Map();
     private venueClients: Map<string, Set<string>> = new Map();

     constructor(private redis: Redis) {
       this.setupRedisSubscription();
     }

     private setupRedisSubscription() {
       const subscriber = this.redis.duplicate();

       subscriber.subscribe('requests:new', 'requests:update', (err) => {
         if (err) {
           logger.error({ error: err }, 'Redis subscription error');
         } else {
           logger.info('Subscribed to Redis request channels');
         }
       });

       subscriber.on('message', (channel, message) => {
         try {
           const data = JSON.parse(message);

           if (channel === 'requests:new') {
             this.broadcastNewRequest(data);
           } else if (channel === 'requests:update') {
             this.broadcastRequestUpdate(data);
           }
         } catch (error) {
           logger.error({ error, channel }, 'Error processing Redis message');
         }
       });
     }

     addClient(
       clientId: string,
       socket: WebSocket,
       userId: string,
       customerProfileId?: string,
       venueIds?: string[]
     ) {
       const client: WebSocketClient = {
         id: clientId,
         socket,
         userId,
         customerProfileId,
         venueIds: new Set(venueIds || []),
       };

       this.clients.set(clientId, client);

       if (customerProfileId) {
         if (!this.customerClients.has(customerProfileId)) {
           this.customerClients.set(customerProfileId, new Set());
         }
         this.customerClients.get(customerProfileId)!.add(clientId);
       }

       if (venueIds) {
         venueIds.forEach((venueId) => {
           if (!this.venueClients.has(venueId)) {
             this.venueClients.set(venueId, new Set());
           }
           this.venueClients.get(venueId)!.add(clientId);
         });
       }

       logger.info(
         {
           clientId,
           userId,
           customerProfileId,
           venueCount: venueIds?.length || 0,
         },
         'WebSocket client connected'
       );
     }

     removeClient(clientId: string) {
       const client = this.clients.get(clientId);

       if (client) {
         if (client.customerProfileId) {
           this.customerClients.get(client.customerProfileId)?.delete(clientId);
         }

         client.venueIds.forEach((venueId) => {
           this.venueClients.get(venueId)?.delete(clientId);
         });

         this.clients.delete(clientId);

         logger.info({ clientId, userId: client.userId }, 'WebSocket client disconnected');
       }
     }

     private broadcastNewRequest(data: {
       requestId: number;
       venueId: string;
       customerProfileId: string;
       artist: string;
       title: string;
       singerName?: string;
       requestedAt: string;
     }) {
       const message = JSON.stringify({
         type: 'request:new',
         data,
       });

       // Send to all clients for this venue
       const venueClients = this.venueClients.get(data.venueId);
       if (venueClients) {
         venueClients.forEach((clientId) => {
           const client = this.clients.get(clientId);
           if (client && client.socket.readyState === WebSocket.OPEN) {
             client.socket.send(message);
           }
         });
       }

       // Send to all clients for this customer profile
       const customerClients = this.customerClients.get(data.customerProfileId);
       if (customerClients) {
         customerClients.forEach((clientId) => {
           const client = this.clients.get(clientId);
           if (client && client.socket.readyState === WebSocket.OPEN) {
             client.socket.send(message);
           }
         });
       }

       logger.debug(
         {
           requestId: data.requestId,
           venueId: data.venueId,
           clientCount: (venueClients?.size || 0) + (customerClients?.size || 0),
         },
         'Broadcasted new request'
       );
     }

     private broadcastRequestUpdate(data: {
       requestId: number;
       venueId: string;
       customerProfileId: string;
       processed: boolean;
       processedAt?: string;
     }) {
       const message = JSON.stringify({
         type: 'request:update',
         data,
       });

       // Send to venue and customer clients
       const venueClients = this.venueClients.get(data.venueId);
       const customerClients = this.customerClients.get(data.customerProfileId);

       const allClients = new Set([
         ...(venueClients || []),
         ...(customerClients || []),
       ]);

       allClients.forEach((clientId) => {
         const client = this.clients.get(clientId);
         if (client && client.socket.readyState === WebSocket.OPEN) {
           client.socket.send(message);
         }
       });

       logger.debug(
         {
           requestId: data.requestId,
           processed: data.processed,
           clientCount: allClients.size,
         },
         'Broadcasted request update'
       );
     }

     sendToClient(clientId: string, message: any) {
       const client = this.clients.get(clientId);
       if (client && client.socket.readyState === WebSocket.OPEN) {
         client.socket.send(JSON.stringify(message));
       }
     }

     getClientCount(): number {
       return this.clients.size;
     }

     getCustomerClientCount(customerProfileId: string): number {
       return this.customerClients.get(customerProfileId)?.size || 0;
     }
   }
   ```

4. **Update request service to publish events:**
   ```typescript
   // Add to packages/shared/src/services/customer-request-service.ts
   // In createRequest method (or wherever requests are created):

   async notifyNewRequest(request: {
     id: number;
     venueId: string;
     customerProfileId: string;
     artist: string;
     title: string;
     singerName?: string;
     requestedAt: string;
   }) {
     await this.redis.publish(
       'requests:new',
       JSON.stringify({
         requestId: request.id,
         venueId: request.venueId,
         customerProfileId: request.customerProfileId,
         artist: request.artist,
         title: request.title,
         singerName: request.singerName || 'Guest',
         requestedAt: request.requestedAt,
       })
     );
   }

   // In processRequest method:
   async notifyRequestUpdate(request: {
     id: number;
     venueId: string;
     customerProfileId: string;
     processed: boolean;
     processedAt?: string;
   }) {
     await this.redis.publish(
       'requests:update',
       JSON.stringify({
         requestId: request.id,
         venueId: request.venueId,
         customerProfileId: request.customerProfileId,
         processed: request.processed,
         processedAt: request.processedAt,
       })
     );
   }
   ```

5. **Update RequestService to trigger notifications:**
   ```typescript
   // Update packages/shared/src/services/request-service.ts
   // In createRequest method after creating request:

   // Notify via Redis for WebSocket broadcast
   const venue = await this.prisma.venue.findUnique({
     where: { id: input.venueId },
     select: { customerProfileId: true },
   });

   if (venue) {
     await this.redis.publish(
       'requests:new',
       JSON.stringify({
         requestId: Number(request.id),
         venueId: request.venueId,
         customerProfileId: venue.customerProfileId,
         artist: request.artist,
         title: request.title,
         singerName: input.singerProfileId ? 'Singer' : 'Guest',
         requestedAt: request.requestedAt.toISOString(),
       })
     );
   }
   ```

6. **Implement WebSocket route in `apps/api/src/routes/customer/websocket.ts`:**
   ```typescript
   import { FastifyPluginAsync } from 'fastify';
   import { authenticateWebSocket } from '@singr/auth/websocket-auth';
   import { WebSocketManager } from '@singr/shared/services/websocket-manager';
   import { randomUUID } from 'crypto';
   import { createLogger } from '@singr/observability';

   const logger = createLogger('routes:customer:websocket');

   export const websocketRoute: FastifyPluginAsync = async (server) => {
     const wsManager = new WebSocketManager(server.redis);

     server.get(
       '/ws',
       {
         websocket: true,
         schema: {
           tags: ['customer'],
           summary: 'WebSocket connection',
           description: 'Real-time updates for song requests',
           querystring: {
             type: 'object',
             required: ['token'],
             properties: {
               token: { type: 'string', description: 'JWT access token' },
             },
           },
         },
       },
       async (connection, request) => {
         const user = await authenticateWebSocket(request);

         if (!user) {
           connection.socket.close(1008, 'Unauthorized');
           return;
         }

         if (user.activeContext?.type !== 'customer') {
           connection.socket.close(1008, 'Customer context required');
           return;
         }

         const clientId = randomUUID();

         // Get venue IDs for this customer
         const venues = await server.prisma.venue.findMany({
           where: { customerProfileId: user.activeContext.id },
           select: { id: true },
         });

         const venueIds = venues.map((v) => v.id);

         wsManager.addClient(
           clientId,
           connection.socket,
           user.sub,
           user.activeContext.id,
           venueIds
         );

         // Send welcome message
         connection.socket.send(
           JSON.stringify({
             type: 'connected',
             data: {
               clientId,
               venueCount: venueIds.length,
             },
           })
         );

         // Handle ping/pong for keep-alive
         const pingInterval = setInterval(() => {
           if (connection.socket.readyState === 1) {
             connection.socket.ping();
           }
         }, 30000);

         connection.socket.on('pong', () => {
           logger.debug({ clientId }, 'Pong received');
         });

         connection.socket.on('message', (message) => {
           try {
             const data = JSON.parse(message.toString());

             if (data.type === 'ping') {
               connection.socket.send(
                 JSON.stringify({
                   type: 'pong',
                   timestamp: new Date().toISOString(),
                 })
               );
             }
           } catch (error) {
             logger.error({ error, clientId }, 'Error processing WebSocket message');
           }
         });

         connection.socket.on('close', () => {
           clearInterval(pingInterval);
           wsManager.removeClient(clientId);
         });

         connection.socket.on('error', (error) => {
           logger.error({ error, clientId }, 'WebSocket error');
           clearInterval(pingInterval);
           wsManager.removeClient(clientId);
         });
       }
     );

     // Health check endpoint
     server.get(
       '/ws/stats',
       {
         schema: {
           tags: ['customer'],
           summary: 'WebSocket statistics',
           description: 'Get WebSocket connection statistics',
           security: [{ bearerAuth: [] }],
           response: {
             200: {
               description: 'WebSocket stats',
               type: 'object',
               properties: {
                 totalConnections: { type: 'integer' },
                 customerConnections: { type: 'integer' },
               },
             },
           },
         },
         preHandler: [server.authenticate],
       },
       async (request, reply) => {
         const customerProfileId = request.user.activeContext?.id;

         return reply.send({
           totalConnections: wsManager.getClientCount(),
           customerConnections: customerProfileId
             ? wsManager.getCustomerClientCount(customerProfileId)
             : 0,
         });
       }
     );
   };
   ```

7. **Register WebSocket in server setup:**
   ```typescript
   // Update apps/api/src/server.ts
   import websocket from '@fastify/websocket';

   export async function buildServer(): Promise<FastifyInstance> {
     const server = Fastify({
       // ... existing config
     });

     // ... existing plugins

     // Register WebSocket support
     await server.register(websocket);

     // ... rest of server setup

     return server;
   }
   ```

8. **Update customer routes to include WebSocket:**
   ```typescript
   // Update apps/api/src/routes/customer/index.ts
   import { FastifyPluginAsync } from 'fastify';
   import { venuesRoute } from './venues';
   import { systemsRoute } from './systems';
   import { songdbRoute } from './songdb';
   import { requestsRoute } from './requests';
   import { websocketRoute } from './websocket';

   export const customerRoutes: FastifyPluginAsync = async (server) => {
     await server.register(venuesRoute);
     await server.register(systemsRoute);
     await server.register(songdbRoute);
     await server.register(requestsRoute);
     await server.register(websocketRoute);
   };
   ```

**Deliverables:**
- ✅ WebSocket connection endpoint at `/v1/customer/ws`
- ✅ JWT authentication via query parameter
- ✅ Real-time new request notifications
- ✅ Real-time request update notifications
- ✅ Redis pub/sub for message distribution
- ✅ Connection management (add/remove clients)
- ✅ Automatic venue subscription based on customer profile
- ✅ Ping/pong keep-alive mechanism
- ✅ WebSocket statistics endpoint
- ✅ Customer context validation
- ✅ Graceful connection cleanup
- ✅ Error handling and logging

---
