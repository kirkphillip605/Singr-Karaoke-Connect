# Singr Central API Backend - Phase 7

**Document Version:** 1.0  
**Last Updated:** 2025-11-12  
**Author:** kirkphillip605  
**Status:** In Development

---

## Phase 7: Singer History, Favorites & Personalization

### 7.1 Request History Management

**Objective:** Track and display singer's request history across all venues.

**Duration:** 2 days  
**Team Size:** 1 developer

**Tasks:**

1. **Create history schemas in `apps/api/src/routes/singer/schemas.ts`:**
   ```typescript
   // Add to existing schemas
   export const RequestHistoryQuerySchema = PaginationSchema.extend({
     venueId: z.string().uuid().optional(),
     startDate: z.string().datetime().optional(),
     endDate: z.string().datetime().optional(),
     artist: z.string().max(100).optional(),
     title: z.string().max(100).optional(),
   });

   export const RequestHistoryItemSchema = z.object({
     id: z.string().uuid(),
     venueId: z.string().uuid(),
     venueName: z.string(),
     venueUrlName: z.string(),
     artist: z.string(),
     title: z.string(),
     keyChange: z.number(),
     requestedAt: z.string().datetime(),
     requestCount: z.number(),
   });

   export const RequestStatsSchema = z.object({
     totalRequests: z.number(),
     uniqueSongs: z.number(),
     uniqueVenues: z.number(),
     mostRequestedSong: z.object({
       artist: z.string(),
       title: z.string(),
       count: z.number(),
     }).nullable(),
     favoriteVenue: z.object({
       id: z.string().uuid(),
       name: z.string(),
       requestCount: z.number(),
     }).nullable(),
   });
   ```

2. **Create history service in `packages/shared/src/services/singer-history-service.ts`:**
   ```typescript
   import { PrismaClient } from '@prisma/database';
   import { createLogger } from '@singr/observability';

   const logger = createLogger('services:singer-history');

   export interface HistoryFilters {
     venueId?: string;
     startDate?: Date;
     endDate?: Date;
     artist?: string;
     title?: string;
   }

   export class SingerHistoryService {
     constructor(private prisma: PrismaClient) {}

     async getRequestHistory(
       singerProfileId: string,
       filters: HistoryFilters,
       pagination: { page: number; limit: number }
     ) {
       const where: any = { singerProfileId };

       if (filters.venueId) {
         where.venueId = filters.venueId;
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

       if (filters.artist) {
         where.artist = { contains: filters.artist, mode: 'insensitive' };
       }

       if (filters.title) {
         where.title = { contains: filters.title, mode: 'insensitive' };
       }

       const [history, total] = await Promise.all([
         this.prisma.singerRequestHistory.findMany({
           where,
           skip: (pagination.page - 1) * pagination.limit,
           take: pagination.limit,
           orderBy: { requestedAt: 'desc' },
           include: {
             venue: {
               select: {
                 id: true,
                 name: true,
                 urlName: true,
               },
             },
           },
         }),
         this.prisma.singerRequestHistory.count({ where }),
       ]);

       return {
         data: history.map((h) => ({
           id: h.id,
           venueId: h.venueId,
           venueName: h.venue.name,
           venueUrlName: h.venue.urlName,
           artist: h.artist,
           title: h.title,
           keyChange: h.keyChange,
           requestedAt: h.requestedAt.toISOString(),
         })),
         pagination: {
           page: pagination.page,
           limit: pagination.limit,
           total,
           totalPages: Math.ceil(total / pagination.limit),
         },
       };
     }

     async getRequestStats(singerProfileId: string) {
       // Total requests
       const totalRequests = await this.prisma.singerRequestHistory.count({
         where: { singerProfileId },
       });

       // Unique songs (by fingerprint)
       const uniqueSongs = await this.prisma.singerRequestHistory.groupBy({
         by: ['songFingerprint'],
         where: { singerProfileId },
       });

       // Unique venues
       const uniqueVenues = await this.prisma.singerRequestHistory.groupBy({
         by: ['venueId'],
         where: { singerProfileId },
       });

       // Most requested song
       const songCounts = await this.prisma.singerRequestHistory.groupBy({
         by: ['artist', 'title'],
         where: { singerProfileId },
         _count: { id: true },
         orderBy: { _count: { id: 'desc' } },
         take: 1,
       });

       const mostRequestedSong = songCounts[0]
         ? {
             artist: songCounts[0].artist,
             title: songCounts[0].title,
             count: songCounts[0]._count.id,
           }
         : null;

       // Favorite venue (most requests)
       const venueCounts = await this.prisma.singerRequestHistory.groupBy({
         by: ['venueId'],
         where: { singerProfileId },
         _count: { id: true },
         orderBy: { _count: { id: 'desc' } },
         take: 1,
       });

       let favoriteVenue = null;
       if (venueCounts[0]) {
         const venue = await this.prisma.venue.findUnique({
           where: { id: venueCounts[0].venueId },
           select: { id: true, name: true },
         });

         if (venue) {
           favoriteVenue = {
             id: venue.id,
             name: venue.name,
             requestCount: venueCounts[0]._count.id,
           };
         }
       }

       logger.debug(
         {
           singerProfileId,
           totalRequests,
           uniqueSongs: uniqueSongs.length,
           uniqueVenues: uniqueVenues.length,
         },
         'Request stats calculated'
       );

       return {
         totalRequests,
         uniqueSongs: uniqueSongs.length,
         uniqueVenues: uniqueVenues.length,
         mostRequestedSong,
         favoriteVenue,
       };
     }

     async deleteHistory(singerProfileId: string, historyId: string) {
       const history = await this.prisma.singerRequestHistory.findFirst({
         where: {
           id: historyId,
           singerProfileId,
         },
       });

       if (!history) {
         throw new Error('History item not found');
       }

       await this.prisma.singerRequestHistory.delete({
         where: { id: historyId },
       });

       logger.info({ singerProfileId, historyId }, 'History item deleted');
     }

     async clearHistory(
       singerProfileId: string,
       beforeDate?: Date
     ): Promise<number> {
       const where: any = { singerProfileId };

       if (beforeDate) {
         where.requestedAt = { lt: beforeDate };
       }

       const result = await this.prisma.singerRequestHistory.deleteMany({
         where,
       });

       logger.info(
         {
           singerProfileId,
           count: result.count,
           beforeDate,
         },
         'History cleared'
       );

       return result.count;
     }
   }
   ```

