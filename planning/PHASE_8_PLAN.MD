# Singr Central API Backend - Phase 8

**Document Version:** 1.0  
**Last Updated:** 2025-11-12  
**Author:** kirkphillip605  
**Status:** In Development

---

## Phase 8: Customer Venue Management

### 8.1 Venue CRUD Operations

**Objective:** Allow customers to create, view, update, and delete their venues.

**Tasks:**

1. **Create venue schemas in `apps/api/src/routes/customer/schemas.ts`:**
   ```typescript
   import { z } from 'zod';
   import { PaginationSchema, AddressSchema, PhoneNumberSchema, WebsiteSchema } from '@singr/shared/validation';

   export const VenueListQuerySchema = PaginationSchema.extend({
     search: z.string().max(100).optional(),
     acceptingRequests: z.coerce.boolean().optional(),
   });

   export const CreateVenueSchema = AddressSchema.extend({
     name: z.string().min(1).max(255),
     phoneNumber: PhoneNumberSchema,
     website: WebsiteSchema,
     acceptingRequests: z.boolean().default(true),
   });

   export const UpdateVenueSchema = z.object({
     name: z.string().min(1).max(255).optional(),
     address: z.string().min(1).max(255).optional(),
     city: z.string().min(1).max(100).optional(),
     state: z.string().min(2).max(50).optional(),
     postalCode: z.string().min(1).max(20).optional(),
     country: z.string().max(50).optional(),
     phoneNumber: PhoneNumberSchema.optional(),
     website: WebsiteSchema.optional(),
     acceptingRequests: z.boolean().optional(),
   });

   export const VenueParamsSchema = z.object({
     id: z.string().uuid(),
   });

   export const VenueResponseSchema = z.object({
     id: z.string().uuid(),
     openkjVenueId: z.number(),
     urlName: z.string(),
     name: z.string(),
     address: z.string(),
     city: z.string(),
     state: z.string(),
     postalCode: z.string(),
     country: z.string().nullable(),
     phoneNumber: z.string().nullable(),
     website: z.string().nullable(),
     acceptingRequests: z.boolean(),
     createdAt: z.string().datetime(),
     updatedAt: z.string().datetime(),
   });
   ```

