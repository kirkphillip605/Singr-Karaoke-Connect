# Singr Central API Backend - Phase 5

**Document Version:** 1.0  
**Last Updated:** 2025-11-12  
**Author:** kirkphillip605  
**Status:** In Development

---

## Phase 5: Public Venue Discovery & Guest Features

### 5.1 Venue Listing & Search

**Objective:** Allow anyone to discover karaoke venues with filtering and search.

**Duration:** 2-3 days  
**Team Size:** 1-2 developers

**Tasks:**

1. **Create venue schemas in `apps/api/src/routes/public/schemas.ts`:**
   ```typescript
   import { z } from 'zod';
   import { PaginationSchema, SortOrderSchema } from '@singr/shared/validation';

   export const VenueListQuerySchema = PaginationSchema.extend({
     city: z.string().max(100).optional(),
     state: z.string().max(50).optional(),
     country: z.string().max(50).optional(),
     acceptingRequests: z.coerce.boolean().optional(),
     search: z.string().max(100).optional(),
     sort: z.enum(['name', 'city', 'distance', 'created']).default('name'),
     order: SortOrderSchema,
   });

   export const VenueNearbyQuerySchema = z.object({
     lat: z.coerce.number().min(-90).max(90),
     lng: z.coerce.number().min(-180).max(180),
     radius: z.coerce.number().min(1).max(100).default(25), // miles
     limit: z.coerce.number().int().min(1).max(50).default(20),
     acceptingRequests: z.coerce.boolean().optional(),
   });

   export const VenueParamsSchema = z.object({
     urlName: z.string().min(1),
   });

   export const VenueListItemSchema = z.object({
     id: z.string().uuid(),
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
     distance: z.number().optional(),
     location: z
       .object({
         lat: z.number(),
         lng: z.number(),
       })
       .nullable(),
   });

   export const VenueDetailSchema = VenueListItemSchema.extend({
     openkjVenueId: z.number(),
     systems: z.array(
       z.object({
         id: z.string().uuid(),
         name: z.string(),
         openkjSystemId: z.number(),
       })
     ),
     branding: z
       .object({
         logoUrl: z.string().nullable(),
         colorPalette: z.record(z.string()),
         poweredBySingr: z.boolean(),
       })
       .nullable(),
     stats: z.object({
       totalSongs: z.number(),
       requestsToday: z.number(),
     }),
   });
   ```