3. **Implement history routes in `apps/api/src/routes/singer/history.ts`:**
   ```typescript
   import { FastifyPluginAsync } from 'fastify';
   import { validateQuery, validateParams } from '@singr/shared/validation';
   import { RequestHistoryQuerySchema } from './schemas';
   import { SingerHistoryService } from '@singr/shared/services/singer-history-service';
   import { createLogger } from '@singr/observability';

   const logger = createLogger('routes:singer:history');

   export const historyRoute: FastifyPluginAsync = async (server) => {
     const historyService = new SingerHistoryService(server.prisma);

     // Get request history
     server.get(
       '/history',
       {
         schema: {
           tags: ['singer'],
           summary: 'Get request history',
           description: 'Retrieve singer request history with filters',
           security: [{ bearerAuth: [] }],
           querystring: {
             type: 'object',
             properties: {
               page: { type: 'integer', minimum: 1, default: 1 },
               limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
               venueId: { type: 'string', format: 'uuid' },
               startDate: { type: 'string', format: 'date-time' },
               endDate: { type: 'string', format: 'date-time' },
               artist: { type: 'string' },
               title: { type: 'string' },
             },
           },
           response: {
             200: {
               description: 'Request history',
               type: 'object',
               properties: {
                 data: {
                   type: 'array',
                   items: {
                     type: 'object',
                     properties: {
                       id: { type: 'string', format: 'uuid' },
                       venueId: { type: 'string', format: 'uuid' },
                       venueName: { type: 'string' },
                       artist: { type: 'string' },
                       title: { type: 'string' },
                       keyChange: { type: 'integer' },
                       requestedAt: { type: 'string', format: 'date-time' },
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
         preHandler: [server.authenticate, validateQuery(RequestHistoryQuerySchema)],
       },
       async (request, reply) => {
         const query = request.query as z.infer<typeof RequestHistoryQuerySchema>;
         const userId = request.user.sub;

         const singerProfile = await server.prisma.singerProfile.findUnique({
           where: { userId },
         });

         if (!singerProfile) {
           return reply.code(404).send({
             type: 'resource_not_found',
             title: 'Singer Profile Not Found',
             detail: 'No singer profile found for this user',
           });
         }

         const { page, limit, startDate, endDate, ...filters } = query;

         const result = await historyService.getRequestHistory(
           singerProfile.id,
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

     // Get request statistics
     server.get(
       '/history/stats',
       {
         schema: {
           tags: ['singer'],
           summary: 'Get request statistics',
           description: 'Retrieve statistics about singer request history',
           security: [{ bearerAuth: [] }],
           response: {
             200: {
               description: 'Request statistics',
               type: 'object',
               properties: {
                 totalRequests: { type: 'integer' },
                 uniqueSongs: { type: 'integer' },
                 uniqueVenues: { type: 'integer' },
                 mostRequestedSong: {
                   type: 'object',
                   properties: {
                     artist: { type: 'string' },
                     title: { type: 'string' },
                     count: { type: 'integer' },
                   },
                 },
                 favoriteVenue: {
                   type: 'object',
                   properties: {
                     id: { type: 'string', format: 'uuid' },
                     name: { type: 'string' },
                     requestCount: { type: 'integer' },
                   },
                 },
               },
             },
           },
         },
         preHandler: [server.authenticate],
       },
       async (request, reply) => {
         const userId = request.user.sub;

         const singerProfile = await server.prisma.singerProfile.findUnique({
           where: { userId },
         });

         if (!singerProfile) {
           return reply.code(404).send({
             type: 'resource_not_found',
             title: 'Singer Profile Not Found',
             detail: 'No singer profile found for this user',
           });
         }

         const stats = await historyService.getRequestStats(singerProfile.id);

         return reply.send(stats);
       }
     );

     // Delete single history item
     server.delete(
       '/history/:id',
       {
         schema: {
           tags: ['singer'],
           summary: 'Delete history item',
           description: 'Delete a single request from history',
           security: [{ bearerAuth: [] }],
           params: {
             type: 'object',
             properties: {
               id: { type: 'string', format: 'uuid' },
             },
           },
           response: {
             204: {
               description: 'History item deleted',
             },
             404: {
               description: 'History item not found',
             },
           },
         },
         preHandler: [
           server.authenticate,
           validateParams(z.object({ id: z.string().uuid() })),
         ],
       },
       async (request, reply) => {
         const { id } = request.params as { id: string };
         const userId = request.user.sub;

         const singerProfile = await server.prisma.singerProfile.findUnique({
           where: { userId },
         });

         if (!singerProfile) {
           return reply.code(404).send({
             type: 'resource_not_found',
             title: 'Singer Profile Not Found',
             detail: 'No singer profile found for this user',
           });
         }

         try {
           await historyService.deleteHistory(singerProfile.id, id);
           return reply.code(204).send();
         } catch (error) {
           if (error instanceof Error && error.message.includes('not found')) {
             return reply.code(404).send({
               type: 'resource_not_found',
               title: 'History Item Not Found',
               detail: 'History item not found or access denied',
             });
           }
           throw error;
         }
       }
     );

     // Clear all history or history before date
     server.delete(
       '/history',
       {
         schema: {
           tags: ['singer'],
           summary: 'Clear history',
           description: 'Clear all request history or history before a specific date',
           security: [{ bearerAuth: [] }],
           querystring: {
             type: 'object',
             properties: {
               beforeDate: { type: 'string', format: 'date-time' },
             },
           },
           response: {
             200: {
               description: 'History cleared',
               type: 'object',
               properties: {
                 deletedCount: { type: 'integer' },
               },
             },
           },
         },
         preHandler: [server.authenticate],
         config: {
           rateLimit: {
             max: 5,
             timeWindow: '1 hour',
           },
         },
       },
       async (request, reply) => {
         const { beforeDate } = request.query as { beforeDate?: string };
         const userId = request.user.sub;

         const singerProfile = await server.prisma.singerProfile.findUnique({
           where: { userId },
         });

         if (!singerProfile) {
           return reply.code(404).send({
             type: 'resource_not_found',
             title: 'Singer Profile Not Found',
             detail: 'No singer profile found for this user',
           });
         }

         const deletedCount = await historyService.clearHistory(
           singerProfile.id,
           beforeDate ? new Date(beforeDate) : undefined
         );

         return reply.send({ deletedCount });
       }
     );
   };
   ```

**Deliverables:**
- ✅ `GET /v1/singer/history` - Get request history with filters
- ✅ `GET /v1/singer/history/stats` - Get statistics (total requests, unique songs/venues, favorites)
- ✅ `DELETE /v1/singer/history/:id` - Delete single history item
- ✅ `DELETE /v1/singer/history` - Clear all or partial history
- ✅ Filter by venue, date range, artist, title
- ✅ Pagination support
- ✅ Most requested song calculation
- ✅ Favorite venue calculation
- ✅ Rate limiting on bulk delete

---

### 7.2 Favorite Songs Management

**Objective:** Allow singers to save and manage their favorite songs.

**Duration:** 2 days  
**Team Size:** 1 developer

**Tasks:**

1. **Create favorite songs schemas:**
   ```typescript
   // Add to apps/api/src/routes/singer/schemas.ts
   export const FavoriteSongQuerySchema = PaginationSchema.extend({
     artist: z.string().max(100).optional(),
     title: z.string().max(100).optional(),
     search: z.string().max(200).optional(),
   });

   export const AddFavoriteSongSchema = z.object({
     artist: z.string().min(1).max(255),
     title: z.string().min(1).max(255),
     keyChange: z.number().int().min(-12).max(12).default(0),
     metadata: z.record(z.any()).optional(),
   });

   export const UpdateFavoriteSongSchema = z.object({
     keyChange: z.number().int().min(-12).max(12).optional(),
     metadata: z.record(z.any()).optional(),
   });

   export const FavoriteSongResponseSchema = z.object({
     id: z.string().uuid(),
     artist: z.string(),
     title: z.string(),
     keyChange: z.number(),
     metadata: z.record(z.any()),
     createdAt: z.string().datetime(),
     updatedAt: z.string().datetime(),
   });
   ```