2. **Create venue service in `packages/shared/src/services/customer-venue-service.ts`:**
   ```typescript
   import { PrismaClient } from '@prisma/database';
   import { createLogger } from '@singr/observability';
   import axios from 'axios';

   const logger = createLogger('services:customer-venue');

   export interface VenueFilters {
     search?: string;
     acceptingRequests?: boolean;
   }

   export interface CreateVenueInput {
     customerProfileId: string;
     name: string;
     address: string;
     city: string;
     state: string;
     postalCode: string;
     country?: string;
     phoneNumber?: string;
     website?: string;
     acceptingRequests?: boolean;
   }

   export interface UpdateVenueInput {
     name?: string;
     address?: string;
     city?: string;
     state?: string;
     postalCode?: string;
     country?: string;
     phoneNumber?: string;
     website?: string;
     acceptingRequests?: boolean;
   }

   export class CustomerVenueService {
     constructor(private prisma: PrismaClient) {}

     async listVenues(
       customerProfileId: string,
       filters: VenueFilters,
       pagination: { page: number; limit: number }
     ) {
       const where: any = { customerProfileId };

       if (filters.search) {
         where.name = { contains: filters.search, mode: 'insensitive' };
       }

       if (filters.acceptingRequests !== undefined) {
         where.acceptingRequests = filters.acceptingRequests;
       }

       const [venues, total] = await Promise.all([
         this.prisma.venue.findMany({
           where,
           skip: (pagination.page - 1) * pagination.limit,
           take: pagination.limit,
           orderBy: { name: 'asc' },
         }),
         this.prisma.venue.count({ where }),
       ]);

       return {
         data: venues.map(this.formatVenue),
         pagination: {
           page: pagination.page,
           limit: pagination.limit,
           total,
           totalPages: Math.ceil(total / pagination.limit),
         },
       };
     }

     async getVenue(venueId: string, customerProfileId: string) {
       const venue = await this.prisma.venue.findFirst({
         where: {
           id: venueId,
           customerProfileId,
         },
       });

       if (!venue) {
         throw new Error('Venue not found');
       }

       return this.formatVenue(venue);
     }

     async createVenue(input: CreateVenueInput) {
       // Get next openkjVenueId from state table
       const state = await this.prisma.state.upsert({
         where: { customerProfileId: input.customerProfileId },
         create: {
           customerProfileId: input.customerProfileId,
           serial: BigInt(1001),
         },
         update: {
           serial: { increment: BigInt(1) },
         },
       });

       const openkjVenueId = Number(state.serial);

       // Generate URL-friendly name
       const urlName = this.generateUrlName(input.name);

       // Geocode address to get coordinates
       const location = await this.geocodeAddress(
         `${input.address}, ${input.city}, ${input.state} ${input.postalCode}`
       );

       // Create venue with raw SQL for PostGIS geography type
       const venue = await this.prisma.$queryRaw<any[]>`
         INSERT INTO venues (
           venues_id,
           customer_profiles_id,
           openkj_venue_id,
           url_name,
           accepting_requests,
           name,
           address,
           city,
           state,
           postal_code,
           country,
           phone_number,
           website,
           location,
           created_at,
           updated_at
         ) VALUES (
           gen_random_uuid(),
           ${input.customerProfileId}::uuid,
           ${openkjVenueId},
           ${urlName},
           ${input.acceptingRequests !== false},
           ${input.name},
           ${input.address},
           ${input.city},
           ${input.state},
           ${input.postalCode},
           ${input.country || 'USA'},
           ${input.phoneNumber || null},
           ${input.website || null},
           ${location ? `ST_SetSRID(ST_MakePoint(${location.lng}, ${location.lat}), 4326)::geography` : null},
           NOW(),
           NOW()
         )
         RETURNING *
       `;

       logger.info(
         {
           venueId: venue[0].venues_id,
           customerProfileId: input.customerProfileId,
           openkjVenueId,
           name: input.name,
         },
         'Venue created'
       );

       return this.formatVenue(venue[0]);
     }

     async updateVenue(
       venueId: string,
       customerProfileId: string,
       input: UpdateVenueInput
     ) {
       const venue = await this.prisma.venue.findFirst({
         where: {
           id: venueId,
           customerProfileId,
         },
       });

       if (!venue) {
         throw new Error('Venue not found');
       }

       const updateData: any = {};

       if (input.name !== undefined) updateData.name = input.name;
       if (input.address !== undefined) updateData.address = input.address;
       if (input.city !== undefined) updateData.city = input.city;
       if (input.state !== undefined) updateData.state = input.state;
       if (input.postalCode !== undefined) updateData.postalCode = input.postalCode;
       if (input.country !== undefined) updateData.country = input.country;
       if (input.phoneNumber !== undefined) updateData.phoneNumber = input.phoneNumber;
       if (input.website !== undefined) updateData.website = input.website;
       if (input.acceptingRequests !== undefined) {
         updateData.acceptingRequests = input.acceptingRequests;
       }

       // If address changed, update location
       if (input.address || input.city || input.state || input.postalCode) {
         const fullAddress = `${input.address || venue.address}, ${
           input.city || venue.city
         }, ${input.state || venue.state} ${input.postalCode || venue.postalCode}`;

         const location = await this.geocodeAddress(fullAddress);

         if (location) {
           await this.prisma.$executeRaw`
             UPDATE venues
             SET location = ST_SetSRID(ST_MakePoint(${location.lng}, ${location.lat}), 4326)::geography
             WHERE venues_id = ${venueId}::uuid
           `;
         }
       }

       const updated = await this.prisma.venue.update({
         where: { id: venueId },
         data: updateData,
       });

       logger.info(
         {
           venueId,
           customerProfileId,
         },
         'Venue updated'
       );

       return this.formatVenue(updated);
     }

     async deleteVenue(venueId: string, customerProfileId: string) {
       const venue = await this.prisma.venue.findFirst({
         where: {
           id: venueId,
           customerProfileId,
         },
       });

       if (!venue) {
         throw new Error('Venue not found');
       }

       await this.prisma.venue.delete({
         where: { id: venueId },
       });

       logger.info(
         {
           venueId,
           customerProfileId,
           name: venue.name,
         },
         'Venue deleted'
       );
     }

     private generateUrlName(name: string): string {
       return name
         .toLowerCase()
         .replace(/[^a-z0-9]+/g, '-')
         .replace(/^-+|-+$/g, '')
         .substring(0, 100);
     }

     private async geocodeAddress(
       address: string
     ): Promise<{ lat: number; lng: number } | null> {
       try {
         // Using a free geocoding service (nominatim)
         const response = await axios.get(
           'https://nominatim.openstreetmap.org/search',
           {
             params: {
               q: address,
               format: 'json',
               limit: 1,
             },
             headers: {
               'User-Agent': 'Singr-API/1.0',
             },
           }
         );

         if (response.data && response.data.length > 0) {
           return {
             lat: parseFloat(response.data[0].lat),
             lng: parseFloat(response.data[0].lon),
           };
         }

         logger.warn({ address }, 'Geocoding failed - no results');
         return null;
       } catch (error) {
         logger.error({ error, address }, 'Geocoding error');
         return null;
       }
     }

     private formatVenue(venue: any) {
       return {
         id: venue.id || venue.venues_id,
         openkjVenueId: Number(venue.openkjVenueId || venue.openkj_venue_id),
         urlName: venue.urlName || venue.url_name,
         name: venue.name,
         address: venue.address,
         city: venue.city,
         state: venue.state,
         postalCode: venue.postalCode || venue.postal_code,
         country: venue.country,
         phoneNumber: venue.phoneNumber || venue.phone_number,
         website: venue.website,
         acceptingRequests: venue.acceptingRequests ?? venue.accepting_requests,
         createdAt: (venue.createdAt || venue.created_at).toISOString
           ? (venue.createdAt || venue.created_at).toISOString()
           : new Date(venue.createdAt || venue.created_at).toISOString(),
         updatedAt: (venue.updatedAt || venue.updated_at).toISOString
           ? (venue.updatedAt || venue.updated_at).toISOString()
           : new Date(venue.updatedAt || venue.updated_at).toISOString(),
       };
     }
   }
   ```