2. **Implement venue service in `packages/shared/src/services/venue-service.ts`:**
   ```typescript
   import { PrismaClient } from '@prisma/database';
   import { Redis } from 'ioredis';
   import { CACHE_TTL } from '@singr/config';
   import { createLogger } from '@singr/observability';

   const logger = createLogger('services:venue');

   export interface VenueFilters {
     city?: string;
     state?: string;
     country?: string;
     acceptingRequests?: boolean;
     search?: string;
   }

   export interface PaginationParams {
     page: number;
     limit: number;
     sort?: string;
     order?: 'asc' | 'desc';
   }

   export interface NearbyVenuesParams {
     lat: number;
     lng: number;
     radius: number;
     limit: number;
     acceptingRequests?: boolean;
   }

   export class VenueService {
     constructor(
       private prisma: PrismaClient,
       private redis: Redis
     ) {}

     async listVenues(filters: VenueFilters, pagination: PaginationParams) {
       const cacheKey = `venues:list:${JSON.stringify({ filters, pagination })}`;
       const cached = await this.redis.get(cacheKey);

       if (cached) {
         logger.debug('Venues list cache hit');
         return JSON.parse(cached);
       }

       const where: any = {};

       if (filters.city) {
         where.city = { contains: filters.city, mode: 'insensitive' };
       }
       if (filters.state) {
         where.state = { equals: filters.state, mode: 'insensitive' };
       }
       if (filters.country) {
         where.country = { equals: filters.country, mode: 'insensitive' };
       }
       if (filters.acceptingRequests !== undefined) {
         where.acceptingRequests = filters.acceptingRequests;
       }
       if (filters.search) {
         where.name = { contains: filters.search, mode: 'insensitive' };
       }

       const [venues, total] = await Promise.all([
         this.prisma.venue.findMany({
           where,
           skip: (pagination.page - 1) * pagination.limit,
           take: pagination.limit,
           orderBy: {
             [pagination.sort || 'name']: pagination.order || 'asc',
           },
         }),
         this.prisma.venue.count({ where }),
       ]);

       const result = {
         data: venues.map(this.formatVenueListItem),
         pagination: {
           page: pagination.page,
           limit: pagination.limit,
           total,
           totalPages: Math.ceil(total / pagination.limit),
         },
       };

       await this.redis.setex(
         cacheKey,
         CACHE_TTL.VENUES_LIST,
         JSON.stringify(result)
       );

       logger.debug({ count: venues.length, total }, 'Venues listed');

       return result;
     }

     async findNearbyVenues(params: NearbyVenuesParams) {
       const radiusMeters = params.radius * 1609.34;

       const query = `
         SELECT 
           venues_id as id,
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
           ST_Y(location::geometry) as lat,
           ST_X(location::geometry) as lng,
           ST_Distance(
             location,
             ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
           ) / 1609.34 as distance_miles
         FROM venues
         WHERE 
           ST_DWithin(
             location,
             ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
             $3
           )
           ${params.acceptingRequests !== undefined ? 'AND accepting_requests = $4' : ''}
         ORDER BY distance_miles ASC
         LIMIT $${params.acceptingRequests !== undefined ? '5' : '4'}
       `;

       const queryParams =
         params.acceptingRequests !== undefined
           ? [params.lng, params.lat, radiusMeters, params.acceptingRequests, params.limit]
           : [params.lng, params.lat, radiusMeters, params.limit];

       const venues = await this.prisma.$queryRawUnsafe<any[]>(query, ...queryParams);

       logger.debug(
         { lat: params.lat, lng: params.lng, radius: params.radius, count: venues.length },
         'Nearby venues found'
       );

       return venues.map((v) => ({
         id: v.id,
         urlName: v.url_name,
         name: v.name,
         address: v.address,
         city: v.city,
         state: v.state,
         postalCode: v.postal_code,
         country: v.country,
         phoneNumber: v.phone_number,
         website: v.website,
         acceptingRequests: v.accepting_requests,
         distance: parseFloat(v.distance_miles.toFixed(2)),
         location: v.lat && v.lng ? { lat: parseFloat(v.lat), lng: parseFloat(v.lng) } : null,
       }));
     }

     async getVenueByUrlName(urlName: string, includeDetails = false) {
       const cacheKey = `venue:${urlName}:${includeDetails}`;
       const cached = await this.redis.get(cacheKey);

       if (cached) {
         logger.debug({ urlName }, 'Venue cache hit');
         return JSON.parse(cached);
       }

       const venue = await this.prisma.venue.findUnique({
         where: { urlName },
         include: {
           customerProfile: {
             include: {
               brandedApps: {
                 include: {
                   brandingProfile: true,
                 },
                 take: 1,
               },
             },
           },
           systems: includeDetails,
         },
       });

       if (!venue) {
         return null;
       }

       let stats = null;
       if (includeDetails) {
         const [totalSongs, requestsToday] = await Promise.all([
           this.prisma.songDb.count({
             where: { customerProfileId: venue.customerProfileId },
           }),
           this.prisma.request.count({
             where: {
               venueId: venue.id,
               requestedAt: {
                 gte: new Date(new Date().setHours(0, 0, 0, 0)),
               },
             },
           }),
         ]);

         stats = { totalSongs, requestsToday };
       }

       const result = this.formatVenueDetail(venue, stats);
       await this.redis.setex(
         cacheKey,
         CACHE_TTL.VENUE_DETAIL,
         JSON.stringify(result)
       );

       logger.debug({ urlName, includeDetails }, 'Venue retrieved');

       return result;
     }

     private formatVenueListItem(venue: any) {
       return {
         id: venue.id,
         urlName: venue.urlName,
         name: venue.name,
         address: venue.address,
         city: venue.city,
         state: venue.state,
         postalCode: venue.postalCode,
         country: venue.country,
         phoneNumber: venue.phoneNumber,
         website: venue.website,
         acceptingRequests: venue.acceptingRequests,
         location: null,
       };
     }

     private formatVenueDetail(venue: any, stats: any) {
       const branding = venue.customerProfile.brandedApps[0]?.brandingProfile;

       return {
         ...this.formatVenueListItem(venue),
         openkjVenueId: venue.openkjVenueId,
         systems:
           venue.systems?.map((s: any) => ({
             id: s.id,
             name: s.name,
             openkjSystemId: s.openkjSystemId,
           })) || [],
         branding: branding
           ? {
               logoUrl: branding.logoUrl,
               colorPalette: branding.colorPalette,
               poweredBySingr: branding.poweredBySingr,
             }
           : null,
         stats,
       };
     }

     async invalidateVenueCache(urlName: string) {
       const keys = await this.redis.keys(`venue:${urlName}:*`);
       if (keys.length > 0) {
         await this.redis.del(...keys);
       }

       const listKeys = await this.redis.keys('venues:list:*');
       if (listKeys.length > 0) {
         await this.redis.del(...listKeys);
       }

       logger.debug({ urlName }, 'Venue cache invalidated');
     }
   }
   ```