2. **Create favorite songs service in `packages/shared/src/services/favorite-songs-service.ts`:**
   ```typescript
   import { PrismaClient } from '@prisma/database';
   import { createLogger } from '@singr/observability';

   const logger = createLogger('services:favorite-songs');

   export interface FavoriteSongFilters {
     artist?: string;
     title?: string;
     search?: string;
   }

   export interface AddFavoriteSongInput {
     singerProfileId: string;
     artist: string;
     title: string;
     keyChange?: number;
     metadata?: Record<string, any>;
   }

   export class FavoriteSongsService {
     constructor(private prisma: PrismaClient) {}

     async listFavoriteSongs(
       singerProfileId: string,
       filters: FavoriteSongFilters,
       pagination: { page: number; limit: number }
     ) {
       const where: any = { singerProfileId };

       if (filters.artist) {
         where.artist = { contains: filters.artist, mode: 'insensitive' };
       }

       if (filters.title) {
         where.title = { contains: filters.title, mode: 'insensitive' };
       }

       if (filters.search) {
         where.OR = [
           { artist: { contains: filters.search, mode: 'insensitive' } },
           { title: { contains: filters.search, mode: 'insensitive' } },
         ];
       }

       const [favorites, total] = await Promise.all([
         this.prisma.singerFavoriteSong.findMany({
           where,
           skip: (pagination.page - 1) * pagination.limit,
           take: pagination.limit,
           orderBy: [{ artist: 'asc' }, { title: 'asc' }],
         }),
         this.prisma.singerFavoriteSong.count({ where }),
       ]);

       return {
         data: favorites.map((f) => ({
           id: f.id,
           artist: f.artist || '',
           title: f.title || '',
           keyChange: f.keyChange,
           metadata: f.metadata || {},
           createdAt: f.createdAt.toISOString(),
           updatedAt: f.updatedAt.toISOString(),
         })),
         pagination: {
           page: pagination.page,
           limit: pagination.limit,
           total,
           totalPages: Math.ceil(total / pagination.limit),
         },
       };
     }

     async addFavoriteSong(input: AddFavoriteSongInput) {
       // Check if already exists
       const existing = await this.prisma.singerFavoriteSong.findFirst({
         where: {
           singerProfileId: input.singerProfileId,
           artist: input.artist,
           title: input.title,
           keyChange: input.keyChange || 0,
         },
       });

       if (existing) {
         throw new Error('This song is already in your favorites');
       }

       const favorite = await this.prisma.singerFavoriteSong.create({
         data: {
           singerProfileId: input.singerProfileId,
           artist: input.artist,
           title: input.title,
           keyChange: input.keyChange || 0,
           metadata: input.metadata || {},
         },
       });

       logger.info(
         {
           singerProfileId: input.singerProfileId,
           favoriteId: favorite.id,
           artist: input.artist,
           title: input.title,
         },
         'Favorite song added'
       );

       return {
         id: favorite.id,
         artist: favorite.artist || '',
         title: favorite.title || '',
         keyChange: favorite.keyChange,
         metadata: favorite.metadata || {},
         createdAt: favorite.createdAt.toISOString(),
         updatedAt: favorite.updatedAt.toISOString(),
       };
     }

     async updateFavoriteSong(
       favoriteId: string,
       singerProfileId: string,
       input: { keyChange?: number; metadata?: Record<string, any> }
     ) {
       const favorite = await this.prisma.singerFavoriteSong.findFirst({
         where: {
           id: favoriteId,
           singerProfileId,
         },
       });

       if (!favorite) {
         throw new Error('Favorite song not found');
       }

       const updated = await this.prisma.singerFavoriteSong.update({
         where: { id: favoriteId },
         data: {
           keyChange: input.keyChange,
           metadata: input.metadata
             ? { ...favorite.metadata, ...input.metadata }
             : undefined,
         },
       });

       logger.info(
         {
           singerProfileId,
           favoriteId,
         },
         'Favorite song updated'
       );

       return {
         id: updated.id,
         artist: updated.artist || '',
         title: updated.title || '',
         keyChange: updated.keyChange,
         metadata: updated.metadata || {},
         createdAt: updated.createdAt.toISOString(),
         updatedAt: updated.updatedAt.toISOString(),
       };
     }

     async deleteFavoriteSong(favoriteId: string, singerProfileId: string) {
       const favorite = await this.prisma.singerFavoriteSong.findFirst({
         where: {
           id: favoriteId,
           singerProfileId,
         },
       });

       if (!favorite) {
         throw new Error('Favorite song not found');
       }

       await this.prisma.singerFavoriteSong.delete({
         where: { id: favoriteId },
       });

       logger.info({ singerProfileId, favoriteId }, 'Favorite song deleted');
     }

     async getFavoriteSong(favoriteId: string, singerProfileId: string) {
       const favorite = await this.prisma.singerFavoriteSong.findFirst({
         where: {
           id: favoriteId,
           singerProfileId,
         },
       });

       if (!favorite) {
         throw new Error('Favorite song not found');
       }

       return {
         id: favorite.id,
         artist: favorite.artist || '',
         title: favorite.title || '',
         keyChange: favorite.keyChange,
         metadata: favorite.metadata || {},
         createdAt: favorite.createdAt.toISOString(),
         updatedAt: favorite.updatedAt.toISOString(),
       };
     }
   }
   ```