3. **Implement venue routes in `apps/api/src/routes/customer/venues.ts`:**
   ```typescript
   import { FastifyPluginAsync } from 'fastify';
   import { validateQuery, validateParams, validateBody } from '@singr/shared/validation';
   import { requirePermission } from '@singr/auth';
   import {
     VenueListQuerySchema,
     CreateVenueSchema,
     UpdateVenueSchema,
     VenueParamsSchema,
   } from './schemas';
   import { CustomerVenueService } from '@singr/shared/services/customer-venue-service';
   import { createLogger } from '@singr/observability';

   const logger = createLogger('routes:customer:venues');

   export const venuesRoute: FastifyPluginAsync = async (server) => {
     const venueService = new CustomerVenueService(server.prisma);

     // List venues
     server.get(
       '/venues',
       {
         schema: {
           tags: ['customer'],
           summary: 'List venues',
           description: 'Get all venues for the customer',
           security: [{ bearerAuth: [] }],
           querystring: {
             type: 'object',
             properties: {
               page: { type: 'integer', minimum: 1, default: 1 },
               limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
               search: { type: 'string' },
               acceptingRequests: { type: 'boolean' },
             },
           },
           response: {
             200: {
               description: 'List of venues',
               type: 'object',
               properties: {
                 data: {
                   type: 'array',
                   items: {
                     type: 'object',
                     properties: {
                       id: { type: 'string', format: 'uuid' },
                       name: { type: 'string' },
                       city: { type: 'string' },
                       state: { type: 'string' },
                       acceptingRequests: { type: 'boolean' },
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
           requirePermission('venues:read'),
           validateQuery(VenueListQuerySchema),
         ],
       },
       async (request, reply) => {
         const query = request.query as z.infer<typeof VenueListQuerySchema>;
         const customerProfileId = request.user.activeContext?.id;

         if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
           return reply.code(403).send({
             type: 'authorization_denied',
             title: 'Customer Context Required',
             detail: 'You must be in a customer context to access this resource',
           });
         }

         const { page, limit, ...filters } = query;

         const result = await venueService.listVenues(
           customerProfileId,
           filters,
           { page, limit }
         );

         return reply.send(result);
       }
     );

     // Get venue details
     server.get(
       '/venues/:id',
       {
         schema: {
           tags: ['customer'],
           summary: 'Get venue',
           description: 'Get details of a specific venue',
           security: [{ bearerAuth: [] }],
           params: {
             type: 'object',
             properties: {
               id: { type: 'string', format: 'uuid' },
             },
           },
           response: {
             200: {
               description: 'Venue details',
               type: 'object',
               properties: {
                 id: { type: 'string', format: 'uuid' },
                 openkjVenueId: { type: 'integer' },
                 urlName: { type: 'string' },
                 name: { type: 'string' },
                 address: { type: 'string' },
                 city: { type: 'string' },
                 state: { type: 'string' },
                 acceptingRequests: { type: 'boolean' },
               },
             },
             404: {
               description: 'Venue not found',
             },
           },
         },
         preHandler: [
           server.authenticate,
           requirePermission('venues:read'),
           validateParams(VenueParamsSchema),
         ],
       },
       async (request, reply) => {
         const { id } = request.params as z.infer<typeof VenueParamsSchema>;
         const customerProfileId = request.user.activeContext?.id;

         if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
           return reply.code(403).send({
             type: 'authorization_denied',
             title: 'Customer Context Required',
             detail: 'You must be in a customer context to access this resource',
           });
         }

         try {
           const venue = await venueService.getVenue(id, customerProfileId);
           return reply.send(venue);
         } catch (error) {
           if (error instanceof Error && error.message.includes('not found')) {
             return reply.code(404).send({
               type: 'resource_not_found',
               title: 'Venue Not Found',
               detail: 'Venue not found or access denied',
             });
           }
           throw error;
         }
       }
     );

     // Create venue
     server.post(
       '/venues',
       {
         schema: {
           tags: ['customer'],
           summary: 'Create venue',
           description: 'Create a new venue',
           security: [{ bearerAuth: [] }],
           body: {
             type: 'object',
             required: ['name', 'address', 'city', 'state', 'postalCode'],
             properties: {
               name: { type: 'string', minLength: 1, maxLength: 255 },
               address: { type: 'string', minLength: 1, maxLength: 255 },
               city: { type: 'string', minLength: 1, maxLength: 100 },
               state: { type: 'string', minLength: 2, maxLength: 50 },
               postalCode: { type: 'string', minLength: 1, maxLength: 20 },
               country: { type: 'string', maxLength: 50 },
               phoneNumber: { type: 'string' },
               website: { type: 'string', format: 'uri' },
               acceptingRequests: { type: 'boolean', default: true },
             },
           },
           response: {
             201: {
               description: 'Venue created',
               type: 'object',
               properties: {
                 id: { type: 'string', format: 'uuid' },
                 openkjVenueId: { type: 'integer' },
                 name: { type: 'string' },
                 urlName: { type: 'string' },
               },
             },
           },
         },
         preHandler: [
           server.authenticate,
           requirePermission('venues:write'),
           validateBody(CreateVenueSchema),
         ],
       },
       async (request, reply) => {
         const body = request.body as z.infer<typeof CreateVenueSchema>;
         const customerProfileId = request.user.activeContext?.id;

         if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
           return reply.code(403).send({
             type: 'authorization_denied',
             title: 'Customer Context Required',
             detail: 'You must be in a customer context to create venues',
           });
         }

         const venue = await venueService.createVenue({
           customerProfileId,
           ...body,
         });

         return reply.code(201).send(venue);
       }
     );

     // Update venue
     server.patch(
       '/venues/:id',
       {
         schema: {
           tags: ['customer'],
           summary: 'Update venue',
           description: 'Update venue information',
           security: [{ bearerAuth: [] }],
           params: {
             type: 'object',
             properties: {
               id: { type: 'string', format: 'uuid' },
             },
           },
           body: {
             type: 'object',
             properties: {
               name: { type: 'string', minLength: 1, maxLength: 255 },
               address: { type: 'string', minLength: 1, maxLength: 255 },
               city: { type: 'string', minLength: 1, maxLength: 100 },
               state: { type: 'string', minLength: 2, maxLength: 50 },
               postalCode: { type: 'string', minLength: 1, maxLength: 20 },
               country: { type: 'string', maxLength: 50 },
               phoneNumber: { type: 'string' },
               website: { type: 'string', format: 'uri' },
               acceptingRequests: { type: 'boolean' },
             },
           },
           response: {
             200: {
               description: 'Venue updated',
               type: 'object',
               properties: {
                 id: { type: 'string', format: 'uuid' },
                 name: { type: 'string' },
                 acceptingRequests: { type: 'boolean' },
               },
             },
             404: {
               description: 'Venue not found',
             },
           },
         },
         preHandler: [
           server.authenticate,
           requirePermission('venues:write'),
           validateParams(VenueParamsSchema),
           validateBody(UpdateVenueSchema),
         ],
       },
       async (request, reply) => {
         const { id } = request.params as z.infer<typeof VenueParamsSchema>;
         const body = request.body as z.infer<typeof UpdateVenueSchema>;
         const customerProfileId = request.user.activeContext?.id;

         if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
           return reply.code(403).send({
             type: 'authorization_denied',
             title: 'Customer Context Required',
             detail: 'You must be in a customer context to update venues',
           });
         }

         try {
           const venue = await venueService.updateVenue(id, customerProfileId, body);
           return reply.send(venue);
         } catch (error) {
           if (error instanceof Error && error.message.includes('not found')) {
             return reply.code(404).send({
               type: 'resource_not_found',
               title: 'Venue Not Found',
               detail: 'Venue not found or access denied',
             });
           }
           throw error;
         }
       }
     );

     // Delete venue
     server.delete(
       '/venues/:id',
       {
         schema: {
           tags: ['customer'],
           summary: 'Delete venue',
           description: 'Delete a venue (also deletes associated requests)',
           security: [{ bearerAuth: [] }],
           params: {
             type: 'object',
             properties: {
               id: { type: 'string', format: 'uuid' },
             },
           },
           response: {
             204: {
               description: 'Venue deleted',
             },
             404: {
               description: 'Venue not found',
             },
           },
         },
         preHandler: [
           server.authenticate,
           requirePermission('venues:delete'),
           validateParams(VenueParamsSchema),
         ],
       },
       async (request, reply) => {
         const { id } = request.params as z.infer<typeof VenueParamsSchema>;
         const customerProfileId = request.user.activeContext?.id;

         if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
           return reply.code(403).send({
             type: 'authorization_denied',
             title: 'Customer Context Required',
             detail: 'You must be in a customer context to delete venues',
           });
         }

         try {
           await venueService.deleteVenue(id, customerProfileId);
           return reply.code(204).send();
         } catch (error) {
           if (error instanceof Error && error.message.includes('not found')) {
             return reply.code(404).send({
               type: 'resource_not_found',
               title: 'Venue Not Found',
               detail: 'Venue not found or access denied',
             });
           }
           throw error;
         }
       }
     );
   };
   ```