3. **Implement venue routes in `apps/api/src/routes/public/venues.ts`:**
   ```typescript
   import { FastifyPluginAsync } from 'fastify';
   import { validateQuery, validateParams } from '@singr/shared/validation';
   import {
     VenueListQuerySchema,
     VenueNearbyQuerySchema,
     VenueParamsSchema,
   } from './schemas';
   import { VenueService } from '@singr/shared/services/venue-service';
   import { createLogger } from '@singr/observability';

   const logger = createLogger('routes:public:venues');

   export const venuesRoute: FastifyPluginAsync = async (server) => {
     const venueService = new VenueService(server.prisma, server.redis);

     // List venues
     server.get(
       '/venues',
       {
         schema: {
           tags: ['public'],
           summary: 'List all venues',
           description: 'Get paginated list of venues with optional filters',
           querystring: {
             type: 'object',
             properties: {
               page: { type: 'integer', minimum: 1, default: 1 },
               limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
               city: { type: 'string' },
               state: { type: 'string' },
               country: { type: 'string' },
               acceptingRequests: { type: 'boolean' },
               search: { type: 'string' },
               sort: { type: 'string', enum: ['name', 'city', 'distance', 'created'] },
               order: { type: 'string', enum: ['asc', 'desc'] },
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
         preHandler: [validateQuery(VenueListQuerySchema)],
         config: {
           rateLimit: {
             max: 60,
             timeWindow: '1 minute',
           },
         },
       },
       async (request, reply) => {
         const query = request.query as z.infer<typeof VenueListQuerySchema>;

         const { page, limit, sort, order, ...filters } = query;

         const result = await venueService.listVenues(filters, {
           page,
           limit,
           sort,
           order,
         });

         return reply.send(result);
       }
     );

     // Find nearby venues
     server.get(
       '/venues/nearby',
       {
         schema: {
           tags: ['public'],
           summary: 'Find nearby venues',
           description: 'Get venues within specified radius using PostGIS',
           querystring: {
             type: 'object',
             required: ['lat', 'lng'],
             properties: {
               lat: { type: 'number', minimum: -90, maximum: 90 },
               lng: { type: 'number', minimum: -180, maximum: 180 },
               radius: { type: 'number', minimum: 1, maximum: 100, default: 25 },
               limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
               acceptingRequests: { type: 'boolean' },
             },
           },
           response: {
             200: {
               description: 'Nearby venues',
               type: 'object',
               properties: {
                 data: {
                   type: 'array',
                   items: {
                     type: 'object',
                     properties: {
                       id: { type: 'string', format: 'uuid' },
                       name: { type: 'string' },
                       distance: { type: 'number' },
                       acceptingRequests: { type: 'boolean' },
                     },
                   },
                 },
                 query: {
                   type: 'object',
                   properties: {
                     lat: { type: 'number' },
                     lng: { type: 'number' },
                     radius: { type: 'number' },
                   },
                 },
               },
             },
           },
         },
         preHandler: [validateQuery(VenueNearbyQuerySchema)],
         config: {
           rateLimit: {
             max: 60,
             timeWindow: '1 minute',
           },
         },
       },
       async (request, reply) => {
         const query = request.query as z.infer<typeof VenueNearbyQuerySchema>;

         const venues = await venueService.findNearbyVenues(query);

         return reply.send({
           data: venues,
           query: {
             lat: query.lat,
             lng: query.lng,
             radius: query.radius,
           },
         });
       }
     );

     // Get venue details
     server.get(
       '/venues/:urlName',
       {
         schema: {
           tags: ['public'],
           summary: 'Get venue details',
           description: 'Get detailed information about a specific venue',
           params: {
             type: 'object',
             properties: {
               urlName: { type: 'string' },
             },
           },
           response: {
             200: {
               description: 'Venue details',
               type: 'object',
               properties: {
                 id: { type: 'string', format: 'uuid' },
                 name: { type: 'string' },
                 address: { type: 'string' },
                 city: { type: 'string' },
                 state: { type: 'string' },
                 acceptingRequests: { type: 'boolean' },
                 systems: {
                   type: 'array',
                   items: {
                     type: 'object',
                     properties: {
                       id: { type: 'string', format: 'uuid' },
                       name: { type: 'string' },
                     },
                   },
                 },
                 stats: {
                   type: 'object',
                   properties: {
                     totalSongs: { type: 'integer' },
                     requestsToday: { type: 'integer' },
                   },
                 },
               },
             },
             404: {
               description: 'Venue not found',
             },
           },
         },
         preHandler: [validateParams(VenueParamsSchema)],
         config: {
           rateLimit: {
             max: 60,
             timeWindow: '1 minute',
           },
         },
       },
       async (request, reply) => {
         const { urlName } = request.params as z.infer<typeof VenueParamsSchema>;

         const venue = await venueService.getVenueByUrlName(urlName, true);

         if (!venue) {
           return reply.code(404).send({
             type: 'resource_not_found',
             title: 'Venue Not Found',
             detail: `No venue found with URL name: ${urlName}`,
           });
         }

         return reply.send(venue);
       }
     );
   };
   ```