3. **Implement favorite songs routes in `apps/api/src/routes/singer/favorites.ts`:**
   ```typescript
   import { FastifyPluginAsync } from 'fastify';
   import { validateQuery, validateParams, validateBody } from '@singr/shared/validation';
   import {
     FavoriteSongQuerySchema,
     AddFavoriteSongSchema,
     UpdateFavoriteSongSchema,
   } from './schemas';
   import { FavoriteSongsService } from '@singr/shared/services/favorite-songs-service';
   import { createLogger } from '@singr/observability';

   const logger = createLogger('routes:singer:favorites');

   export const favoritesRoute: FastifyPluginAsync = async (server) => {
     const favoritesService = new FavoriteSongsService(server.prisma);

     // List favorite songs
     server.get(
       '/favorites/songs',
       {
         schema: {
           tags: ['singer'],
           summary: 'List favorite songs',
           description: 'Get all favorite songs with filters',
           security: [{ bearerAuth: [] }],
           querystring: {
             type: 'object',
             properties: {
               page: { type: 'integer', minimum: 1, default: 1 },
               limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
               artist: { type: 'string' },
               title: { type: 'string' },
               search: { type: 'string' },
             },
           },
           response: {
             200: {
               description: 'Favorite songs',
               type: 'object',
               properties: {
                 data: {
                   type: 'array',
                   items: {
                     type: 'object',
                     properties: {
                       id: { type: 'string', format: 'uuid' },
                       artist: { type: 'string' },
                       title: { type: 'string' },
                       keyChange: { type: 'integer' },
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
         preHandler: [server.authenticate, validateQuery(FavoriteSongQuerySchema)],
       },
       async (request, reply) => {
         const query = request.query as z.infer<typeof FavoriteSongQuerySchema>;
         const userId = request.user.sub;

         const singerProfile = await server.prisma.singerProfile.findUnique({
           where: { userId },
         });

         if (!singerProfile) {
           return reply.code(404).send({
             type: 'resource_not_found',
             title: 'Singer Profile Not Found',
             detail: 'No singer profile found for this user',
           });
         }

         const { page, limit, ...filters } = query;

         const result = await favoritesService.listFavoriteSongs(
           singerProfile.id,
           filters,
           { page, limit }
         );

         return reply.send(result);
       }
     );

     // Add favorite song
     server.post(
       '/favorites/songs',
       {
         schema: {
           tags: ['singer'],
           summary: 'Add favorite song',
           description: 'Add a song to favorites',
           security: [{ bearerAuth: [] }],
           body: {
             type: 'object',
             required: ['artist', 'title'],
             properties: {
               artist: { type: 'string', minLength: 1, maxLength: 255 },
               title: { type: 'string', minLength: 1, maxLength: 255 },
               keyChange: { type: 'integer', minimum: -12, maximum: 12, default: 0 },
               metadata: { type: 'object' },
             },
           },
           response: {
             201: {
               description: 'Favorite song added',
               type: 'object',
               properties: {
                 id: { type: 'string', format: 'uuid' },
                 artist: { type: 'string' },
                 title: { type: 'string' },
                 keyChange: { type: 'integer' },
               },
             },
             409: {
               description: 'Song already in favorites',
             },
           },
         },
         preHandler: [server.authenticate, validateBody(AddFavoriteSongSchema)],
       },
       async (request, reply) => {
         const body = request.body as z.infer<typeof AddFavoriteSongSchema>;
         const userId = request.user.sub;

         const singerProfile = await server.prisma.singerProfile.findUnique({
           where: { userId },
         });

         if (!singerProfile) {
           return reply.code(404).send({
             type: 'resource_not_found',
             title: 'Singer Profile Not Found',
             detail: 'No singer profile found for this user',
           });
         }

         try {
           const favorite = await favoritesService.addFavoriteSong({
             singerProfileId: singerProfile.id,
             ...body,
           });

           return reply.code(201).send(favorite);
         } catch (error) {
           if (error instanceof Error && error.message.includes('already in')) {
             return reply.code(409).send({
               type: 'conflict',
               title: 'Already in Favorites',
               detail: error.message,
             });
           }
           throw error;
         }
       }
     );

     // Get favorite song details
     server.get(
       '/favorites/songs/:id',
       {
         schema: {
           tags: ['singer'],
           summary: 'Get favorite song',
           description: 'Get details of a specific favorite song',
           security: [{ bearerAuth: [] }],
           params: {
             type: 'object',
             properties: {
               id: { type: 'string', format: 'uuid' },
             },
           },
           response: {
             200: {
               description: 'Favorite song details',
               type: 'object',
               properties: {
                 id: { type: 'string', format: 'uuid' },
                 artist: { type: 'string' },
                 title: { type: 'string' },
                 keyChange: { type: 'integer' },
                 metadata: { type: 'object' },
               },
             },
             404: {
               description: 'Favorite song not found',
             },
           },
         },
         preHandler: [
           server.authenticate,
           validateParams(z.object({ id: z.string().uuid() })),
         ],
       },
       async (request, reply) => {
         const { id } = request.params as { id: string };
         const userId = request.user.sub;

         const singerProfile = await server.prisma.singerProfile.findUnique({
           where: { userId },
         });

         if (!singerProfile) {
           return reply.code(404).send({
             type: 'resource_not_found',
             title: 'Singer Profile Not Found',
             detail: 'No singer profile found for this user',
           });
         }

         try {
           const favorite = await favoritesService.getFavoriteSong(
             id,
             singerProfile.id
           );
           return reply.send(favorite);
         } catch (error) {
           if (error instanceof Error && error.message.includes('not found')) {
             return reply.code(404).send({
               type: 'resource_not_found',
               title: 'Favorite Not Found',
               detail: 'Favorite song not found or access denied',
             });
           }
           throw error;
         }
       }
     );

     // Update favorite song
     server.patch(
       '/favorites/songs/:id',
       {
         schema: {
           tags: ['singer'],
           summary: 'Update favorite song',
           description: 'Update key change or metadata for a favorite song',
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
               keyChange: { type: 'integer', minimum: -12, maximum: 12 },
               metadata: { type: 'object' },
             },
           },
           response: {
             200: {
               description: 'Favorite song updated',
               type: 'object',
               properties: {
                 id: { type: 'string', format: 'uuid' },
                 artist: { type: 'string' },
                 title: { type: 'string' },
                 keyChange: { type: 'integer' },
               },
             },
           },
         },
         preHandler: [
           server.authenticate,
           validateParams(z.object({ id: z.string().uuid() })),
           validateBody(UpdateFavoriteSongSchema),
         ],
       },
       async (request, reply) => {
         const { id } = request.params as { id: string };
         const body = request.body as z.infer<typeof UpdateFavoriteSongSchema>;
         const userId = request.user.sub;

         const singerProfile = await server.prisma.singerProfile.findUnique({
           where: { userId },
         });

         if (!singerProfile) {
           return reply.code(404).send({
             type: 'resource_not_found',
             title: 'Singer Profile Not Found',
             detail: 'No singer profile found for this user',
           });
         }

         try {
           const favorite = await favoritesService.updateFavoriteSong(
             id,
             singerProfile.id,
             body
           );
           return reply.send(favorite);
         } catch (error) {
           if (error instanceof Error && error.message.includes('not found')) {
             return reply.code(404).send({
               type: 'resource_not_found',
               title: 'Favorite Not Found',
               detail: 'Favorite song not found or access denied',
             });
           }
           throw error;
         }
       }
     );

     // Delete favorite song
     server.delete(
       '/favorites/songs/:id',
       {
         schema: {
           tags: ['singer'],
           summary: 'Delete favorite song',
           description: 'Remove a song from favorites',
           security: [{ bearerAuth: [] }],
           params: {
             type: 'object',
             properties: {
               id: { type: 'string', format: 'uuid' },
             },
           },
           response: {
             204: {
               description: 'Favorite song deleted',
             },
             404: {
               description: 'Favorite song not found',
             },
           },
         },
         preHandler: [
           server.authenticate,
           validateParams(z.object({ id: z.string().uuid() })),
         ],
       },
       async (request, reply) => {
         const { id } = request.params as { id: string };
         const userId = request.user.sub;

         const singerProfile = await server.prisma.singerProfile.findUnique({
           where: { userId },
         });

         if (!singerProfile) {
           return reply.code(404).send({
             type: 'resource_not_found',
             title: 'Singer Profile Not Found',
             detail: 'No singer profile found for this user',
           });
         }

         try {
           await favoritesService.deleteFavoriteSong(id, singerProfile.id);
           return reply.code(204).send();
         } catch (error) {
           if (error instanceof Error && error.message.includes('not found')) {
             return reply.code(404).send({
               type: 'resource_not_found',
               title: 'Favorite Not Found',
               detail: 'Favorite song not found or access denied',
             });
           }
           throw error;
         }
       }
     );
   };
   ```