4. **Register customer routes in `apps/api/src/routes/customer/index.ts`:**
   ```typescript
   import { FastifyPluginAsync } from 'fastify';
   import { venuesRoute } from './venues';

   export const customerRoutes: FastifyPluginAsync = async (server) => {
     await server.register(venuesRoute);
   };
   ```

**Deliverables:**
- ✅ `GET /v1/customer/venues` - List all customer venues
- ✅ `POST /v1/customer/venues` - Create new venue
- ✅ `GET /v1/customer/venues/:id` - Get venue details
- ✅ `PATCH /v1/customer/venues/:id` - Update venue
- ✅ `DELETE /v1/customer/venues/:id` - Delete venue
- ✅ Auto-increment openkjVenueId via state table
- ✅ URL-friendly name generation
- ✅ Geocoding integration (OpenStreetMap Nominatim)
- ✅ PostGIS geography storage for location
- ✅ RBAC permission checks (venues:read, venues:write, venues:delete)
- ✅ Customer context validation
- ✅ Search and filter capabilities
- ✅ Pagination support

---

### 8.2 Venue Statistics & Analytics

**Objective:** Provide customers with insights and analytics for their venues.

**Duration:** 2-3 days  
**Team Size:** 1 developer

**Tasks:**

1. **Create venue analytics schemas:**
   ```typescript
   // Add to apps/api/src/routes/customer/schemas.ts
   export const VenueStatsQuerySchema = z.object({
     startDate: z.string().datetime().optional(),
     endDate: z.string().datetime().optional(),
   });

   export const VenueStatsResponseSchema = z.object({
     venueId: z.string().uuid(),
     venueName: z.string(),
     stats: z.object({
       totalRequests: z.number(),
       pendingRequests: z.number(),
       processedRequests: z.number(),
       uniqueSingers: z.number(),
       averageRequestsPerDay: z.number(),
     }),
     topSongs: z.array(
       z.object({
         artist: z.string(),
         title: z.string(),
         requestCount: z.number(),
       })
     ),
     topSingers: z.array(
       z.object({
         singerId: z.string().uuid().nullable(),
         singerName: z.string().nullable(),
         requestCount: z.number(),
       })
     ),
     requestsByDay: z.array(
       z.object({
         date: z.string().date(),
         count: z.number(),
       })
     ),
     requestsByHour: z.array(
       z.object({
         hour: z.number(),
         count: z.number(),
       })
     ),
   });

   export const AllVenuesStatsResponseSchema = z.object({
     totalVenues: z.number(),
     totalRequests: z.number(),
     pendingRequests: z.number(),
     processedRequests: z.number(),
     venuesAcceptingRequests: z.number(),
     totalSongs: z.number(),
     topPerformingVenue: z
       .object({
         venueId: z.string().uuid(),
         venueName: z.string(),
         requestCount: z.number(),
       })
       .nullable(),
   });
   ```