**Deliverables:**
- ✅ `GET /v1/public/venues` - Paginated venue listing with filters
- ✅ `GET /v1/public/venues/nearby` - PostGIS proximity search
- ✅ `GET /v1/public/venues/:urlName` - Detailed venue information
- ✅ Redis caching (5-10 min TTL)
- ✅ Rate limiting (60 req/min per IP)
- ✅ Distance calculation in miles
- ✅ Search by name, filter by location/status

---

### 5.2 Song Database Search

**Objective:** Allow users to search venue songbooks.

**Duration:** 2 days  
**Team Size:** 1 developer

**Tasks:**

1. **Create song search schemas:**
   ```typescript
   // Add to apps/api/src/routes/public/schemas.ts
   export const SongSearchQuerySchema = z.object({
     q: z.string().min(1).max(200),
     venueId: z.string().uuid().optional(),
     systemId: z.string().uuid().optional(),
     page: z.coerce.number().int().min(1).default(1),
     limit: z.coerce.number().int().min(1).max(100).default(20),
     sortBy: z.enum(['relevance', 'artist', 'title']).default('relevance'),
   });

   export const SongSearchResultSchema = z.object({
     id: z.number(),
     artist: z.string(),
     title: z.string(),
     combined: z.string(),
     systemId: z.string().uuid().optional(),
     systemName: z.string().optional(),
     venueId: z.string().uuid().optional(),
     venueName: z.string().optional(),
   });

   export const VenueSongsQuerySchema = PaginationSchema.extend({
     artist: z.string().max(100).optional(),
     letter: z.string().length(1).optional(),
     systemId: z.string().uuid().optional(),
   });
   ```

