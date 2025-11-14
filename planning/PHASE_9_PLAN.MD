# Singr Central API Backend - Phase 9

**Document Version:** 1.0  
**Last Updated:** 2025-11-12  
**Author:** kirkphillip605  
**Status:** In Development

---

## Phase 9: Customer Systems & Songdb Management

### 9.1 System Management

**Objective:** Allow customers to manage their karaoke systems.

**Tasks:**

1. **Create system schemas in `apps/api/src/routes/customer/schemas.ts`:**
   ```typescript
   // Add to existing schemas
   export const SystemListQuerySchema = PaginationSchema.extend({
     search: z.string().max(100).optional(),
   });

   export const CreateSystemSchema = z.object({
     name: z.string().min(1).max(255),
     configuration: z.record(z.any()).optional(),
   });

   export const UpdateSystemSchema = z.object({
     name: z.string().min(1).max(255).optional(),
     configuration: z.record(z.any()).optional(),
   });

   export const SystemParamsSchema = z.object({
     id: z.string().uuid(),
   });

   export const SystemResponseSchema = z.object({
     id: z.string().uuid(),
     openkjSystemId: z.number(),
     name: z.string(),
     configuration: z.record(z.any()),
     songCount: z.number(),
     createdAt: z.string().datetime(),
     updatedAt: z.string().datetime(),
   });
   ```

2. **Create system service in `packages/shared/src/services/customer-system-service.ts`:**
   ```typescript
   import { PrismaClient } from '@prisma/database';
   import { createLogger } from '@singr/observability';

   const logger = createLogger('services:customer-system');

   export interface SystemFilters {
     search?: string;
   }

   export interface CreateSystemInput {
     customerProfileId: string;
     name: string;
     configuration?: Record<string, any>;
   }

   export interface UpdateSystemInput {
     name?: string;
     configuration?: Record<string, any>;
   }

   export class CustomerSystemService {
     constructor(private prisma: PrismaClient) {}

     async listSystems(
       customerProfileId: string,
       filters: SystemFilters,
       pagination: { page: number; limit: number }
     ) {
       const where: any = { customerProfileId };

       if (filters.search) {
         where.name = { contains: filters.search, mode: 'insensitive' };
       }

       const [systems, total] = await Promise.all([
         this.prisma.system.findMany({
           where,
           skip: (pagination.page - 1) * pagination.limit,
           take: pagination.limit,
           orderBy: { name: 'asc' },
         }),
         this.prisma.system.count({ where }),
       ]);

       // Get song counts for each system
       const systemIds = systems.map((s) => s.openkjSystemId);
       const songCounts = await this.prisma.songDb.groupBy({
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
         data: systems.map((s) => ({
           id: s.id,
           openkjSystemId: s.openkjSystemId,
           name: s.name,
           configuration: s.configuration || {},
           songCount: songCountMap.get(s.openkjSystemId) || 0,
           createdAt: s.createdAt.toISOString(),
           updatedAt: s.updatedAt.toISOString(),
         })),
         pagination: {
           page: pagination.page,
           limit: pagination.limit,
           total,
           totalPages: Math.ceil(total / pagination.limit),
         },
       };
     }

     async getSystem(systemId: string, customerProfileId: string) {
       const system = await this.prisma.system.findFirst({
         where: {
           id: systemId,
           customerProfileId,
         },
       });

       if (!system) {
         throw new Error('System not found');
       }

       // Get song count
       const songCount = await this.prisma.songDb.count({
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
         createdAt: system.createdAt.toISOString(),
         updatedAt: system.updatedAt.toISOString(),
       };
     }

     async createSystem(input: CreateSystemInput) {
       // Get next openkjSystemId from state table
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

       const openkjSystemId = Number(state.serial);

       const system = await this.prisma.system.create({
         data: {
           customerProfileId: input.customerProfileId,
           openkjSystemId,
           name: input.name,
           configuration: input.configuration || {},
         },
       });

       logger.info(
         {
           systemId: system.id,
           customerProfileId: input.customerProfileId,
           openkjSystemId,
           name: input.name,
         },
         'System created'
       );

       return {
         id: system.id,
         openkjSystemId: system.openkjSystemId,
         name: system.name,
         configuration: system.configuration || {},
         songCount: 0,
         createdAt: system.createdAt.toISOString(),
         updatedAt: system.updatedAt.toISOString(),
       };
     }

     async updateSystem(
       systemId: string,
       customerProfileId: string,
       input: UpdateSystemInput
     ) {
       const system = await this.prisma.system.findFirst({
         where: {
           id: systemId,
           customerProfileId,
         },
       });

       if (!system) {
         throw new Error('System not found');
       }

       const updateData: any = {};

       if (input.name !== undefined) updateData.name = input.name;
       if (input.configuration !== undefined) {
         updateData.configuration = {
           ...system.configuration,
           ...input.configuration,
         };
       }

       const updated = await this.prisma.system.update({
         where: { id: systemId },
         data: updateData,
       });

       // Get song count
       const songCount = await this.prisma.songDb.count({
         where: {
           customerProfileId,
           openkjSystemId: updated.openkjSystemId,
         },
       });

       logger.info(
         {
           systemId,
           customerProfileId,
         },
         'System updated'
       );

       return {
         id: updated.id,
         openkjSystemId: updated.openkjSystemId,
         name: updated.name,
         configuration: updated.configuration || {},
         songCount,
         createdAt: updated.createdAt.toISOString(),
         updatedAt: updated.updatedAt.toISOString(),
       };
     }

     async deleteSystem(systemId: string, customerProfileId: string) {
       const system = await this.prisma.system.findFirst({
         where: {
           id: systemId,
           customerProfileId,
         },
       });

       if (!system) {
         throw new Error('System not found');
       }

       // Check if system has songs
       const songCount = await this.prisma.songDb.count({
         where: {
           customerProfileId,
           openkjSystemId: system.openkjSystemId,
         },
       });

       if (songCount > 0) {
         throw new Error(
           `Cannot delete system with ${songCount} songs. Please delete all songs first.`
         );
       }

       await this.prisma.system.delete({
         where: { id: systemId },
       });

       logger.info(
         {
           systemId,
           customerProfileId,
           name: system.name,
         },
         'System deleted'
       );
     }
   }
   ```