2. **Create venue analytics service in `packages/shared/src/services/venue-analytics-service.ts`:**
   ```typescript
   import { PrismaClient } from '@prisma/database';
   import { createLogger } from '@singr/observability';

   const logger = createLogger('services:venue-analytics');

   export interface AnalyticsDateRange {
     startDate?: Date;
     endDate?: Date;
   }

   export class VenueAnalyticsService {
     constructor(private prisma: PrismaClient) {}

     async getVenueStats(
       venueId: string,
       customerProfileId: string,
       dateRange?: AnalyticsDateRange
     ) {
       // Verify venue ownership
       const venue = await this.prisma.venue.findFirst({
         where: {
           id: venueId,
           customerProfileId,
         },
       });

       if (!venue) {
         throw new Error('Venue not found');
       }

       const where: any = { venueId };

       if (dateRange?.startDate) {
         where.requestedAt = { gte: dateRange.startDate };
       }

       if (dateRange?.endDate) {
         where.requestedAt = {
           ...where.requestedAt,
           lte: dateRange.endDate,
         };
       }

       // Basic stats
       const [totalRequests, pendingRequests, processedRequests, uniqueSingers] =
         await Promise.all([
           this.prisma.request.count({ where }),
           this.prisma.request.count({
             where: { ...where, processed: false },
           }),
           this.prisma.request.count({
             where: { ...where, processed: true },
           }),
           this.prisma.request
             .groupBy({
               by: ['singerProfileId'],
               where: {
                 ...where,
                 singerProfileId: { not: null },
               },
             })
             .then((groups) => groups.length),
         ]);

       // Calculate average requests per day
       const dateRangeDays = dateRange?.startDate && dateRange?.endDate
         ? Math.ceil(
             (dateRange.endDate.getTime() - dateRange.startDate.getTime()) /
               (1000 * 60 * 60 * 24)
           )
         : 30; // Default to 30 days

       const averageRequestsPerDay =
         dateRangeDays > 0 ? totalRequests / dateRangeDays : 0;

       // Top songs
       const topSongs = await this.prisma.request.groupBy({
         by: ['artist', 'title'],
         where,
         _count: { id: true },
         orderBy: { _count: { id: 'desc' } },
         take: 10,
       });

       // Top singers
       const topSingersData = await this.prisma.request.groupBy({
         by: ['singerProfileId', 'submittedByUserId'],
         where: {
           ...where,
           singerProfileId: { not: null },
         },
         _count: { id: true },
         orderBy: { _count: { id: 'desc' } },
         take: 10,
       });

       const singerIds = topSingersData
         .map((s) => s.singerProfileId)
         .filter((id): id is string => id !== null);

       const singerProfiles = await this.prisma.singerProfile.findMany({
         where: { id: { in: singerIds } },
         select: {
           id: true,
           nickname: true,
           user: {
             select: { name: true },
           },
         },
       });

       const singerMap = new Map(
         singerProfiles.map((sp) => [
           sp.id,
           sp.nickname || sp.user.name || 'Unknown',
         ])
       );

       const topSingers = topSingersData.map((s) => ({
         singerId: s.singerProfileId,
         singerName: s.singerProfileId ? singerMap.get(s.singerProfileId) || 'Unknown' : 'Guest',
         requestCount: s._count.id,
       }));

       // Requests by day
       const requestsByDayData = await this.prisma.$queryRaw<
         Array<{ date: Date; count: bigint }>
       >`
         SELECT 
           DATE(requested_at) as date,
           COUNT(*)::bigint as count
         FROM requests
         WHERE venues_id = ${venueId}::uuid
           ${dateRange?.startDate ? this.prisma.$queryRawUnsafe`AND requested_at >= '${dateRange.startDate.toISOString()}'` : this.prisma.$queryRawUnsafe``}
           ${dateRange?.endDate ? this.prisma.$queryRawUnsafe`AND requested_at <= '${dateRange.endDate.toISOString()}'` : this.prisma.$queryRawUnsafe``}
         GROUP BY DATE(requested_at)
         ORDER BY date DESC
         LIMIT 30
       `;

       const requestsByDay = requestsByDayData.map((r) => ({
         date: r.date.toISOString().split('T')[0],
         count: Number(r.count),
       }));

       // Requests by hour of day
       const requestsByHourData = await this.prisma.$queryRaw<
         Array<{ hour: number; count: bigint }>
       >`
         SELECT 
           EXTRACT(HOUR FROM requested_at)::integer as hour,
           COUNT(*)::bigint as count
         FROM requests
         WHERE venues_id = ${venueId}::uuid
           ${dateRange?.startDate ? this.prisma.$queryRawUnsafe`AND requested_at >= '${dateRange.startDate.toISOString()}'` : this.prisma.$queryRawUnsafe``}
           ${dateRange?.endDate ? this.prisma.$queryRawUnsafe`AND requested_at <= '${dateRange.endDate.toISOString()}'` : this.prisma.$queryRawUnsafe``}
         GROUP BY EXTRACT(HOUR FROM requested_at)
         ORDER BY hour
       `;

       const requestsByHour = requestsByHourData.map((r) => ({
         hour: r.hour,
         count: Number(r.count),
       }));

       logger.debug(
         {
           venueId,
           totalRequests,
           dateRange,
         },
         'Venue stats calculated'
       );

       return {
         venueId: venue.id,
         venueName: venue.name,
         stats: {
           totalRequests,
           pendingRequests,
           processedRequests,
           uniqueSingers,
           averageRequestsPerDay: parseFloat(averageRequestsPerDay.toFixed(2)),
         },
         topSongs: topSongs.map((s) => ({
           artist: s.artist,
           title: s.title,
           requestCount: s._count.id,
         })),
         topSingers,
         requestsByDay,
         requestsByHour,
       };
     }

     async getAllVenuesStats(customerProfileId: string) {
       const [
         venues,
         totalRequests,
         pendingRequests,
         processedRequests,
         venuesAcceptingRequests,
         totalSongs,
       ] = await Promise.all([
         this.prisma.venue.findMany({
           where: { customerProfileId },
           select: { id: true, name: true },
         }),
         this.prisma.request.count({
           where: {
             venue: { customerProfileId },
           },
         }),
         this.prisma.request.count({
           where: {
             venue: { customerProfileId },
             processed: false,
           },
         }),
         this.prisma.request.count({
           where: {
             venue: { customerProfileId },
             processed: true,
           },
         }),
         this.prisma.venue.count({
           where: {
             customerProfileId,
             acceptingRequests: true,
           },
         }),
         this.prisma.songDb.count({
           where: { customerProfileId },
         }),
       ]);

       // Top performing venue
       const venueRequestCounts = await this.prisma.request.groupBy({
         by: ['venueId'],
         where: {
           venue: { customerProfileId },
         },
         _count: { id: true },
         orderBy: { _count: { id: 'desc' } },
         take: 1,
       });

       let topPerformingVenue = null;
       if (venueRequestCounts.length > 0) {
         const topVenue = venues.find(
           (v) => v.id === venueRequestCounts[0].venueId
         );

         if (topVenue) {
           topPerformingVenue = {
             venueId: topVenue.id,
             venueName: topVenue.name,
             requestCount: venueRequestCounts[0]._count.id,
           };
         }
       }

       logger.debug(
         {
           customerProfileId,
           totalVenues: venues.length,
           totalRequests,
         },
         'All venues stats calculated'
       );

       return {
         totalVenues: venues.length,
         totalRequests,
         pendingRequests,
         processedRequests,
         venuesAcceptingRequests,
         totalSongs,
         topPerformingVenue,
       };
     }

     async exportVenueData(
       venueId: string,
       customerProfileId: string,
       dateRange?: AnalyticsDateRange
     ) {
       // Verify venue ownership
       const venue = await this.prisma.venue.findFirst({
         where: {
           id: venueId,
           customerProfileId,
         },
       });

       if (!venue) {
         throw new Error('Venue not found');
       }

       const where: any = { venueId };

       if (dateRange?.startDate) {
         where.requestedAt = { gte: dateRange.startDate };
       }

       if (dateRange?.endDate) {
         where.requestedAt = {
           ...where.requestedAt,
           lte: dateRange.endDate,
         };
       }

       const requests = await this.prisma.request.findMany({
         where,
         orderBy: { requestedAt: 'desc' },
         include: {
           singerProfile: {
             select: {
               nickname: true,
               user: {
                 select: { name: true, email: true },
               },
             },
           },
         },
       });

       logger.info(
         {
           venueId,
           customerProfileId,
           count: requests.length,
         },
         'Venue data exported'
       );

       return requests.map((r) => ({
         id: Number(r.id),
         artist: r.artist,
         title: r.title,
         keyChange: r.keyChange,
         notes: r.notes,
         singerName: r.singerProfile
           ? r.singerProfile.nickname || r.singerProfile.user.name
           : 'Guest',
         requestedAt: r.requestedAt.toISOString(),
         processed: r.processed,
         processedAt: r.processedAt?.toISOString() || null,
       }));
     }
   }
   ```