2. **Implement song service in `packages/shared/src/services/song-service.ts`:**
   ```typescript
   import { PrismaClient } from '@prisma/database';
   import { Redis } from 'ioredis';
   import { CACHE_TTL } from '@singr/config';
   import { createLogger } from '@singr/observability';

   const logger = createLogger('services:song');

   export interface SongSearchParams {
     query: string;
     venueId?: string;
     systemId?: string;
     page: number;
     limit: number;
     sortBy: 'relevance' | 'artist' | 'title';
   }

   export class SongService {
     constructor(
       private prisma: PrismaClient,
       private redis: Redis
     ) {}

     async searchSongs(params: SongSearchParams) {
       const cacheKey = `songs:search:${JSON.stringify(params)}`;
       const cached = await this.redis.get(cacheKey);

       if (cached) {
         logger.debug('Song search cache hit');
         return JSON.parse(cached);
       }

       const where: any = {};

       if (params.venueId) {
         const venue = await this.prisma.venue.findUnique({
           where: { id: params.venueId },
           select: { customerProfileId: true },
         });

         if (venue) {
           where.customerProfileId = venue.customerProfileId;
         }
       }

       if (params.systemId) {
         const system = await this.prisma.system.findUnique({
           where: { id: params.systemId },
           select: { openkjSystemId: true, customerProfileId: true },
         });

         if (system) {
           where.openkjSystemId = system.openkjSystemId;
           where.customerProfileId = system.customerProfileId;
         }
       }

       const searchTerms = params.query
         .toLowerCase()
         .split(/\s+/)
         .filter(Boolean);

       where.OR = searchTerms.flatMap((term) => [
         { artist: { contains: term, mode: 'insensitive' } },
         { title: { contains: term, mode: 'insensitive' } },
         { normalizedCombined: { contains: term, mode: 'insensitive' } },
       ]);

       let orderBy: any = { artist: 'asc' };
       if (params.sortBy === 'title') {
         orderBy = { title: 'asc' };
       }

       const [songs, total] = await Promise.all([
         this.prisma.songDb.findMany({
           where,
           skip: (params.page - 1) * params.limit,
           take: params.limit,
           orderBy,
           include: {
             customerProfile: {
               include: {
                 venues: {
                   take: 1,
                 },
               },
             },
           },
         }),
         this.prisma.songDb.count({ where }),
       ]);

       const systemIds = [...new Set(songs.map((s) => s.openkjSystemId))];
       const systems = await this.prisma.system.findMany({
         where: {
           openkjSystemId: { in: systemIds },
         },
         select: {
           openkjSystemId: true,
           name: true,
           id: true,
         },
       });

       const systemMap = new Map(
         systems.map((s) => [s.openkjSystemId, { id: s.id, name: s.name }])
       );

       const result = {
         data: songs.map((song) => {
           const system = systemMap.get(song.openkjSystemId);
           const venue = song.customerProfile.venues[0];

           return {
             id: Number(song.id),
             artist: song.artist,
             title: song.title,
             combined: song.combined,
             systemId: system?.id,
             systemName: system?.name,
             venueId: venue?.id,
             venueName: venue?.name,
           };
         }),
         pagination: {
           page: params.page,
           limit: params.limit,
           total,
           totalPages: Math.ceil(total / params.limit),
         },
         query: params.query,
       };

       await this.redis.setex(
         cacheKey,
         CACHE_TTL.SONGDB_SEARCH,
         JSON.stringify(result)
       );

       logger.debug({ query: params.query, count: songs.length, total }, 'Songs searched');

       return result;
     }
   }
   ```