**Deliverables:**
- ✅ `GET /v1/singer/favorites/songs` - List favorite songs with filters
- ✅ `POST /v1/singer/favorites/songs` - Add song to favorites
- ✅ `GET /v1/singer/favorites/songs/:id` - Get favorite song details
- ✅ `PATCH /v1/singer/favorites/songs/:id` - Update key change or metadata
- ✅ `DELETE /v1/singer/favorites/songs/:id` - Remove from favorites
- ✅ Search by artist, title, or combined
- ✅ Duplicate detection
- ✅ Metadata support for custom fields
- ✅ Pagination support

---

### 7.3 Favorite Venues Management

**Objective:** Allow singers to save and manage their favorite venues.

**Duration:** 1-2 days  
**Team Size:** 1 developer

**Tasks:**

1. **Create favorite venues schemas:**
   ```typescript
   // Add to apps/api/src/routes/singer/schemas.ts
   export const FavoriteVenueQuerySchema = PaginationSchema.extend({
     city: z.string().max(100).optional(),
     state: z.string().max(50).optional(),
     search: z.string().max(100).optional(),
   });

   export const AddFavoriteVenueSchema = z.object({
     venueId: z.string().uuid(),
   });

   export const FavoriteVenueResponseSchema = z.object({
     venueId: z.string().uuid(),
     venueName: z.string(),
     venueUrlName: z.string(),
     address: z.string(),
     city: z.string(),
     state: z.string(),
     postalCode: z.string(),
     phoneNumber: z.string().nullable(),
     website: z.string().nullable(),
     acceptingRequests: z.boolean(),
     addedAt: z.string().datetime(),
   });
   ```

2. **Create favorite venues service in `packages/shared/src/services/favorite-venues-service.ts`:**
   ```typescript
   import { PrismaClient } from '@prisma/database';
   import { createLogger } from '@singr/observability';

   const logger = createLogger('services:favorite-venues');

   export interface FavoriteVenueFilters {
     city?: string;
     state?: string;
     search?: string;
   }

   export class FavoriteVenuesService {
     constructor(private prisma: PrismaClient) {}

     async listFavoriteVenues(
       singerProfileId: string,
       filters: FavoriteVenueFilters,
       pagination: { page: number; limit: number }
     ) {
       const where: any = { singerProfileId };

       // Build venue filters
       const venueWhere: any = {};

       if (filters.city) {
         venueWhere.city = { contains: filters.city, mode: 'insensitive' };
       }

       if (filters.state) {
         venueWhere.state = { equals: filters.state, mode: 'insensitive' };
       }

       if (filters.search) {
         venueWhere.name = { contains: filters.search, mode: 'insensitive' };
       }

       if (Object.keys(venueWhere).length > 0) {
         where.venue = venueWhere;
       }

       const [favorites, total] = await Promise.all([
         this.prisma.singerFavoriteVenue.findMany({
           where,
           skip: (pagination.page - 1) * pagination.limit,
           take: pagination.limit,
           orderBy: { createdAt: 'desc' },
           include: {
             venue: true,
           },
         }),
         this.prisma.singerFavoriteVenue.count({ where }),
       ]);

       return {
         data: favorites.map((f) => ({
           venueId: f.venueId,
           venueName: f.venue.name,
           venueUrlName: f.venue.urlName,
           address: f.venue.address,
           city: f.venue.city,
           state: f.venue.state,
           postalCode: f.venue.postalCode,
           phoneNumber: f.venue.phoneNumber,
           website: f.venue.website,
           acceptingRequests: f.venue.acceptingRequests,
           addedAt: f.createdAt.toISOString(),
         })),
         pagination: {
           page: pagination.page,
           limit: pagination.limit,
           total,
           totalPages: Math.ceil(total / pagination.limit),
         },
       };
     }

     async addFavoriteVenue(singerProfileId: string, venueId: string) {
       // Check if venue exists
       const venue = await this.prisma.venue.findUnique({
         where: { id: venueId },
       });

       if (!venue) {
         throw new Error('Venue not found');
       }

       // Check if already favorited
       const existing = await this.prisma.singerFavoriteVenue.findUnique({
         where: {
           singerProfileId_venueId: {
             singerProfileId,
             venueId,
           },
         },
       });

       if (existing) {
         throw new Error('Venue is already in your favorites');
       }

       const favorite = await this.prisma.singerFavoriteVenue.create({
         data: {
           singerProfileId,
           venueId,
         },
         include: {
           venue: true,
         },
       });

       logger.info(
         {
           singerProfileId,
           venueId,
           venueName: venue.name,
         },
         'Favorite venue added'
       );

       return {
         venueId: favorite.venueId,
         venueName: favorite.venue.name,
         venueUrlName: favorite.venue.urlName,
         address: favorite.venue.address,
         city: favorite.venue.city,
         state: favorite.venue.state,
         postalCode: favorite.venue.postalCode,
         phoneNumber: favorite.venue.phoneNumber,
         website: favorite.venue.website,
         acceptingRequests: favorite.venue.acceptingRequests,
         addedAt: favorite.createdAt.toISOString(),
       };
     }

     async removeFavoriteVenue(singerProfileId: string, venueId: string) {
       const favorite = await this.prisma.singerFavoriteVenue.findUnique({
         where: {
           singerProfileId_venueId: {
             singerProfileId,
             venueId,
           },
         },
       });

       if (!favorite) {
         throw new Error('Favorite venue not found');
       }

       await this.prisma.singerFavoriteVenue.delete({
         where: {
           singerProfileId_venueId: {
             singerProfileId,
             venueId,
           },
         },
       });

       logger.info({ singerProfileId, venueId }, 'Favorite venue removed');
     }

     async isFavorite(singerProfileId: string, venueId: string): Promise<boolean> {
       const favorite = await this.prisma.singerFavoriteVenue.findUnique({
         where: {
           singerProfileId_venueId: {
             singerProfileId,
             venueId,
           },
         },
       });

       return !!favorite;
     }

     async getFavoriteVenue(singerProfileId: string, venueId: string) {
       const favorite = await this.prisma.singerFavoriteVenue.findUnique({
         where: {
           singerProfileId_venueId: {
             singerProfileId,
             venueId,
           },
         },
         include: {
           venue: true,
         },
       });

       if (!favorite) {
         throw new Error('Favorite venue not found');
       }

       return {
         venueId: favorite.venueId,
         venueName: favorite.venue.name,
         venueUrlName: favorite.venue.urlName,
         address: favorite.venue.address,
         city: favorite.venue.city,
         state: favorite.venue.state,
         postalCode: favorite.venue.postalCode,
         phoneNumber: favorite.venue.phoneNumber,
         website: favorite.venue.website,
         acceptingRequests: favorite.venue.acceptingRequests,
         addedAt: favorite.createdAt.toISOString(),
       };
     }
   }
   ```