3. **Implement system routes in `apps/api/src/routes/customer/systems.ts`:**
   ```typescript
   import { FastifyPluginAsync } from 'fastify';
   import { validateQuery, validateParams, validateBody } from '@singr/shared/validation';
   import { requirePermission } from '@singr/auth';
   import {
     SystemListQuerySchema,
     CreateSystemSchema,
     UpdateSystemSchema,
     SystemParamsSchema,
   } from './schemas';
   import { CustomerSystemService } from '@singr/shared/services/customer-system-service';
   import { createLogger } from '@singr/observability';

   const logger = createLogger('routes:customer:systems');

   export const systemsRoute: FastifyPluginAsync = async (server) => {
     const systemService = new CustomerSystemService(server.prisma);

     // List systems
     server.get(
       '/systems',
       {
         schema: {
           tags: ['customer'],
           summary: 'List systems',
           description: 'Get all karaoke systems for the customer',
           security: [{ bearerAuth: [] }],
           querystring: {
             type: 'object',
             properties: {
               page: { type: 'integer', minimum: 1, default: 1 },
               limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
               search: { type: 'string' },
             },
           },
           response: {
             200: {
               description: 'List of systems',
               type: 'object',
               properties: {
                 data: {
                   type: 'array',
                   items: {
                     type: 'object',
                     properties: {
                       id: { type: 'string', format: 'uuid' },
                       openkjSystemId: { type: 'integer' },
                       name: { type: 'string' },
                       songCount: { type: 'integer' },
                       createdAt: { type: 'string', format: 'date-time' },
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
           requirePermission('systems:read'),
           validateQuery(SystemListQuerySchema),
         ],
       },
       async (request, reply) => {
         const query = request.query as z.infer<typeof SystemListQuerySchema>;
         const customerProfileId = request.user.activeContext?.id;

         if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
           return reply.code(403).send({
             type: 'authorization_denied',
             title: 'Customer Context Required',
             detail: 'You must be in a customer context to access this resource',
           });
         }

         const { page, limit, ...filters } = query;

         const result = await systemService.listSystems(
           customerProfileId,
           filters,
           { page, limit }
         );

         return reply.send(result);
       }
     );

     // Get system details
     server.get(
       '/systems/:id',
       {
         schema: {
           tags: ['customer'],
           summary: 'Get system',
           description: 'Get details of a specific system',
           security: [{ bearerAuth: [] }],
           params: {
             type: 'object',
             properties: {
               id: { type: 'string', format: 'uuid' },
             },
           },
           response: {
             200: {
               description: 'System details',
               type: 'object',
               properties: {
                 id: { type: 'string', format: 'uuid' },
                 openkjSystemId: { type: 'integer' },
                 name: { type: 'string' },
                 configuration: { type: 'object' },
                 songCount: { type: 'integer' },
                 createdAt: { type: 'string', format: 'date-time' },
               },
             },
             404: {
               description: 'System not found',
             },
           },
         },
         preHandler: [
           server.authenticate,
           requirePermission('systems:read'),
           validateParams(SystemParamsSchema),
         ],
       },
       async (request, reply) => {
         const { id } = request.params as z.infer<typeof SystemParamsSchema>;
         const customerProfileId = request.user.activeContext?.id;

         if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
           return reply.code(403).send({
             type: 'authorization_denied',
             title: 'Customer Context Required',
             detail: 'You must be in a customer context to access this resource',
           });
         }

         try {
           const system = await systemService.getSystem(id, customerProfileId);
           return reply.send(system);
         } catch (error) {
           if (error instanceof Error && error.message.includes('not found')) {
             return reply.code(404).send({
               type: 'resource_not_found',
               title: 'System Not Found',
               detail: 'System not found or access denied',
             });
           }
           throw error;
         }
       }
     );

     // Create system
     server.post(
       '/systems',
       {
         schema: {
           tags: ['customer'],
           summary: 'Create system',
           description: 'Create a new karaoke system',
           security: [{ bearerAuth: [] }],
           body: {
             type: 'object',
             required: ['name'],
             properties: {
               name: { type: 'string', minLength: 1, maxLength: 255 },
               configuration: { type: 'object' },
             },
           },
           response: {
             201: {
               description: 'System created',
               type: 'object',
               properties: {
                 id: { type: 'string', format: 'uuid' },
                 openkjSystemId: { type: 'integer' },
                 name: { type: 'string' },
                 songCount: { type: 'integer' },
               },
             },
           },
         },
         preHandler: [
           server.authenticate,
           requirePermission('systems:write'),
           validateBody(CreateSystemSchema),
         ],
       },
       async (request, reply) => {
         const body = request.body as z.infer<typeof CreateSystemSchema>;
         const customerProfileId = request.user.activeContext?.id;

         if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
           return reply.code(403).send({
             type: 'authorization_denied',
             title: 'Customer Context Required',
             detail: 'You must be in a customer context to create systems',
           });
         }

         const system = await systemService.createSystem({
           customerProfileId,
           ...body,
         });

         return reply.code(201).send(system);
       }
     );

     // Update system
     server.patch(
       '/systems/:id',
       {
         schema: {
           tags: ['customer'],
           summary: 'Update system',
           description: 'Update system information',
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
               configuration: { type: 'object' },
             },
           },
           response: {
             200: {
               description: 'System updated',
               type: 'object',
               properties: {
                 id: { type: 'string', format: 'uuid' },
                 name: { type: 'string' },
                 configuration: { type: 'object' },
               },
             },
             404: {
               description: 'System not found',
             },
           },
         },
         preHandler: [
           server.authenticate,
           requirePermission('systems:write'),
           validateParams(SystemParamsSchema),
           validateBody(UpdateSystemSchema),
         ],
       },
       async (request, reply) => {
         const { id } = request.params as z.infer<typeof SystemParamsSchema>;
         const body = request.body as z.infer<typeof UpdateSystemSchema>;
         const customerProfileId = request.user.activeContext?.id;

         if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
           return reply.code(403).send({
             type: 'authorization_denied',
             title: 'Customer Context Required',
             detail: 'You must be in a customer context to update systems',
           });
         }

         try {
           const system = await systemService.updateSystem(id, customerProfileId, body);
           return reply.send(system);
         } catch (error) {
           if (error instanceof Error && error.message.includes('not found')) {
             return reply.code(404).send({
               type: 'resource_not_found',
               title: 'System Not Found',
               detail: 'System not found or access denied',
             });
           }
           throw error;
         }
       }
     );

     // Delete system
     server.delete(
       '/systems/:id',
       {
         schema: {
           tags: ['customer'],
           summary: 'Delete system',
           description: 'Delete a system (must have no songs)',
           security: [{ bearerAuth: [] }],
           params: {
             type: 'object',
             properties: {
               id: { type: 'string', format: 'uuid' },
             },
           },
           response: {
             204: {
               description: 'System deleted',
             },
             404: {
               description: 'System not found',
             },
             409: {
               description: 'System has songs and cannot be deleted',
             },
           },
         },
         preHandler: [
           server.authenticate,
           requirePermission('systems:write'),
           validateParams(SystemParamsSchema),
         ],
       },
       async (request, reply) => {
         const { id } = request.params as z.infer<typeof SystemParamsSchema>;
         const customerProfileId = request.user.activeContext?.id;

         if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
           return reply.code(403).send({
             type: 'authorization_denied',
             title: 'Customer Context Required',
             detail: 'You must be in a customer context to delete systems',
           });
         }

         try {
           await systemService.deleteSystem(id, customerProfileId);
           return reply.code(204).send();
         } catch (error) {
           if (error instanceof Error) {
             if (error.message.includes('not found')) {
               return reply.code(404).send({
                 type: 'resource_not_found',
                 title: 'System Not Found',
                 detail: 'System not found or access denied',
               });
             }
             if (error.message.includes('Cannot delete')) {
               return reply.code(409).send({
                 type: 'conflict',
                 title: 'System Has Songs',
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

4. **Register systems route in `apps/api/src/routes/customer/index.ts`:**
   ```typescript
   import { FastifyPluginAsync } from 'fastify';
   import { venuesRoute } from './venues';
   import { systemsRoute } from './systems';

   export const customerRoutes: FastifyPluginAsync = async (server) => {
     await server.register(venuesRoute);
     await server.register(systemsRoute);
   };
   ```

**Deliverables:**
- ✅ `GET /v1/customer/systems` - List all systems
- ✅ `POST /v1/customer/systems` - Create new system
- ✅ `GET /v1/customer/systems/:id` - Get system details
- ✅ `PATCH /v1/customer/systems/:id` - Update system
- ✅ `DELETE /v1/customer/systems/:id` - Delete system (if no songs)
- ✅ Auto-increment openkjSystemId via state table
- ✅ Song count included in responses
- ✅ Configuration JSON storage
- ✅ Delete protection when songs exist
- ✅ RBAC permission checks (systems:read, systems:write)
- ✅ Customer context validation
- ✅ Search functionality
- ✅ Pagination support

---

### 9.2 Song Database Management

**Objective:** Allow customers to manage their song databases with bulk import/export capabilities.

**Duration:** 3-4 days  
**Team Size:** 1-2 developers

**Tasks:**

1. **Create songdb schemas in `apps/api/src/routes/customer/schemas.ts`:**
   ```typescript
   // Add to existing schemas
   export const SongDbQuerySchema = PaginationSchema.extend({
     systemId: z.string().uuid().optional(),
     search: z.string().max(200).optional(),
     artist: z.string().max(100).optional(),
     title: z.string().max(100).optional(),
     letter: z.string().length(1).optional(),
   });

   export const AddSongSchema = z.object({
     systemId: z.string().uuid(),
     artist: z.string().min(1).max(255),
     title: z.string().min(1).max(255),
   });

   export const BulkAddSongsSchema = z.object({
     systemId: z.string().uuid(),
     songs: z
       .array(
         z.object({
           artist: z.string().min(1).max(255),
           title: z.string().min(1).max(255),
         })
       )
       .min(1)
       .max(10000),
   });

   export const UpdateSongSchema = z.object({
     artist: z.string().min(1).max(255).optional(),
     title: z.string().min(1).max(255).optional(),
   });

   export const SongParamsSchema = z.object({
     id: z.coerce.number().int().positive(),
   });

   export const SongResponseSchema = z.object({
     id: z.number(),
     systemId: z.string().uuid(),
     systemName: z.string(),
     artist: z.string(),
     title: z.string(),
     combined: z.string(),
     createdAt: z.string().datetime(),
     updatedAt: z.string().datetime(),
   });

   export const ImportSongsSchema = z.object({
     systemId: z.string().uuid(),
     format: z.enum(['csv', 'json', 'txt']),
     data: z.string(),
   });
   ```

2. **Create song database service in `packages/shared/src/services/songdb-service.ts`:**
   ```typescript
   import { PrismaClient } from '@prisma/database';
   import { createLogger } from '@singr/observability';
   import Papa from 'papaparse';

   const logger = createLogger('services:songdb');

   export interface SongDbFilters {
     systemId?: string;
     search?: string;
     artist?: string;
     title?: string;
     letter?: string;
   }

   export interface AddSongInput {
     customerProfileId: string;
     systemId: string;
     artist: string;
     title: string;
   }

   export interface BulkAddSongsInput {
     customerProfileId: string;
     systemId: string;
     songs: Array<{ artist: string; title: string }>;
   }

   export class SongDbService {
     constructor(private prisma: PrismaClient) {}

     async listSongs(
       customerProfileId: string,
       filters: SongDbFilters,
       pagination: { page: number; limit: number }
     ) {
       const where: any = { customerProfileId };

       if (filters.systemId) {
         const system = await this.prisma.system.findFirst({
           where: {
             id: filters.systemId,
             customerProfileId,
           },
         });

         if (system) {
           where.openkjSystemId = system.openkjSystemId;
         }
       }

       if (filters.search) {
         where.normalizedCombined = {
           contains: filters.search.toLowerCase(),
           mode: 'insensitive' as const,
         };
       }

       if (filters.artist) {
         where.artist = { contains: filters.artist, mode: 'insensitive' as const };
       }

       if (filters.title) {
         where.title = { contains: filters.title, mode: 'insensitive' as const };
       }

       if (filters.letter) {
         where.artist = {
           ...where.artist,
           startsWith: filters.letter.toUpperCase(),
         };
       }

       const [songs, total] = await Promise.all([
         this.prisma.songDb.findMany({
           where,
           skip: (pagination.page - 1) * pagination.limit,
           take: pagination.limit,
           orderBy: [{ artist: 'asc' }, { title: 'asc' }],
         }),
         this.prisma.songDb.count({ where }),
       ]);

       // Get system names
       const systemIds = [...new Set(songs.map((s) => s.openkjSystemId))];
       const systems = await this.prisma.system.findMany({
         where: {
           customerProfileId,
           openkjSystemId: { in: systemIds },
         },
         select: {
           id: true,
           openkjSystemId: true,
           name: true,
         },
       });

       const systemMap = new Map(
         systems.map((s) => [s.openkjSystemId, { id: s.id, name: s.name }])
       );

       return {
         data: songs.map((s) => {
           const system = systemMap.get(s.openkjSystemId);
           return {
             id: Number(s.id),
             systemId: system?.id || '',
             systemName: system?.name || 'Unknown',
             artist: s.artist,
             title: s.title,
             combined: s.combined,
             createdAt: s.createdAt.toISOString(),
             updatedAt: s.updatedAt.toISOString(),
           };
         }),
         pagination: {
           page: pagination.page,
           limit: pagination.limit,
           total,
           totalPages: Math.ceil(total / pagination.limit),
         },
       };
     }

     async getSong(songId: number, customerProfileId: string) {
       const song = await this.prisma.songDb.findFirst({
         where: {
           id: BigInt(songId),
           customerProfileId,
         },
       });

       if (!song) {
         throw new Error('Song not found');
       }

       const system = await this.prisma.system.findFirst({
         where: {
           customerProfileId,
           openkjSystemId: song.openkjSystemId,
         },
       });

       return {
         id: Number(song.id),
         systemId: system?.id || '',
         systemName: system?.name || 'Unknown',
         artist: song.artist,
         title: song.title,
         combined: song.combined,
         createdAt: song.createdAt.toISOString(),
         updatedAt: song.updatedAt.toISOString(),
       };
     }

     async addSong(input: AddSongInput) {
       // Get system
       const system = await this.prisma.system.findFirst({
         where: {
           id: input.systemId,
           customerProfileId: input.customerProfileId,
         },
       });

       if (!system) {
         throw new Error('System not found');
       }

       const combined = `${input.artist} - ${input.title}`;
       const normalizedCombined = combined.toLowerCase();

       // Check for duplicates
       const existing = await this.prisma.songDb.findFirst({
         where: {
           customerProfileId: input.customerProfileId,
           openkjSystemId: system.openkjSystemId,
           normalizedCombined,
         },
       });

       if (existing) {
         throw new Error('Song already exists in this system');
       }

       const song = await this.prisma.songDb.create({
         data: {
           customerProfileId: input.customerProfileId,
           openkjSystemId: system.openkjSystemId,
           artist: input.artist,
           title: input.title,
           combined,
           normalizedCombined,
         },
       });

       logger.info(
         {
           songId: song.id,
           customerProfileId: input.customerProfileId,
           systemId: input.systemId,
           artist: input.artist,
           title: input.title,
         },
         'Song added'
       );

       return {
         id: Number(song.id),
         systemId: system.id,
         systemName: system.name,
         artist: song.artist,
         title: song.title,
         combined: song.combined,
         createdAt: song.createdAt.toISOString(),
         updatedAt: song.updatedAt.toISOString(),
       };
     }

     async bulkAddSongs(input: BulkAddSongsInput) {
       // Get system
       const system = await this.prisma.system.findFirst({
         where: {
           id: input.systemId,
           customerProfileId: input.customerProfileId,
         },
       });

       if (!system) {
         throw new Error('System not found');
       }

       // Prepare songs for insertion
       const songsToInsert = input.songs.map((s) => {
         const combined = `${s.artist} - ${s.title}`;
         return {
           customerProfileId: input.customerProfileId,
           openkjSystemId: system.openkjSystemId,
           artist: s.artist,
           title: s.title,
           combined,
           normalizedCombined: combined.toLowerCase(),
         };
       });

       // Use createMany with skipDuplicates
       const result = await this.prisma.songDb.createMany({
         data: songsToInsert,
         skipDuplicates: true,
       });

       logger.info(
         {
           customerProfileId: input.customerProfileId,
           systemId: input.systemId,
           requested: input.songs.length,
           inserted: result.count,
         },
         'Bulk songs added'
       );

       return {
         inserted: result.count,
         skipped: input.songs.length - result.count,
         total: input.songs.length,
       };
     }

     async updateSong(
       songId: number,
       customerProfileId: string,
       input: { artist?: string; title?: string }
     ) {
       const song = await this.prisma.songDb.findFirst({
         where: {
           id: BigInt(songId),
           customerProfileId,
         },
       });

       if (!song) {
         throw new Error('Song not found');
       }

       const artist = input.artist || song.artist;
       const title = input.title || song.title;
       const combined = `${artist} - ${title}`;
       const normalizedCombined = combined.toLowerCase();

       const updated = await this.prisma.songDb.update({
         where: { id: BigInt(songId) },
         data: {
           artist,
           title,
           combined,
           normalizedCombined,
         },
       });

       const system = await this.prisma.system.findFirst({
         where: {
           customerProfileId,
           openkjSystemId: updated.openkjSystemId,
         },
       });

       logger.info(
         {
           songId,
           customerProfileId,
         },
         'Song updated'
       );

       return {
         id: Number(updated.id),
         systemId: system?.id || '',
         systemName: system?.name || 'Unknown',
         artist: updated.artist,
         title: updated.title,
         combined: updated.combined,
         createdAt: updated.createdAt.toISOString(),
         updatedAt: updated.updatedAt.toISOString(),
       };
     }

     async deleteSong(songId: number, customerProfileId: string) {
       const song = await this.prisma.songDb.findFirst({
         where: {
           id: BigInt(songId),
           customerProfileId,
         },
       });

       if (!song) {
         throw new Error('Song not found');
       }

       await this.prisma.songDb.delete({
         where: { id: BigInt(songId) },
       });

       logger.info(
         {
           songId,
           customerProfileId,
           artist: song.artist,
           title: song.title,
         },
         'Song deleted'
       );
     }

     async bulkDeleteSongs(customerProfileId: string, systemId?: string) {
       const where: any = { customerProfileId };

       if (systemId) {
         const system = await this.prisma.system.findFirst({
           where: {
             id: systemId,
             customerProfileId,
           },
         });

         if (system) {
           where.openkjSystemId = system.openkjSystemId;
         }
       }

       const result = await this.prisma.songDb.deleteMany({ where });

       logger.info(
         {
           customerProfileId,
           systemId,
           count: result.count,
         },
         'Bulk songs deleted'
       );

       return result.count;
     }

     async importSongs(
       customerProfileId: string,
       systemId: string,
       format: 'csv' | 'json' | 'txt',
       data: string
     ) {
       // Get system
       const system = await this.prisma.system.findFirst({
         where: {
           id: systemId,
           customerProfileId,
         },
       });

       if (!system) {
         throw new Error('System not found');
       }

       let songs: Array<{ artist: string; title: string }> = [];

       if (format === 'csv') {
         // Parse CSV
         const parsed = Papa.parse<string[]>(data, {
           skipEmptyLines: true,
         });

         songs = parsed.data
           .filter((row) => row.length >= 2)
           .map((row) => ({
             artist: row[0].trim(),
             title: row[1].trim(),
           }))
           .filter((s) => s.artist && s.title);
       } else if (format === 'json') {
         // Parse JSON
         const parsed = JSON.parse(data);
         if (Array.isArray(parsed)) {
           songs = parsed
             .filter((s) => s.artist && s.title)
             .map((s) => ({
               artist: String(s.artist).trim(),
               title: String(s.title).trim(),
             }));
         }
       } else if (format === 'txt') {
         // Parse text (one song per line, format: "Artist - Title")
         const lines = data.split('\n');
         songs = lines
           .map((line) => {
             const parts = line.split('-').map((p) => p.trim());
             if (parts.length >= 2) {
               return {
                 artist: parts[0],
                 title: parts.slice(1).join('-').trim(),
               };
             }
             return null;
           })
           .filter((s): s is { artist: string; title: string } => s !== null);
       }

       if (songs.length === 0) {
         throw new Error('No valid songs found in import data');
       }

       // Bulk add songs
       const result = await this.bulkAddSongs({
         customerProfileId,
         systemId,
         songs,
       });

       logger.info(
         {
           customerProfileId,
           systemId,
           format,
           parsed: songs.length,
           inserted: result.inserted,
         },
         'Songs imported'
       );

       return result;
     }

     async exportSongs(
       customerProfileId: string,
       format: 'csv' | 'json' | 'txt',
       systemId?: string
     ) {
       const where: any = { customerProfileId };

       if (systemId) {
         const system = await this.prisma.system.findFirst({
           where: {
             id: systemId,
             customerProfileId,
           },
         });

         if (system) {
           where.openkjSystemId = system.openkjSystemId;
         }
       }

       const songs = await this.prisma.songDb.findMany({
         where,
         orderBy: [{ artist: 'asc' }, { title: 'asc' }],
       });

       let output = '';

       if (format === 'csv') {
         output = Papa.unparse(
           songs.map((s) => ({
             artist: s.artist,
             title: s.title,
           }))
         );
       } else if (format === 'json') {
         output = JSON.stringify(
           songs.map((s) => ({
             artist: s.artist,
             title: s.title,
           })),
           null,
           2
         );
       } else if (format === 'txt') {
         output = songs.map((s) => `${s.artist} - ${s.title}`).join('\n');
       }

       logger.info(
         {
           customerProfileId,
           systemId,
           format,
           count: songs.length,
         },
         'Songs exported'
       );

       return {
         data: output,
         count: songs.length,
       };
     }

     async getAvailableLetters(
       customerProfileId: string,
       systemId?: string
     ): Promise<string[]> {
       const where: any = { customerProfileId };

       if (systemId) {
         const system = await this.prisma.system.findFirst({
           where: {
             id: systemId,
             customerProfileId,
           },
         });

         if (system) {
           where.openkjSystemId = system.openkjSystemId;
         }
       }

       const letters = await this.prisma.$queryRaw<Array<{ letter: string }>>`
         SELECT DISTINCT UPPER(LEFT(artist, 1)) as letter
         FROM songdb
         WHERE customer_profiles_id = ${customerProfileId}::uuid
           ${systemId ? this.prisma.$queryRawUnsafe`AND openkj_system_id IN (
             SELECT openkj_system_id FROM systems WHERE systems_id = '${systemId}'::uuid
           )` : this.prisma.$queryRawUnsafe``}
         ORDER BY letter
       `;

       return letters.map((l) => l.letter);
     }
   }
   ```

3. **Install CSV parser dependency:**
   ```bash
   pnpm add papaparse
   pnpm add -D @types/papaparse
   ```

4. **Implement songdb routes in `apps/api/src/routes/customer/songdb.ts`:**
   ```typescript
   import { FastifyPluginAsync } from 'fastify';
   import { validateQuery, validateParams, validateBody } from '@singr/shared/validation';
   import { requirePermission } from '@singr/auth';
   import {
     SongDbQuerySchema,
     AddSongSchema,
     BulkAddSongsSchema,
     UpdateSongSchema,
     SongParamsSchema,
     ImportSongsSchema,
   } from './schemas';
   import { SongDbService } from '@singr/shared/services/songdb-service';
   import { createLogger } from '@singr/observability';

   const logger = createLogger('routes:customer:songdb');

   export const songdbRoute: FastifyPluginAsync = async (server) => {
     const songdbService = new SongDbService(server.prisma);

     // List songs
     server.get(
       '/songdb',
       {
         schema: {
           tags: ['customer'],
           summary: 'List songs',
           description: 'Get all songs in the song database',
           security: [{ bearerAuth: [] }],
           querystring: {
             type: 'object',
             properties: {
               page: { type: 'integer', minimum: 1, default: 1 },
               limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
               systemId: { type: 'string', format: 'uuid' },
               search: { type: 'string' },
               artist: { type: 'string' },
               title: { type: 'string' },
               letter: { type: 'string', minLength: 1, maxLength: 1 },
             },
           },
           response: {
             200: {
               description: 'List of songs',
               type: 'object',
               properties: {
                 data: {
                   type: 'array',
                   items: {
                     type: 'object',
                     properties: {
                       id: { type: 'integer' },
                       systemId: { type: 'string', format: 'uuid' },
                       systemName: { type: 'string' },
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
         preHandler: [
           server.authenticate,
           requirePermission('songdb:read'),
           validateQuery(SongDbQuerySchema),
         ],
       },
       async (request, reply) => {
         const query = request.query as z.infer<typeof SongDbQuerySchema>;
         const customerProfileId = request.user.activeContext?.id;

         if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
           return reply.code(403).send({
             type: 'authorization_denied',
             title: 'Customer Context Required',
             detail: 'You must be in a customer context to access this resource',
           });
         }

         const { page, limit, ...filters } = query;

         const result = await songdbService.listSongs(
           customerProfileId,
           filters,
           { page, limit }
         );

         return reply.send(result);
       }
     );

     // Get available letters
     server.get(
       '/songdb/letters',
       {
         schema: {
           tags: ['customer'],
           summary: 'Get available letters',
           description: 'Get list of first letters that have songs',
           security: [{ bearerAuth: [] }],
           querystring: {
             type: 'object',
             properties: {
               systemId: { type: 'string', format: 'uuid' },
             },
           },
           response: {
             200: {
               description: 'Available letters',
               type: 'object',
               properties: {
                 letters: {
                   type: 'array',
                   items: { type: 'string' },
                 },
               },
             },
           },
         },
         preHandler: [server.authenticate, requirePermission('songdb:read')],
       },
       async (request, reply) => {
         const { systemId } = request.query as { systemId?: string };
         const customerProfileId = request.user.activeContext?.id;

         if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
           return reply.code(403).send({
             type: 'authorization_denied',
             title: 'Customer Context Required',
             detail: 'You must be in a customer context to access this resource',
           });
         }

         const letters = await songdbService.getAvailableLetters(
           customerProfileId,
           systemId
         );

         return reply.send({ letters });
       }
     );

     // Get song details
     server.get(
       '/songdb/:id',
       {
         schema: {
           tags: ['customer'],
           summary: 'Get song',
           description: 'Get details of a specific song',
           security: [{ bearerAuth: [] }],
           params: {
             type: 'object',
             properties: {
               id: { type: 'integer' },
             },
           },
           response: {
             200: {
               description: 'Song details',
               type: 'object',
               properties: {
                 id: { type: 'integer' },
                 systemId: { type: 'string', format: 'uuid' },
                 systemName: { type: 'string' },
                 artist: { type: 'string' },
                 title: { type: 'string' },
                 combined: { type: 'string' },
               },
             },
             404: {
               description: 'Song not found',
             },
           },
         },
         preHandler: [
           server.authenticate,
           requirePermission('songdb:read'),
           validateParams(SongParamsSchema),
         ],
       },
       async (request, reply) => {
         const { id } = request.params as z.infer<typeof SongParamsSchema>;
         const customerProfileId = request.user.activeContext?.id;

         if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
           return reply.code(403).send({
             type: 'authorization_denied',
             title: 'Customer Context Required',
             detail: 'You must be in a customer context to access this resource',
           });
         }

         try {
           const song = await songdbService.getSong(id, customerProfileId);
           return reply.send(song);
         } catch (error) {
           if (error instanceof Error && error.message.includes('not found')) {
             return reply.code(404).send({
               type: 'resource_not_found',
               title: 'Song Not Found',
               detail: 'Song not found or access denied',
             });
           }
           throw error;
         }
       }
     );

     // Add single song
     server.post(
       '/songdb',
       {
         schema: {
           tags: ['customer'],
           summary: 'Add song',
           description: 'Add a single song to the database',
           security: [{ bearerAuth: [] }],
           body: {
             type: 'object',
             required: ['systemId', 'artist', 'title'],
             properties: {
               systemId: { type: 'string', format: 'uuid' },
               artist: { type: 'string', minLength: 1, maxLength: 255 },
               title: { type: 'string', minLength: 1, maxLength: 255 },
             },
           },
           response: {
             201: {
               description: 'Song added',
               type: 'object',
               properties: {
                 id: { type: 'integer' },
                 systemId: { type: 'string', format: 'uuid' },
                 artist: { type: 'string' },
                 title: { type: 'string' },
               },
             },
             404: {
               description: 'System not found',
             },
             409: {
               description: 'Song already exists',
             },
           },
         },
         preHandler: [
           server.authenticate,
           requirePermission('songdb:write'),
           validateBody(AddSongSchema),
         ],
       },
       async (request, reply) => {
         const body = request.body as z.infer<typeof AddSongSchema>;
         const customerProfileId = request.user.activeContext?.id;

         if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
           return reply.code(403).send({
             type: 'authorization_denied',
             title: 'Customer Context Required',
             detail: 'You must be in a customer context to add songs',
           });
         }

         try {
           const song = await songdbService.addSong({
             customerProfileId,
             ...body,
           });

           return reply.code(201).send(song);
         } catch (error) {
           if (error instanceof Error) {
             if (error.message.includes('not found')) {
               return reply.code(404).send({
                 type: 'resource_not_found',
                 title: 'System Not Found',
                 detail: error.message,
               });
             }
             if (error.message.includes('already exists')) {
               return reply.code(409).send({
                 type: 'conflict',
                 title: 'Song Already Exists',
                 detail: error.message,
               });
             }
           }
           throw error;
         }
       }
     );

     // Bulk add songs
     server.post(
       '/songdb/bulk',
       {
         schema: {
           tags: ['customer'],
           summary: 'Bulk add songs',
           description: 'Add multiple songs at once (max 10,000)',
           security: [{ bearerAuth: [] }],
           body: {
             type: 'object',
             required: ['systemId', 'songs'],
             properties: {
               systemId: { type: 'string', format: 'uuid' },
               songs: {
                 type: 'array',
                 minItems: 1,
                 maxItems: 10000,
                 items: {
                   type: 'object',
                   required: ['artist', 'title'],
                   properties: {
                     artist: { type: 'string', minLength: 1, maxLength: 255 },
                     title: { type: 'string', minLength: 1, maxLength: 255 },
                   },
                 },
               },
             },
           },
           response: {
             201: {
               description: 'Songs added',
               type: 'object',
               properties: {
                 inserted: { type: 'integer' },
                 skipped: { type: 'integer' },
                 total: { type: 'integer' },
               },
             },
           },
         },
         preHandler: [
           server.authenticate,
           requirePermission('songdb:write'),
           validateBody(BulkAddSongsSchema),
         ],
         config: {
           rateLimit: {
             max: 10,
             timeWindow: '1 hour',
           },
         },
       },
       async (request, reply) => {
         const body = request.body as z.infer<typeof BulkAddSongsSchema>;
         const customerProfileId = request.user.activeContext?.id;

         if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
           return reply.code(403).send({
             type: 'authorization_denied',
             title: 'Customer Context Required',
             detail: 'You must be in a customer context to add songs',
           });
         }

         try {
           const result = await songdbService.bulkAddSongs({
             customerProfileId,
             ...body,
           });

           return reply.code(201).send(result);
         } catch (error) {
           if (error instanceof Error && error.message.includes('not found')) {
             return reply.code(404).send({
               type: 'resource_not_found',
               title: 'System Not Found',
               detail: error.message,
             });
           }
           throw error;
         }
       }
     );

   };
   
     // Import songs
     server.post(
       '/songdb/import',
       {
         schema: {
           tags: ['customer'],
           summary: 'Import songs',
           description: 'Import songs from CSV, JSON, or TXT format',
           security: [{ bearerAuth: [] }],
           body: {
             type: 'object',
             required: ['systemId', 'format', 'data'],
             properties: {
               systemId: { type: 'string', format: 'uuid' },
               format: { type: 'string', enum: ['csv', 'json', 'txt'] },
               data: { type: 'string' },
             },
           },
           response: {
             201: {
               description: 'Songs imported',
               type: 'object',
               properties: {
                 inserted: { type: 'integer' },
                 skipped: { type: 'integer' },
                 total: { type: 'integer' },
               },
             },
             400: {
               description: 'Invalid import data',
             },
           },
         },
         preHandler: [
           server.authenticate,
           requirePermission('songdb:write'),
           validateBody(ImportSongsSchema),
         ],
         config: {
           rateLimit: {
             max: 10,
             timeWindow: '1 hour',
           },
         },
       },
       async (request, reply) => {
         const body = request.body as z.infer<typeof ImportSongsSchema>;
         const customerProfileId = request.user.activeContext?.id;

         if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
           return reply.code(403).send({
             type: 'authorization_denied',
             title: 'Customer Context Required',
             detail: 'You must be in a customer context to import songs',
           });
         }

         try {
           const result = await songdbService.importSongs(
             customerProfileId,
             body.systemId,
             body.format,
             body.data
           );

           return reply.code(201).send(result);
         } catch (error) {
           if (error instanceof Error) {
             if (error.message.includes('not found')) {
               return reply.code(404).send({
                 type: 'resource_not_found',
                 title: 'System Not Found',
                 detail: error.message,
               });
             }
             if (error.message.includes('No valid songs')) {
               return reply.code(400).send({
                 type: 'validation_error',
                 title: 'Invalid Import Data',
                 detail: error.message,
               });
             }
           }
           throw error;
         }
       }
     );

     // Export songs
     server.get(
       '/songdb/export',
       {
         schema: {
           tags: ['customer'],
           summary: 'Export songs',
           description: 'Export all songs in CSV, JSON, or TXT format',
           security: [{ bearerAuth: [] }],
           querystring: {
             type: 'object',
             required: ['format'],
             properties: {
               format: { type: 'string', enum: ['csv', 'json', 'txt'] },
               systemId: { type: 'string', format: 'uuid' },
             },
           },
           response: {
             200: {
               description: 'Songs exported',
               type: 'string',
             },
           },
         },
         preHandler: [
           server.authenticate,
           requirePermission('songdb:read'),
           validateQuery(
             z.object({
               format: z.enum(['csv', 'json', 'txt']),
               systemId: z.string().uuid().optional(),
             })
           ),
         ],
         config: {
           rateLimit: {
             max: 20,
             timeWindow: '1 hour',
           },
         },
       },
       async (request, reply) => {
         const { format, systemId } = request.query as {
           format: 'csv' | 'json' | 'txt';
           systemId?: string;
         };
         const customerProfileId = request.user.activeContext?.id;

         if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
           return reply.code(403).send({
             type: 'authorization_denied',
             title: 'Customer Context Required',
             detail: 'You must be in a customer context to export songs',
           });
         }

         const result = await songdbService.exportSongs(
           customerProfileId,
           format,
           systemId
         );

         // Set content type based on format
         const contentTypes = {
           csv: 'text/csv',
           json: 'application/json',
           txt: 'text/plain',
         };

         const extensions = {
           csv: 'csv',
           json: 'json',
           txt: 'txt',
         };

         reply.header('Content-Type', contentTypes[format]);
         reply.header(
           'Content-Disposition',
           `attachment; filename="songdb-export-${new Date().toISOString().split('T')[0]}.${extensions[format]}"`
         );

         return reply.send(result.data);
       }
     );

     // Update song
     server.patch(
       '/songdb/:id',
       {
         schema: {
           tags: ['customer'],
           summary: 'Update song',
           description: 'Update song information',
           security: [{ bearerAuth: [] }],
           params: {
             type: 'object',
             properties: {
               id: { type: 'integer' },
             },
           },
           body: {
             type: 'object',
             properties: {
               artist: { type: 'string', minLength: 1, maxLength: 255 },
               title: { type: 'string', minLength: 1, maxLength: 255 },
             },
           },
           response: {
             200: {
               description: 'Song updated',
               type: 'object',
               properties: {
                 id: { type: 'integer' },
                 artist: { type: 'string' },
                 title: { type: 'string' },
               },
             },
             404: {
               description: 'Song not found',
             },
           },
         },
         preHandler: [
           server.authenticate,
           requirePermission('songdb:write'),
           validateParams(SongParamsSchema),
           validateBody(UpdateSongSchema),
         ],
       },
       async (request, reply) => {
         const { id } = request.params as z.infer<typeof SongParamsSchema>;
         const body = request.body as z.infer<typeof UpdateSongSchema>;
         const customerProfileId = request.user.activeContext?.id;

         if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
           return reply.code(403).send({
             type: 'authorization_denied',
             title: 'Customer Context Required',
             detail: 'You must be in a customer context to update songs',
           });
         }

         try {
           const song = await songdbService.updateSong(id, customerProfileId, body);
           return reply.send(song);
         } catch (error) {
           if (error instanceof Error && error.message.includes('not found')) {
             return reply.code(404).send({
               type: 'resource_not_found',
               title: 'Song Not Found',
               detail: 'Song not found or access denied',
             });
           }
           throw error;
         }
       }
     );

     // Delete single song
     server.delete(
       '/songdb/:id',
       {
         schema: {
           tags: ['customer'],
           summary: 'Delete song',
           description: 'Delete a single song',
           security: [{ bearerAuth: [] }],
           params: {
             type: 'object',
             properties: {
               id: { type: 'integer' },
             },
           },
           response: {
             204: {
               description: 'Song deleted',
             },
             404: {
               description: 'Song not found',
             },
           },
         },
         preHandler: [
           server.authenticate,
           requirePermission('songdb:write'),
           validateParams(SongParamsSchema),
         ],
       },
       async (request, reply) => {
         const { id } = request.params as z.infer<typeof SongParamsSchema>;
         const customerProfileId = request.user.activeContext?.id;

         if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
           return reply.code(403).send({
             type: 'authorization_denied',
             title: 'Customer Context Required',
             detail: 'You must be in a customer context to delete songs',
           });
         }

         try {
           await songdbService.deleteSong(id, customerProfileId);
           return reply.code(204).send();
         } catch (error) {
           if (error instanceof Error && error.message.includes('not found')) {
             return reply.code(404).send({
               type: 'resource_not_found',
               title: 'Song Not Found',
               detail: 'Song not found or access denied',
             });
           }
           throw error;
         }
       }
     );

     // Bulk delete songs
     server.delete(
       '/songdb',
       {
         schema: {
           tags: ['customer'],
           summary: 'Bulk delete songs',
           description: 'Delete all songs or all songs for a specific system',
           security: [{ bearerAuth: [] }],
           querystring: {
             type: 'object',
             properties: {
               systemId: { type: 'string', format: 'uuid' },
             },
           },
           response: {
             200: {
               description: 'Songs deleted',
               type: 'object',
               properties: {
                 deletedCount: { type: 'integer' },
               },
             },
           },
         },
         preHandler: [
           server.authenticate,
           requirePermission('songdb:write'),
           validateQuery(
             z.object({
               systemId: z.string().uuid().optional(),
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
         const { systemId } = request.query as { systemId?: string };
         const customerProfileId = request.user.activeContext?.id;

         if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
           return reply.code(403).send({
             type: 'authorization_denied',
             title: 'Customer Context Required',
             detail: 'You must be in a customer context to delete songs',
           });
         }

         const deletedCount = await songdbService.bulkDeleteSongs(
           customerProfileId,
           systemId
         );

         return reply.send({ deletedCount });
       }
     );
   };
   ```

5. **Register songdb route in `apps/api/src/routes/customer/index.ts`:**
   ```typescript
   import { FastifyPluginAsync } from 'fastify';
   import { venuesRoute } from './venues';
   import { systemsRoute } from './systems';
   import { songdbRoute } from './songdb';

   export const customerRoutes: FastifyPluginAsync = async (server) => {
     await server.register(venuesRoute);
     await server.register(systemsRoute);
     await server.register(songdbRoute);
   };
   ```

6. **Create import format documentation in `docs/SONGDB_IMPORT_FORMATS.md`:**
   ````markdown
   # Song Database Import Formats

   ## CSV Format

   Two columns: Artist, Title

   ```csv
   Queen,Bohemian Rhapsody
   The Beatles,Hey Jude
   Journey,Don't Stop Believin'
   ```

   ## JSON Format

   Array of objects with `artist` and `title` properties:

   ```json
   [
     {
       "artist": "Queen",
       "title": "Bohemian Rhapsody"
     },
     {
       "artist": "The Beatles",
       "title": "Hey Jude"
     }
   ]
   ```

   ## TXT Format

   One song per line, format: "Artist - Title"

   ```txt
   Queen - Bohemian Rhapsody
   The Beatles - Hey Jude
   Journey - Don't Stop Believin'
   ```

   ## Import Limits

   - Maximum 10,000 songs per import
   - Duplicates are automatically skipped
   - Rate limit: 10 imports per hour

   ## Export Formats

   All three formats (CSV, JSON, TXT) are supported for export.
   Downloads are automatically triggered with appropriate file extensions.

   ## Example API Usage

   ### Import CSV
   ```bash
   curl -X POST https://api.singrkaraoke.com/v1/customer/songdb/import \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "systemId": "uuid-here",
       "format": "csv",
       "data": "Queen,Bohemian Rhapsody\nThe Beatles,Hey Jude"
     }'
   ```

   ### Export JSON
   ```bash
   curl https://api.singrkaraoke.com/v1/customer/songdb/export?format=json \
     -H "Authorization: Bearer $TOKEN" \
     -o songdb-export.json
   ```
   ````

**Deliverables:**
- ✅ `GET /v1/customer/songdb` - List all songs with filters
- ✅ `GET /v1/customer/songdb/letters` - Get available alphabet letters
- ✅ `GET /v1/customer/songdb/:id` - Get song details
- ✅ `POST /v1/customer/songdb` - Add single song
- ✅ `POST /v1/customer/songdb/bulk` - Bulk add songs (max 10,000)
- ✅ `POST /v1/customer/songdb/import` - Import from CSV/JSON/TXT
- ✅ `GET /v1/customer/songdb/export` - Export to CSV/JSON/TXT
- ✅ `PATCH /v1/customer/songdb/:id` - Update song
- ✅ `DELETE /v1/customer/songdb/:id` - Delete single song
- ✅ `DELETE /v1/customer/songdb` - Bulk delete songs
- ✅ Duplicate detection (skip duplicates in bulk operations)
- ✅ Search by artist, title, or combined
- ✅ Filter by system
- ✅ Alphabet navigation
- ✅ CSV parsing with Papa Parse
- ✅ JSON parsing
- ✅ TXT format support (Artist - Title)
- ✅ Download headers for exports
- ✅ Rate limiting on bulk operations
- ✅ RBAC permission checks (songdb:read, songdb:write)
- ✅ Customer context validation
- ✅ Pagination support
- ✅ System association tracking

---

**End of Phase 9. Complete deliverables:**

### Phase 9 Summary

**Customer System & Songdb Management:**
- ✅ Full CRUD operations for karaoke systems
- ✅ Auto-increment openkjSystemId tracking
- ✅ System configuration JSON storage
- ✅ Song count tracking per system
- ✅ Delete protection (cannot delete system with songs)
- ✅ Full CRUD operations for song database
- ✅ Bulk operations (add up to 10,000 songs at once)
- ✅ Import from CSV, JSON, and TXT formats
- ✅ Export to CSV, JSON, and TXT formats
- ✅ Duplicate detection and skip logic
- ✅ Normalized search indexing
- ✅ Alphabet navigation support
- ✅ Multi-system song management
- ✅ Rate limiting on bulk operations
- ✅ Comprehensive filtering and search
- ✅ File download support with proper headers

---