3. **Implement song routes in `apps/api/src/routes/public/songs.ts`:**
   ```typescript
   import { FastifyPluginAsync } from 'fastify';
   import { validateQuery, validateParams } from '@singr/shared/validation';
   import { SongSearchQuerySchema, VenueSongsQuerySchema, VenueParamsSchema } from './schemas';
   import { SongService } from '@singr/shared/services/song-service';
   import { createLogger } from '@singr/observability';

   const logger = createLogger('routes:public:songs');

   export const songsRoute: FastifyPluginAsync = async (server) => {
     const songService = new SongService(server.prisma, server.redis);

     // Search songs
     server.get(
       '/songs/search',
       {
         schema: {
           tags: ['public'],
           summary: 'Search songs',
           description: 'Search for songs across all venues or within specific venue/system',
           querystring: {
             type: 'object',
             required: ['q'],
             properties: {
               q: { type: 'string', minLength: 1, maxLength: 200 },
               venueId: { type: 'string', format: 'uuid' },
               systemId: { type: 'string', format: 'uuid' },
               page: { type: 'integer', minimum: 1, default: 1 },
               limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
               sortBy: { type: 'string', enum: ['relevance', 'artist', 'title'] },
             },
           },
           response: {
             200: {
               description: 'Search results',
               type: 'object',
               properties: {
                 data: {
                   type: 'array',
                   items: {
                     type: 'object',
                     properties: {
                       id: { type: 'integer' },
                       artist: { type: 'string' },
                       title: { type: 'string' },
                       combined: { type: 'string' },
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
         preHandler: [validateQuery(SongSearchQuerySchema)],
         config: {
           rateLimit: {
             max: 60,
             timeWindow: '1 minute',
           },
         },
       },
       async (request, reply) => {
         const query = request.query as z.infer<typeof SongSearchQuerySchema>;

         const result = await songService.searchSongs({
           query: query.q,
           venueId: query.venueId,
           systemId: query.systemId,
           page: query.page,
           limit: query.limit,
           sortBy: query.sortBy,
         });

         return reply.send(result);
       }
     );

     // Browse venue songs
     server.get(
       '/venues/:urlName/songs',
       {
         schema: {
           tags: ['public'],
           summary: 'Browse venue songs',
           description: 'Get paginated list of songs available at a venue',
           params: {
             type: 'object',
             properties: {
               urlName: { type: 'string' },
             },
           },
           querystring: {
             type: 'object',
             properties: {
               page: { type: 'integer', minimum: 1, default: 1 },
               limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
               artist: { type: 'string' },
               letter: { type: 'string', minLength: 1, maxLength: 1 },
               systemId: { type: 'string', format: 'uuid' },
             },
           },
           response: {
             200: {
               description: 'Venue songs',
               type: 'object',
               properties: {
                 venue: {
                   type: 'object',
                   properties: {
                     id: { type: 'string', format: 'uuid' },
                     name: { type: 'string' },
                   },
                 },
                 data: {
                   type: 'array',
                   items: {
                     type: 'object',
                     properties: {
                       id: { type: 'integer' },
                       artist: { type: 'string' },
                       title: { type: 'string' },
                     },
                   },
                 },
                 availableLetters: {
                   type: 'array',
                   items: { type: 'string' },
                 },
               },
             },
           },
         },
         preHandler: [validateParams(VenueParamsSchema), validateQuery(VenueSongsQuerySchema)],
         config: {
           rateLimit: {
             max: 60,
             timeWindow: '1 minute',
           },
         },
       },
       async (request, reply) => {
         const { urlName } = request.params as z.infer<typeof VenueParamsSchema>;
         const query = request.query as z.infer<typeof VenueSongsQuerySchema>;

         const venue = await server.prisma.venue.findUnique({
           where: { urlName },
           select: {
             id: true,
             name: true,
             customerProfileId: true,
           },
         });

         if (!venue) {
           return reply.code(404).send({
             type: 'resource_not_found',
             title: 'Venue Not Found',
             detail: 'Venue not found',
           });
         }

         const where: any = {
           customerProfileId: venue.customerProfileId,
         };

         if (query.artist) {
           where.artist = { contains: query.artist, mode: 'insensitive' };
         }

         if (query.letter) {
           where.artist = {
             ...where.artist,
             startsWith: query.letter.toUpperCase(),
           };
         }

         if (query.systemId) {
           const system = await server.prisma.system.findUnique({
             where: { id: query.systemId },
             select: { openkjSystemId: true },
           });

           if (system) {
             where.openkjSystemId = system.openkjSystemId;
           }
         }

         const [songs, total] = await Promise.all([
           server.prisma.songDb.findMany({
             where,
             skip: (query.page - 1) * query.limit,
             take: query.limit,
             orderBy: [{ artist: 'asc' }, { title: 'asc' }],
           }),
           server.prisma.songDb.count({ where }),
         ]);

         const availableLetters = await server.prisma.$queryRaw<
           Array<{ letter: string }>
         >`
           SELECT DISTINCT UPPER(LEFT(artist, 1)) as letter
           FROM songdb
           WHERE customer_profiles_id = ${venue.customerProfileId}::uuid
           ORDER BY letter
         `;

         return reply.send({
           venue: {
             id: venue.id,
             name: venue.name,
           },
           data: songs.map((s) => ({
             id: Number(s.id),
             artist: s.artist,
             title: s.title,
             combined: s.combined,
           })),
           pagination: {
             page: query.page,
             limit: query.limit,
             total,
             totalPages: Math.ceil(total / query.limit),
           },
           availableLetters: availableLetters.map((l) => l.letter),
         });
       }
     );
   };
   ```