3. **Implement favorite venues routes in `apps/api/src/routes/singer/favorites.ts`:**
   ```typescript
   // Add to existing favoritesRoute

   // List favorite venues
   server.get(
     '/favorites/venues',
     {
       schema: {
         tags: ['singer'],
         summary: 'List favorite venues',
         description: 'Get all favorite venues with filters',
         security: [{ bearerAuth: [] }],
         querystring: {
           type: 'object',
           properties: {
             page: { type: 'integer', minimum: 1, default: 1 },
             limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
             city: { type: 'string' },
             state: { type: 'string' },
             search: { type: 'string' },
           },
         },
         response: {
           200: {
             description: 'Favorite venues',
             type: 'object',
             properties: {
               data: {
                 type: 'array',
                 items: {
                   type: 'object',
                   properties: {
                     venueId: { type: 'string', format: 'uuid' },
                     venueName: { type: 'string' },
                     venueUrlName: { type: 'string' },
                     city: { type: 'string' },
                     state: { type: 'string' },
                     acceptingRequests: { type: 'boolean' },
                     addedAt: { type: 'string', format: 'date-time' },
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
       preHandler: [server.authenticate, validateQuery(FavoriteVenueQuerySchema)],
     },
     async (request, reply) => {
       const query = request.query as z.infer<typeof FavoriteVenueQuerySchema>;
       const userId = request.user.sub;

       const singerProfile = await server.prisma.singerProfile.findUnique({
         where: { userId },
       });

       if (!singerProfile) {
         return reply.code(404).send({
           type: 'resource_not_found',
           title: 'Singer Profile Not Found',
           detail: 'No singer profile found for this user',
         });
       }

       const { page, limit, ...filters } = query;

       const favoriteVenuesService = new FavoriteVenuesService(server.prisma);
       const result = await favoriteVenuesService.listFavoriteVenues(
         singerProfile.id,
         filters,
         { page, limit }
       );

       return reply.send(result);
     }
   );

   // Add favorite venue
   server.post(
     '/favorites/venues',
     {
       schema: {
         tags: ['singer'],
         summary: 'Add favorite venue',
         description: 'Add a venue to favorites',
         security: [{ bearerAuth: [] }],
         body: {
           type: 'object',
           required: ['venueId'],
           properties: {
             venueId: { type: 'string', format: 'uuid' },
           },
         },
         response: {
           201: {
             description: 'Favorite venue added',
             type: 'object',
             properties: {
               venueId: { type: 'string', format: 'uuid' },
               venueName: { type: 'string' },
               venueUrlName: { type: 'string' },
               city: { type: 'string' },
               state: { type: 'string' },
               acceptingRequests: { type: 'boolean' },
               addedAt: { type: 'string', format: 'date-time' },
             },
           },
           404: {
             description: 'Venue not found',
           },
           409: {
             description: 'Venue already in favorites',
           },
         },
       },
       preHandler: [server.authenticate, validateBody(AddFavoriteVenueSchema)],
     },
     async (request, reply) => {
       const { venueId } = request.body as z.infer<typeof AddFavoriteVenueSchema>;
       const userId = request.user.sub;

       const singerProfile = await server.prisma.singerProfile.findUnique({
         where: { userId },
       });

       if (!singerProfile) {
         return reply.code(404).send({
           type: 'resource_not_found',
           title: 'Singer Profile Not Found',
           detail: 'No singer profile found for this user',
         });
       }

       const favoriteVenuesService = new FavoriteVenuesService(server.prisma);

       try {
         const favorite = await favoriteVenuesService.addFavoriteVenue(
           singerProfile.id,
           venueId
         );

         return reply.code(201).send(favorite);
       } catch (error) {
         if (error instanceof Error) {
           if (error.message.includes('not found')) {
             return reply.code(404).send({
               type: 'resource_not_found',
               title: 'Venue Not Found',
               detail: error.message,
             });
           }
           if (error.message.includes('already in')) {
             return reply.code(409).send({
               type: 'conflict',
               title: 'Already in Favorites',
               detail: error.message,
             });
           }
         }
         throw error;
       }
     }
   );

   // Get favorite venue details
   server.get(
     '/favorites/venues/:venueId',
     {
       schema: {
         tags: ['singer'],
         summary: 'Get favorite venue',
         description: 'Get details of a specific favorite venue',
         security: [{ bearerAuth: [] }],
         params: {
           type: 'object',
           properties: {
             venueId: { type: 'string', format: 'uuid' },
           },
         },
         response: {
           200: {
             description: 'Favorite venue details',
             type: 'object',
             properties: {
               venueId: { type: 'string', format: 'uuid' },
               venueName: { type: 'string' },
               venueUrlName: { type: 'string' },
               address: { type: 'string' },
               city: { type: 'string' },
               state: { type: 'string' },
               acceptingRequests: { type: 'boolean' },
               addedAt: { type: 'string', format: 'date-time' },
             },
           },
           404: {
             description: 'Favorite venue not found',
           },
         },
       },
       preHandler: [
         server.authenticate,
         validateParams(z.object({ venueId: z.string().uuid() })),
       ],
     },
     async (request, reply) => {
       const { venueId } = request.params as { venueId: string };
       const userId = request.user.sub;

       const singerProfile = await server.prisma.singerProfile.findUnique({
         where: { userId },
       });

       if (!singerProfile) {
         return reply.code(404).send({
           type: 'resource_not_found',
           title: 'Singer Profile Not Found',
           detail: 'No singer profile found for this user',
         });
       }

       const favoriteVenuesService = new FavoriteVenuesService(server.prisma);

       try {
         const favorite = await favoriteVenuesService.getFavoriteVenue(
           singerProfile.id,
           venueId
         );
         return reply.send(favorite);
       } catch (error) {
         if (error instanceof Error && error.message.includes('not found')) {
           return reply.code(404).send({
             type: 'resource_not_found',
             title: 'Favorite Not Found',
             detail: 'Favorite venue not found or access denied',
           });
         }
         throw error;
       }
     }
   );

   // Check if venue is favorite
   server.get(
     '/favorites/venues/:venueId/check',
     {
       schema: {
         tags: ['singer'],
         summary: 'Check if venue is favorite',
         description: 'Check if a venue is in favorites',
         security: [{ bearerAuth: [] }],
         params: {
           type: 'object',
           properties: {
             venueId: { type: 'string', format: 'uuid' },
           },
         },
         response: {
           200: {
             description: 'Favorite status',
             type: 'object',
             properties: {
               isFavorite: { type: 'boolean' },
             },
           },
         },
       },
       preHandler: [
         server.authenticate,
         validateParams(z.object({ venueId: z.string().uuid() })),
       ],
     },
     async (request, reply) => {
       const { venueId } = request.params as { venueId: string };
       const userId = request.user.sub;

       const singerProfile = await server.prisma.singerProfile.findUnique({
         where: { userId },
       });

       if (!singerProfile) {
         return reply.send({ isFavorite: false });
       }

       const favoriteVenuesService = new FavoriteVenuesService(server.prisma);
       const isFavorite = await favoriteVenuesService.isFavorite(
         singerProfile.id,
         venueId
       );

       return reply.send({ isFavorite });
     }
   );

   // Remove favorite venue
   server.delete(
     '/favorites/venues/:venueId',
     {
       schema: {
         tags: ['singer'],
         summary: 'Remove favorite venue',
         description: 'Remove a venue from favorites',
         security: [{ bearerAuth: [] }],
         params: {
           type: 'object',
           properties: {
             venueId: { type: 'string', format: 'uuid' },
           },
         },
         response: {
           204: {
             description: 'Favorite venue removed',
           },
           404: {
             description: 'Favorite venue not found',
           },
         },
       },
       preHandler: [
         server.authenticate,
         validateParams(z.object({ venueId: z.string().uuid() })),
       ],
     },
     async (request, reply) => {
       const { venueId } = request.params as { venueId: string };
       const userId = request.user.sub;

       const singerProfile = await server.prisma.singerProfile.findUnique({
         where: { userId },
       });

       if (!singerProfile) {
         return reply.code(404).send({
           type: 'resource_not_found',
           title: 'Singer Profile Not Found',
           detail: 'No singer profile found for this user',
         });
       }

       const favoriteVenuesService = new FavoriteVenuesService(server.prisma);

       try {
         await favoriteVenuesService.removeFavoriteVenue(
           singerProfile.id,
           venueId
         );
         return reply.code(204).send();
       } catch (error) {
         if (error instanceof Error && error.message.includes('not found')) {
           return reply.code(404).send({
             type: 'resource_not_found',
             title: 'Favorite Not Found',
             detail: 'Favorite venue not found or access denied',
           });
         }
         throw error;
       }
     }
   );
   ```