3. **Implement venue analytics routes in `apps/api/src/routes/customer/venues.ts`:**
   ```typescript
   // Add to existing venuesRoute

   import { VenueAnalyticsService } from '@singr/shared/services/venue-analytics-service';

   const analyticsService = new VenueAnalyticsService(server.prisma);

   // Get venue statistics
   server.get(
     '/venues/:id/stats',
     {
       schema: {
         tags: ['customer'],
         summary: 'Get venue statistics',
         description: 'Get analytics and statistics for a specific venue',
         security: [{ bearerAuth: [] }],
         params: {
           type: 'object',
           properties: {
             id: { type: 'string', format: 'uuid' },
           },
         },
         querystring: {
           type: 'object',
           properties: {
             startDate: { type: 'string', format: 'date-time' },
             endDate: { type: 'string', format: 'date-time' },
           },
         },
         response: {
           200: {
             description: 'Venue statistics',
             type: 'object',
             properties: {
               venueId: { type: 'string', format: 'uuid' },
               venueName: { type: 'string' },
               stats: {
                 type: 'object',
                 properties: {
                   totalRequests: { type: 'integer' },
                   pendingRequests: { type: 'integer' },
                   processedRequests: { type: 'integer' },
                   uniqueSingers: { type: 'integer' },
                   averageRequestsPerDay: { type: 'number' },
                 },
               },
               topSongs: {
                 type: 'array',
                 items: {
                   type: 'object',
                   properties: {
                     artist: { type: 'string' },
                     title: { type: 'string' },
                     requestCount: { type: 'integer' },
                   },
                 },
               },
               topSingers: {
                 type: 'array',
                 items: {
                   type: 'object',
                   properties: {
                     singerId: { type: 'string', format: 'uuid' },
                     singerName: { type: 'string' },
                     requestCount: { type: 'integer' },
                   },
                 },
               },
               requestsByDay: {
                 type: 'array',
                 items: {
                   type: 'object',
                   properties: {
                     date: { type: 'string', format: 'date' },
                     count: { type: 'integer' },
                   },
                 },
               },
               requestsByHour: {
                 type: 'array',
                 items: {
                   type: 'object',
                   properties: {
                     hour: { type: 'integer' },
                     count: { type: 'integer' },
                   },
                 },
               },
             },
           },
           404: {
             description: 'Venue not found',
           },
         },
       },
       preHandler: [
         server.authenticate,
         requirePermission('venues:read'),
         validateParams(VenueParamsSchema),
         validateQuery(VenueStatsQuerySchema),
       ],
     },
     async (request, reply) => {
       const { id } = request.params as z.infer<typeof VenueParamsSchema>;
       const { startDate, endDate } = request.query as z.infer<
         typeof VenueStatsQuerySchema
       >;
       const customerProfileId = request.user.activeContext?.id;

       if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
         return reply.code(403).send({
           type: 'authorization_denied',
           title: 'Customer Context Required',
           detail: 'You must be in a customer context to access venue statistics',
         });
       }

       try {
         const stats = await analyticsService.getVenueStats(
           id,
           customerProfileId,
           {
             startDate: startDate ? new Date(startDate) : undefined,
             endDate: endDate ? new Date(endDate) : undefined,
           }
         );

         return reply.send(stats);
       } catch (error) {
         if (error instanceof Error && error.message.includes('not found')) {
           return reply.code(404).send({
             type: 'resource_not_found',
             title: 'Venue Not Found',
             detail: 'Venue not found or access denied',
           });
         }
         throw error;
       }
     }
   );

   // Get all venues statistics
   server.get(
     '/venues/stats/overview',
     {
       schema: {
         tags: ['customer'],
         summary: 'Get overview statistics',
         description: 'Get aggregate statistics for all venues',
         security: [{ bearerAuth: [] }],
         response: {
           200: {
             description: 'Overview statistics',
             type: 'object',
             properties: {
               totalVenues: { type: 'integer' },
               totalRequests: { type: 'integer' },
               pendingRequests: { type: 'integer' },
               processedRequests: { type: 'integer' },
               venuesAcceptingRequests: { type: 'integer' },
               totalSongs: { type: 'integer' },
               topPerformingVenue: {
                 type: 'object',
                 properties: {
                   venueId: { type: 'string', format: 'uuid' },
                   venueName: { type: 'string' },
                   requestCount: { type: 'integer' },
                 },
               },
             },
           },
         },
       },
       preHandler: [server.authenticate, requirePermission('venues:read')],
     },
     async (request, reply) => {
       const customerProfileId = request.user.activeContext?.id;

       if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
         return reply.code(403).send({
           type: 'authorization_denied',
           title: 'Customer Context Required',
           detail: 'You must be in a customer context to access statistics',
         });
       }

       const stats = await analyticsService.getAllVenuesStats(customerProfileId);

       return reply.send(stats);
     }
   );

   // Export venue data
   server.get(
     '/venues/:id/export',
     {
       schema: {
         tags: ['customer'],
         summary: 'Export venue data',
         description: 'Export all request data for a venue as JSON',
         security: [{ bearerAuth: [] }],
         params: {
           type: 'object',
           properties: {
             id: { type: 'string', format: 'uuid' },
           },
         },
         querystring: {
           type: 'object',
           properties: {
             startDate: { type: 'string', format: 'date-time' },
             endDate: { type: 'string', format: 'date-time' },
           },
         },
         response: {
           200: {
             description: 'Exported venue data',
             type: 'array',
             items: {
               type: 'object',
               properties: {
                 id: { type: 'integer' },
                 artist: { type: 'string' },
                 title: { type: 'string' },
                 keyChange: { type: 'integer' },
                 notes: { type: 'string' },
                 singerName: { type: 'string' },
                 requestedAt: { type: 'string', format: 'date-time' },
                 processed: { type: 'boolean' },
                 processedAt: { type: 'string', format: 'date-time' },
               },
             },
           },
           404: {
             description: 'Venue not found',
           },
         },
       },
       preHandler: [
         server.authenticate,
         requirePermission('venues:read'),
         validateParams(VenueParamsSchema),
         validateQuery(VenueStatsQuerySchema),
       ],
       config: {
         rateLimit: {
           max: 10,
           timeWindow: '1 hour',
         },
       },
     },
     async (request, reply) => {
       const { id } = request.params as z.infer<typeof VenueParamsSchema>;
       const { startDate, endDate } = request.query as z.infer<
         typeof VenueStatsQuerySchema
       >;
       const customerProfileId = request.user.activeContext?.id;

       if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
         return reply.code(403).send({
           type: 'authorization_denied',
           title: 'Customer Context Required',
           detail: 'You must be in a customer context to export venue data',
         });
       }

       try {
         const data = await analyticsService.exportVenueData(id, customerProfileId, {
           startDate: startDate ? new Date(startDate) : undefined,
           endDate: endDate ? new Date(endDate) : undefined,
         });

         // Set headers for download
         reply.header('Content-Type', 'application/json');
         reply.header(
           'Content-Disposition',
           `attachment; filename="venue-export-${id}-${new Date().toISOString().split('T')[0]}.json"`
         );

         return reply.send(data);
       } catch (error) {
         if (error instanceof Error && error.message.includes('not found')) {
           return reply.code(404).send({
             type: 'resource_not_found',
             title: 'Venue Not Found',
             detail: 'Venue not found or access denied',
           });
         }
         throw error;
       }
     }
   );
   ```

**Deliverables:**
- ✅ `GET /v1/customer/venues/:id/stats` - Get detailed venue statistics
- ✅ `GET /v1/customer/venues/stats/overview` - Get aggregate statistics for all venues
- ✅ `GET /v1/customer/venues/:id/export` - Export venue request data
- ✅ Date range filtering for all analytics
- ✅ Request statistics (total, pending, processed)
- ✅ Unique singer count
- ✅ Average requests per day
- ✅ Top 10 requested songs
- ✅ Top 10 singers by request count
- ✅ Requests by day (last 30 days)
- ✅ Requests by hour of day
- ✅ Top performing venue across all venues
- ✅ Total song count in database
- ✅ JSON export with rate limiting
- ✅ Download headers for exported data

---