**Deliverables:**
- ✅ `GET /v1/public/songs/search` - Full-text song search
- ✅ `GET /v1/public/venues/:urlName/songs` - Browse venue songbook
- ✅ Search by artist, title, or combined
- ✅ Filter by venue or system
- ✅ Alphabet navigation support
- ✅ Redis caching (5 min TTL)
- ✅ Rate limiting (60 req/min)

---

### 5.3 Guest Request Submission

**Objective:** Allow unauthenticated users to submit song requests.

**Duration:** 2 days  
**Team Size:** 1 developer

**Tasks:**

1. **Create request schemas:**
   ```typescript
   // Add to apps/api/src/routes/public/schemas.ts
   export const PublicRequestSchema = z.object({
     venueId: z.string().uuid(),
     artist: z.string().min(1).max(255),
     title: z.string().min(1).max(255),
     keyChange: z.number().int().min(-12).max(12).default(0),
     notes: z.string().max(500).optional(),
     guestName: z.string().min(1).max(100).optional(),
   });

   export const RequestResponseSchema = z.object({
     id: z.number(),
     venueId: z.string().uuid(),
     venueName: z.string(),
     artist: z.string(),
     title: z.string(),
     keyChange: z.number(),
     notes: z.string().nullable(),
     requestedAt: z.string().datetime(),
     processed: z.boolean(),
   });
   ```

2. **Implement request service in `packages/shared/src/services/request-service.ts`:**
   ```typescript
   import { PrismaClient } from '@prisma/database';
   import { Redis } from 'ioredis';
   import { createLogger } from '@singr/observability';

   const logger = createLogger('services:request');

   export interface CreateRequestInput {
     venueId: string;
     artist: string;
     title: string;
     keyChange?: number;
     notes?: string;
     singerProfileId?: string;
     submittedByUserId?: string;
     guestName?: string;
   }

   export class RequestService {
     constructor(
       private prisma: PrismaClient,
       private redis: Redis
     ) {}

     async createRequest(input: CreateRequestInput) {
       const venue = await this.prisma.venue.findUnique({
         where: { id: input.venueId },
         select: {
           id: true,
           name: true,
           acceptingRequests: true,
           customerProfileId: true,
         },
       });

       if (!venue) {
         throw new Error('Venue not found');
       }

       if (!venue.acceptingRequests) {
         throw new Error('Venue is not currently accepting requests');
       }

       // Rate limit per venue
       const rateLimitKey = `rate:request:venue:${input.venueId}`;
       const currentCount = await this.redis.incr(rateLimitKey);

       if (currentCount === 1) {
         await this.redis.expire(rateLimitKey, 3600);
       }

       if (currentCount > 50) {
         throw new Error('Request rate limit exceeded for this venue');
       }

       // Per-user rate limit if authenticated
       if (input.singerProfileId) {
         const userRateLimitKey = `rate:request:user:${input.singerProfileId}`;
         const userCount = await this.redis.incr(userRateLimitKey);

         if (userCount === 1) {
           await this.redis.expire(userRateLimitKey, 3600);
         }

         if (userCount > 10) {
           throw new Error('You have reached your hourly request limit');
         }
       }

       const request = await this.prisma.request.create({
         data: {
           venueId: input.venueId,
           artist: input.artist,
           title: input.title,
           keyChange: input.keyChange || 0,
           notes: input.notes || null,
           singerProfileId: input.singerProfileId || null,
           submittedByUserId: input.submittedByUserId || null,
         },
         include: {
           venue: {
             select: { name: true },
           },
         },
       });

       // Add to request history if authenticated
       if (input.singerProfileId) {
         await this.createRequestHistory({
           singerProfileId: input.singerProfileId,
           venueId: input.venueId,
           artist: input.artist,
           title: input.title,
           keyChange: input.keyChange || 0,
         });
       }

       logger.info(
         {
           requestId: request.id,
           venueId: input.venueId,
           singerProfileId: input.singerProfileId,
           guestName: input.guestName,
         },
         'Song request created'
       );

       return {
         id: Number(request.id),
         venueId: request.venueId,
         venueName: request.venue.name,
         artist: request.artist,
         title: request.title,
         keyChange: request.keyChange,
         notes: request.notes,
         requestedAt: request.requestedAt.toISOString(),
         processed: request.processed,
       };
     }

     private async createRequestHistory(input: {
       singerProfileId: string;
       venueId: string;
       artist: string;
       title: string;
       keyChange: number;
     }) {
       const songFingerprint = `${input.artist.toLowerCase()}:${input.title.toLowerCase()}`;

       await this.prisma.singerRequestHistory.create({
         data: {
           singerProfileId: input.singerProfileId,
           venueId: input.venueId,
           artist: input.artist,
           title: input.title,
           keyChange: input.keyChange,
           songFingerprint,
         },
       });
     }
   }
   ```