4. **Update singer routes index to include favorites and history:**
   ```typescript
   // Update apps/api/src/routes/singer/index.ts
   import { FastifyPluginAsync } from 'fastify';
   import { profileRoute } from './profile';
   import { requestsRoute } from './requests';
   import { accountRoute } from './account';
   import { historyRoute } from './history';
   import { favoritesRoute } from './favorites';

   export const singerRoutes: FastifyPluginAsync = async (server) => {
     await server.register(profileRoute);
     await server.register(requestsRoute);
     await server.register(accountRoute);
     await server.register(historyRoute);
     await server.register(favoritesRoute);
   };
   ```

**Deliverables:**
- ✅ `GET /v1/singer/favorites/venues` - List favorite venues with filters
- ✅ `POST /v1/singer/favorites/venues` - Add venue to favorites
- ✅ `GET /v1/singer/favorites/venues/:venueId` - Get favorite venue details
- ✅ `GET /v1/singer/favorites/venues/:venueId/check` - Check if venue is favorite
- ✅ `DELETE /v1/singer/favorites/venues/:venueId` - Remove from favorites
- ✅ Filter by city, state, or name
- ✅ Duplicate detection
- ✅ Pagination support
- ✅ Validation that venue exists before adding

---

### 7.4 Singer Dashboard & Recommendations

**Objective:** Provide personalized dashboard with quick actions and recommendations.

**Duration:** 2 days  
**Team Size:** 1 developer

**Tasks:**

1. **Create dashboard schemas:**
   ```typescript
   // Add to apps/api/src/routes/singer/schemas.ts
   export const DashboardResponseSchema = z.object({
     recentRequests: z.array(
       z.object({
         id: z.number(),
         venueId: z.string().uuid(),
         venueName: z.string(),
         artist: z.string(),
         title: z.string(),
         requestedAt: z.string().datetime(),
         processed: z.boolean(),
       })
     ),
     favoriteVenues: z.array(
       z.object({
         venueId: z.string().uuid(),
         venueName: z.string(),
         city: z.string(),
         state: z.string(),
         acceptingRequests: z.boolean(),
       })
     ),
     recommendedSongs: z.array(
       z.object({
         artist: z.string(),
         title: z.string(),
         requestCount: z.number(),
         lastRequested: z.string().datetime(),
       })
     ),
     stats: z.object({
       totalRequests: z.number(),
       totalFavoriteSongs: z.number(),
       totalFavoriteVenues: z.number(),
       requestsThisMonth: z.number(),
     }),
   });
   ```

2. **Create dashboard service in `packages/shared/src/services/singer-dashboard-service.ts`:**
   ```typescript
   import { PrismaClient } from '@prisma/database';
   import { createLogger } from '@singr/observability';

   const logger = createLogger('services:singer-dashboard');

   export class SingerDashboardService {
     constructor(private prisma: PrismaClient) {}

     async getDashboard(singerProfileId: string) {
       const now = new Date();
       const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

       // Recent requests (last 10)
       const recentRequests = await this.prisma.request.findMany({
         where: {
           singerProfileId,
         },
         take: 10,
         orderBy: { requestedAt: 'desc' },
         include: {
           venue: {
             select: {
               id: true,
               name: true,
             },
           },
         },
       });

       // Favorite venues (top 5 most recent)
       const favoriteVenues = await this.prisma.singerFavoriteVenue.findMany({
         where: { singerProfileId },
         take: 5,
         orderBy: { createdAt: 'desc' },
         include: {
           venue: {
             select: {
               id: true,
               name: true,
               city: true,
               state: true,
               acceptingRequests: true,
             },
           },
         },
       });

       // Recommended songs (based on request history - top 5)
       const recommendedSongs = await this.prisma.singerRequestHistory.groupBy({
         by: ['artist', 'title'],
         where: { singerProfileId },
         _count: { id: true },
         _max: { requestedAt: true },
         orderBy: { _count: { id: 'desc' } },
         take: 5,
       });

       // Stats
       const [
         totalRequests,
         totalFavoriteSongs,
         totalFavoriteVenues,
         requestsThisMonth,
       ] = await Promise.all([
         this.prisma.singerRequestHistory.count({
           where: { singerProfileId },
         }),
         this.prisma.singerFavoriteSong.count({
           where: { singerProfileId },
         }),
         this.prisma.singerFavoriteVenue.count({
           where: { singerProfileId },
         }),
         this.prisma.singerRequestHistory.count({
           where: {
             singerProfileId,
             requestedAt: { gte: startOfMonth },
           },
         }),
       ]);

       logger.debug({ singerProfileId }, 'Dashboard data retrieved');

       return {
         recentRequests: recentRequests.map((r) => ({
           id: Number(r.id),
           venueId: r.venueId,
           venueName: r.venue.name,
           artist: r.artist,
           title: r.title,
           requestedAt: r.requestedAt.toISOString(),
           processed: r.processed,
         })),
         favoriteVenues: favoriteVenues.map((fv) => ({
           venueId: fv.venue.id,
           venueName: fv.venue.name,
           city: fv.venue.city,
           state: fv.venue.state,
           acceptingRequests: fv.venue.acceptingRequests,
         })),
         recommendedSongs: recommendedSongs.map((rs) => ({
           artist: rs.artist,
           title: rs.title,
           requestCount: rs._count.id,
           lastRequested: rs._max.requestedAt?.toISOString() || '',
         })),
         stats: {
           totalRequests,
           totalFavoriteSongs,
           totalFavoriteVenues,
           requestsThisMonth,
         },
       };
     }

     async getQuickActions(singerProfileId: string) {
       // Get recent venues for quick request
       const recentVenues = await this.prisma.singerRequestHistory.groupBy({
         by: ['venueId'],
         where: { singerProfileId },
         _max: { requestedAt: true },
         orderBy: { _max: { requestedAt: 'desc' } },
         take: 3,
       });

       const venueIds = recentVenues.map((rv) => rv.venueId);
       const venues = await this.prisma.venue.findMany({
         where: {
           id: { in: venueIds },
           acceptingRequests: true,
         },
         select: {
           id: true,
           name: true,
           urlName: true,
           city: true,
           state: true,
         },
       });

       // Get favorite songs for quick request
       const favoriteSongs = await this.prisma.singerFavoriteSong.findMany({
         where: { singerProfileId },
         take: 5,
         orderBy: { updatedAt: 'desc' },
         select: {
           id: true,
           artist: true,
           title: true,
           keyChange: true,
         },
       });

       return {
         recentVenues: venues,
         favoriteSongs: favoriteSongs.map((fs) => ({
           id: fs.id,
           artist: fs.artist || '',
           title: fs.title || '',
           keyChange: fs.keyChange,
         })),
       };
     }
   }
   ```