3. **Implement request route in `apps/api/src/routes/public/requests.ts`:**
   ```typescript
   import { FastifyPluginAsync } from 'fastify';
   import { validateBody } from '@singr/shared/validation';
   import { PublicRequestSchema } from './schemas';
   import { RequestService } from '@singr/shared/services/request-service';
   import { createLogger } from '@singr/observability';

   const logger = createLogger('routes:public:requests');

   export const requestsRoute: FastifyPluginAsync = async (server) => {
     const requestService = new RequestService(server.prisma, server.redis);

     server.post(
       '/requests',
       {
         schema: {
           tags: ['public'],
           summary: 'Submit song request',
           description: 'Submit a song request to a venue (authentication optional)',
           body: {
             type: 'object',
             required: ['venueId', 'artist', 'title'],
             properties: {
               venueId: { type: 'string', format: 'uuid' },
               artist: { type: 'string', minLength: 1, maxLength: 255 },
               title: { type: 'string', minLength: 1, maxLength: 255 },
               keyChange: { type: 'integer', minimum: -12, maximum: 12, default: 0 },
               notes: { type: 'string', maxLength: 500 },
               guestName: { type: 'string', minLength: 1, maxLength: 100 },
             },
           },
           response: {
             201: {
               description: 'Request created',
               type: 'object',
               properties: {
                 id: { type: 'integer' },
                 venueId: { type: 'string', format: 'uuid' },
                 venueName: { type: 'string' },
                 artist: { type: 'string' },
                 title: { type: 'string' },
                 requestedAt: { type: 'string', format: 'date-time' },
               },
             },
             404: {
               description: 'Venue not found',
             },
             422: {
               description: 'Venue not accepting requests',
             },
             429: {
               description: 'Rate limit exceeded',
             },
           },
         },
         preHandler: [validateBody(PublicRequestSchema)],
         config: {
           rateLimit: {
             max: 10,
             timeWindow: '1 hour',
           },
         },
       },
       async (request, reply) => {
         const body = request.body as z.infer<typeof PublicRequestSchema>;

         try {
           const result = await requestService.createRequest({
             venueId: body.venueId,
             artist: body.artist,
             title: body.title,
             keyChange: body.keyChange,
             notes: body.notes,
             guestName: body.guestName,
           });

           return reply.code(201).send(result);
         } catch (error) {
           if (error instanceof Error) {
             if (error.message.includes('not found')) {
               return reply.code(404).send({
                 type: 'resource_not_found',
                 title: 'Venue Not Found',
                 detail: error.message,
               });
             }

             if (error.message.includes('rate limit')) {
               return reply.code(429).send({
                 type: 'rate_limited',
                 title: 'Too Many Requests',
                 detail: error.message,
               });
             }

             if (error.message.includes('not accepting')) {
               return reply.code(422).send({
                 type: 'unprocessable_entity',
                 title: 'Requests Not Accepted',
                 detail: error.message,
               });
             }
           }

           throw error;
         }
       }
     );
   };
   ```

4. **Register all public routes in `apps/api/src/routes/public/index.ts`:**
   ```typescript
   import { FastifyPluginAsync } from 'fastify';
   import { venuesRoute } from './venues';
   import { songsRoute } from './songs';
   import { requestsRoute } from './requests';

   export const publicRoutes: FastifyPluginAsync = async (server) => {
     await server.register(venuesRoute);
     await server.register(songsRoute);
     await server.register(requestsRoute);
   };
   ```

**Deliverables:**
- ✅ `POST /v1/public/requests` - Anonymous request submission
- ✅ Venue validation and accepting_requests check
- ✅ Rate limiting: 10 req/hour per IP, 50 req/hour per venue
- ✅ Request history tracking for authenticated users
- ✅ Guest name capture for anonymous users
- ✅ Proper error handling with Problem+JSON

---

---