3. **Implement dashboard route in `apps/api/src/routes/singer/dashboard.ts`:**
   ```typescript
   import { FastifyPluginAsync } from 'fastify';
   import { SingerDashboardService } from '@singr/shared/services/singer-dashboard-service';
   import { createLogger } from '@singr/observability';

   const logger = createLogger('routes:singer:dashboard');

   export const dashboardRoute: FastifyPluginAsync = async (server) => {
     const dashboardService = new SingerDashboardService(server.prisma);

     // Get dashboard data
     server.get(
       '/dashboard',
       {
         schema: {
           tags: ['singer'],
           summary: 'Get dashboard',
           description: 'Get personalized dashboard with recent activity and recommendations',
           security: [{ bearerAuth: [] }],
           response: {
             200: {
               description: 'Dashboard data',
               type: 'object',
               properties: {
                 recentRequests: {
                   type: 'array',
                   items: {
                     type: 'object',
                     properties: {
                       id: { type: 'integer' },
                       venueId: { type: 'string', format: 'uuid' },
                       venueName: { type: 'string' },
                       artist: { type: 'string' },
                       title: { type: 'string' },
                       requestedAt: { type: 'string', format: 'date-time' },
                       processed: { type: 'boolean' },
                     },
                   },
                 },
                 favoriteVenues: {
                   type: 'array',
                   items: {
                     type: 'object',
                     properties: {
                       venueId: { type: 'string', format: 'uuid' },
                       venueName: { type: 'string' },
                       city: { type: 'string' },
                       state: { type: 'string' },
                       acceptingRequests: { type: 'boolean' },
                     },
                   },
                 },
                 recommendedSongs: {
                   type: 'array',
                   items: {
                     type: 'object',
                     properties: {
                       artist: { type: 'string' },
                       title: { type: 'string' },
                       requestCount: { type: 'integer' },
                       lastRequested: { type: 'string', format: 'date-time' },
                     },
                   },
                 },
                 stats: {
                   type: 'object',
                   properties: {
                     totalRequests: { type: 'integer' },
                     totalFavoriteSongs: { type: 'integer' },
                     totalFavoriteVenues: { type: 'integer' },
                     requestsThisMonth: { type: 'integer' },
                   },
                 },
               },
             },
           },
         },
         preHandler: [server.authenticate],
       },
       async (request, reply) => {
         const userId = request.user.sub;

         const singerProfile = await server.prisma.singerProfile.findUnique({
           where: { userId },
         });

         if (!singerProfile) {
           return reply.code(404).send({
             type: 'resource_not_found',
             title: 'Singer Profile Not Found',
             detail: 'No singer profile found for this user',
           });
         }

         const dashboard = await dashboardService.getDashboard(singerProfile.id);

         return reply.send(dashboard);
       }
     );

     // Get quick actions
     server.get(
       '/dashboard/quick-actions',
       {
         schema: {
           tags: ['singer'],
           summary: 'Get quick actions',
           description: 'Get recent venues and favorite songs for quick request submission',
           security: [{ bearerAuth: [] }],
           response: {
             200: {
               description: 'Quick actions data',
               type: 'object',
               properties: {
                 recentVenues: {
                   type: 'array',
                   items: {
                     type: 'object',
                     properties: {
                       id: { type: 'string', format: 'uuid' },
                       name: { type: 'string' },
                       urlName: { type: 'string' },
                       city: { type: 'string' },
                       state: { type: 'string' },
                     },
                   },
                 },
                 favoriteSongs: {
                   type: 'array',
                   items: {
                     type: 'object',
                     properties: {
                       id: { type: 'string', format: 'uuid' },
                       artist: { type: 'string' },
                       title: { type: 'string' },
                       keyChange: { type: 'integer' },
                     },
                   },
                 },
               },
             },
           },
         },
         preHandler: [server.authenticate],
       },
       async (request, reply) => {
         const userId = request.user.sub;

         const singerProfile = await server.prisma.singerProfile.findUnique({
           where: { userId },
         });

         if (!singerProfile) {
           return reply.code(404).send({
             type: 'resource_not_found',
             title: 'Singer Profile Not Found',
             detail: 'No singer profile found for this user',
           });
         }

         const quickActions = await dashboardService.getQuickActions(
           singerProfile.id
         );

         return reply.send(quickActions);
       }
     );
   };
   ```

4. **Update singer routes to include dashboard:**
   ```typescript
   // Update apps/api/src/routes/singer/index.ts
   import { FastifyPluginAsync } from 'fastify';
   import { profileRoute } from './profile';
   import { requestsRoute } from './requests';
   import { accountRoute } from './account';
   import { historyRoute } from './history';
   import { favoritesRoute } from './favorites';
   import { dashboardRoute } from './dashboard';

   export const singerRoutes: FastifyPluginAsync = async (server) => {
     await server.register(profileRoute);
     await server.register(requestsRoute);
     await server.register(accountRoute);
     await server.register(historyRoute);
     await server.register(favoritesRoute);
     await server.register(dashboardRoute);
   };
   ```

**Deliverables:**
- ✅ `GET /v1/singer/dashboard` - Get personalized dashboard
- ✅ `GET /v1/singer/dashboard/quick-actions` - Get quick action data
- ✅ Recent requests (last 10)
- ✅ Favorite venues (top 5)
- ✅ Recommended songs based on history (top 5)
- ✅ Statistics (total requests, favorites, monthly requests)
- ✅ Recent venues for quick requests
- ✅ Favorite songs for quick requests

---

**End of Phase 7. Complete deliverables:**

### Phase 7 Summary

**Singer Personalization Features:**
- ✅ Request history with filters (venue, date, artist, title)
- ✅ Request statistics (total, unique songs/venues, most requested, favorite venue)
- ✅ Delete individual history items
- ✅ Clear all or partial history
- ✅ Favorite songs management (add, update, delete, list)
- ✅ Favorite venues management (add, remove, check, list)
- ✅ Personalized dashboard with recommendations
- ✅ Quick actions for fast request submission
- ✅ Search and filter capabilities
- ✅ Pagination on all list endpoints
- ✅ Duplicate detection for favorites
- ✅ Metadata support for custom fields on favorite songs

---
