# Singr Central API Backend - Phase 11

**Document Version:** 1.0  
**Last Updated:** 2025-11-12  
**Author:** kirkphillip605  
**Status:** In Development

---

## Phase 11: API Key Management & OpenKJ Integration

### 11.1 API Key Generation & Management

**Objective:** Allow customers to generate and manage API keys for third-party integrations.

**Tasks:**

1. **Create API key schemas in `apps/api/src/routes/customer/schemas.ts`:**
   ```typescript
   // Add to existing schemas
   export const ApiKeyListQuerySchema = PaginationSchema.extend({
     active: z.coerce.boolean().optional(),
   });

   export const CreateApiKeySchema = z.object({
     name: z.string().min(1).max(100),
     description: z.string().max(500).optional(),
     expiresAt: z.string().datetime().optional(),
     scopes: z.array(z.string()).min(1).max(20),
   });

   export const UpdateApiKeySchema = z.object({
     name: z.string().min(1).max(100).optional(),
     description: z.string().max(500).optional(),
     active: z.boolean().optional(),
   });

   export const ApiKeyParamsSchema = z.object({
     id: z.string().uuid(),
   });

   export const ApiKeyResponseSchema = z.object({
     id: z.string().uuid(),
     name: z.string(),
     description: z.string().nullable(),
     prefix: z.string(),
     scopes: z.array(z.string()),
     active: z.boolean(),
     lastUsedAt: z.string().datetime().nullable(),
     expiresAt: z.string().datetime().nullable(),
     createdAt: z.string().datetime(),
   });

   export const ApiKeyWithSecretResponseSchema = ApiKeyResponseSchema.extend({
     key: z.string(),
   });
   ```

2. **Create API key service in `packages/shared/src/services/api-key-service.ts`:**
   ```typescript
   import { PrismaClient } from '@prisma/database';
   import { createLogger } from '@singr/observability';
   import { randomBytes, createHash } from 'crypto';
   import { API_KEY_PREFIX } from '@singr/config';

   const logger = createLogger('services:api-key');

   export interface ApiKeyFilters {
     active?: boolean;
   }

   export interface CreateApiKeyInput {
     customerProfileId: string;
     name: string;
     description?: string;
     expiresAt?: Date;
     scopes: string[];
     createdBy: string;
   }

   export class ApiKeyService {
     constructor(private prisma: PrismaClient) {}

     generateApiKey(): { key: string; hash: string; prefix: string } {
       // Generate random 32-byte key
       const randomKey = randomBytes(32).toString('base64url');
       
       // Create prefix (first 7 chars after the API_KEY_PREFIX)
       const prefix = randomKey.substring(0, 7);
       
       // Full key with prefix
       const key = `${API_KEY_PREFIX}${randomKey}`;
       
       // Hash for storage
       const hash = createHash('sha256').update(key).digest('hex');

       return { key, hash, prefix };
     }

     async listApiKeys(
       customerProfileId: string,
       filters: ApiKeyFilters,
       pagination: { page: number; limit: number }
     ) {
       const where: any = { customerProfileId };

       if (filters.active !== undefined) {
         where.active = filters.active;
       }

       const [apiKeys, total] = await Promise.all([
         this.prisma.apiKey.findMany({
           where,
           skip: (pagination.page - 1) * pagination.limit,
           take: pagination.limit,
           orderBy: { createdAt: 'desc' },
         }),
         this.prisma.apiKey.count({ where }),
       ]);

       return {
         data: apiKeys.map((k) => ({
           id: k.id,
           name: k.name,
           description: k.description,
           prefix: k.prefix,
           scopes: k.scopes as string[],
           active: k.active,
           lastUsedAt: k.lastUsedAt?.toISOString() || null,
           expiresAt: k.expiresAt?.toISOString() || null,
           createdAt: k.createdAt.toISOString(),
         })),
         pagination: {
           page: pagination.page,
           limit: pagination.limit,
           total,
           totalPages: Math.ceil(total / pagination.limit),
         },
       };
     }

     async getApiKey(apiKeyId: string, customerProfileId: string) {
       const apiKey = await this.prisma.apiKey.findFirst({
         where: {
           id: apiKeyId,
           customerProfileId,
         },
       });

       if (!apiKey) {
         throw new Error('API key not found');
       }

       return {
         id: apiKey.id,
         name: apiKey.name,
         description: apiKey.description,
         prefix: apiKey.prefix,
         scopes: apiKey.scopes as string[],
         active: apiKey.active,
         lastUsedAt: apiKey.lastUsedAt?.toISOString() || null,
         expiresAt: apiKey.expiresAt?.toISOString() || null,
         createdAt: apiKey.createdAt.toISOString(),
       };
     }

     async createApiKey(input: CreateApiKeyInput) {
       const { key, hash, prefix } = this.generateApiKey();

       const apiKey = await this.prisma.apiKey.create({
         data: {
           customerProfileId: input.customerProfileId,
           name: input.name,
           description: input.description,
           keyHash: hash,
           prefix,
           scopes: input.scopes,
           expiresAt: input.expiresAt,
           createdBy: input.createdBy,
         },
       });

       logger.info(
         {
           apiKeyId: apiKey.id,
           customerProfileId: input.customerProfileId,
           name: input.name,
           scopes: input.scopes,
         },
         'API key created'
       );

       return {
         id: apiKey.id,
         name: apiKey.name,
         description: apiKey.description,
         key, // Only returned on creation
         prefix: apiKey.prefix,
         scopes: apiKey.scopes as string[],
         active: apiKey.active,
         lastUsedAt: null,
         expiresAt: apiKey.expiresAt?.toISOString() || null,
         createdAt: apiKey.createdAt.toISOString(),
       };
     }

     async updateApiKey(
       apiKeyId: string,
       customerProfileId: string,
       input: { name?: string; description?: string; active?: boolean }
     ) {
       const apiKey = await this.prisma.apiKey.findFirst({
         where: {
           id: apiKeyId,
           customerProfileId,
         },
       });

       if (!apiKey) {
         throw new Error('API key not found');
       }

       const updated = await this.prisma.apiKey.update({
         where: { id: apiKeyId },
         data: {
           name: input.name,
           description: input.description,
           active: input.active,
         },
       });

       logger.info(
         {
           apiKeyId,
           customerProfileId,
         },
         'API key updated'
       );

       return {
         id: updated.id,
         name: updated.name,
         description: updated.description,
         prefix: updated.prefix,
         scopes: updated.scopes as string[],
         active: updated.active,
         lastUsedAt: updated.lastUsedAt?.toISOString() || null,
         expiresAt: updated.expiresAt?.toISOString() || null,
         createdAt: updated.createdAt.toISOString(),
       };
     }

     async revokeApiKey(apiKeyId: string, customerProfileId: string) {
       const apiKey = await this.prisma.apiKey.findFirst({
         where: {
           id: apiKeyId,
           customerProfileId,
         },
       });

       if (!apiKey) {
         throw new Error('API key not found');
       }

       await this.prisma.apiKey.update({
         where: { id: apiKeyId },
         data: { active: false },
       });

       logger.info(
         {
           apiKeyId,
           customerProfileId,
           name: apiKey.name,
         },
         'API key revoked'
       );
     }

     async deleteApiKey(apiKeyId: string, customerProfileId: string) {
       const apiKey = await this.prisma.apiKey.findFirst({
         where: {
           id: apiKeyId,
           customerProfileId,
         },
       });

       if (!apiKey) {
         throw new Error('API key not found');
       }

       await this.prisma.apiKey.delete({
         where: { id: apiKeyId },
       });

       logger.info(
         {
           apiKeyId,
           customerProfileId,
           name: apiKey.name,
         },
         'API key deleted'
       );
     }

     async verifyApiKey(key: string): Promise<{
       valid: boolean;
       customerProfileId?: string;
       scopes?: string[];
     }> {
       // Hash the provided key
       const hash = createHash('sha256').update(key).digest('hex');

       // Find API key
       const apiKey = await this.prisma.apiKey.findUnique({
         where: { keyHash: hash },
       });

       if (!apiKey) {
         return { valid: false };
       }

       // Check if active
       if (!apiKey.active) {
         logger.warn({ apiKeyId: apiKey.id }, 'Attempt to use inactive API key');
         return { valid: false };
       }

       // Check if expired
       if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
         logger.warn({ apiKeyId: apiKey.id }, 'Attempt to use expired API key');
         return { valid: false };
       }

       // Update last used timestamp (fire and forget)
       this.prisma.apiKey
         .update({
           where: { id: apiKey.id },
           data: { lastUsedAt: new Date() },
         })
         .catch((error) => {
           logger.error({ error, apiKeyId: apiKey.id }, 'Failed to update lastUsedAt');
         });

       return {
         valid: true,
         customerProfileId: apiKey.customerProfileId,
         scopes: apiKey.scopes as string[],
       };
     }

     async rotateApiKey(apiKeyId: string, customerProfileId: string) {
       const apiKey = await this.prisma.apiKey.findFirst({
         where: {
           id: apiKeyId,
           customerProfileId,
         },
       });

       if (!apiKey) {
         throw new Error('API key not found');
       }

       const { key, hash, prefix } = this.generateApiKey();

       const updated = await this.prisma.apiKey.update({
         where: { id: apiKeyId },
         data: {
           keyHash: hash,
           prefix,
         },
       });

       logger.info(
         {
           apiKeyId,
           customerProfileId,
           name: apiKey.name,
         },
         'API key rotated'
       );

       return {
         id: updated.id,
         name: updated.name,
         description: updated.description,
         key, // New key returned
         prefix: updated.prefix,
         scopes: updated.scopes as string[],
         active: updated.active,
         lastUsedAt: updated.lastUsedAt?.toISOString() || null,
         expiresAt: updated.expiresAt?.toISOString() || null,
         createdAt: updated.createdAt.toISOString(),
       };
     }
   }
   ```

3. **Create API key authentication hook in `packages/auth/src/api-key-auth.ts`:**
   ```typescript
   import { FastifyRequest, FastifyReply } from 'fastify';
   import { ApiKeyService } from '@singr/shared/services/api-key-service';
   import { createLogger } from '@singr/observability';

   const logger = createLogger('auth:api-key');

   export async function authenticateApiKey(
     request: FastifyRequest,
     reply: FastifyReply
   ) {
     const apiKey = request.headers['x-api-key'] as string;

     if (!apiKey) {
       return reply.code(401).send({
         type: 'authentication_failed',
         title: 'API Key Required',
         detail: 'X-API-Key header is required',
       });
     }

     const apiKeyService = new ApiKeyService(request.server.prisma);
     const result = await apiKeyService.verifyApiKey(apiKey);

     if (!result.valid) {
       return reply.code(401).send({
         type: 'authentication_failed',
         title: 'Invalid API Key',
         detail: 'API key is invalid, expired, or revoked',
       });
     }

     // Attach to request for use in handlers
     (request as any).apiKeyAuth = {
       customerProfileId: result.customerProfileId,
       scopes: result.scopes,
     };
   }

   export function requireApiKeyScope(scope: string) {
     return async (request: FastifyRequest, reply: FastifyReply) => {
       const apiKeyAuth = (request as any).apiKeyAuth;

       if (!apiKeyAuth) {
         return reply.code(401).send({
           type: 'authentication_failed',
           title: 'Not Authenticated',
           detail: 'API key authentication required',
         });
       }

       if (!apiKeyAuth.scopes.includes(scope)) {
         logger.warn(
           {
             customerProfileId: apiKeyAuth.customerProfileId,
             requiredScope: scope,
             providedScopes: apiKeyAuth.scopes,
           },
           'API key missing required scope'
         );

         return reply.code(403).send({
           type: 'authorization_denied',
           title: 'Insufficient Scope',
           detail: `API key does not have required scope: ${scope}`,
         });
       }
     };
   }
   ```

4. **Implement API key routes in `apps/api/src/routes/customer/api-keys.ts`:**
   ```typescript
   import { FastifyPluginAsync } from 'fastify';
   import { validateQuery, validateParams, validateBody } from '@singr/shared/validation';
   import { requirePermission } from '@singr/auth';
   import {
     ApiKeyListQuerySchema,
     CreateApiKeySchema,
     UpdateApiKeySchema,
     ApiKeyParamsSchema,
   } from './schemas';
   import { ApiKeyService } from '@singr/shared/services/api-key-service';
   import { createLogger } from '@singr/observability';

   const logger = createLogger('routes:customer:api-keys');

   export const apiKeysRoute: FastifyPluginAsync = async (server) => {
     const apiKeyService = new ApiKeyService(server.prisma);

     // Available scopes
     const AVAILABLE_SCOPES = [
       'requests:read',
       'requests:write',
       'songdb:read',
       'songdb:write',
       'venues:read',
       'systems:read',
     ];

     // List API keys
     server.get(
       '/api-keys',
       {
         schema: {
           tags: ['customer'],
           summary: 'List API keys',
           description: 'Get all API keys for the customer',
           security: [{ bearerAuth: [] }],
           querystring: {
             type: 'object',
             properties: {
               page: { type: 'integer', minimum: 1, default: 1 },
               limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
               active: { type: 'boolean' },
             },
           },
           response: {
             200: {
               description: 'List of API keys',
               type: 'object',
               properties: {
                 data: {
                   type: 'array',
                   items: {
                     type: 'object',
                     properties: {
                       id: { type: 'string', format: 'uuid' },
                       name: { type: 'string' },
                       prefix: { type: 'string' },
                       scopes: { type: 'array', items: { type: 'string' } },
                       active: { type: 'boolean' },
                       lastUsedAt: { type: 'string', format: 'date-time' },
                       expiresAt: { type: 'string', format: 'date-time' },
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
           requirePermission('api_keys:read'),
           validateQuery(ApiKeyListQuerySchema),
         ],
       },
       async (request, reply) => {
         const query = request.query as z.infer<typeof ApiKeyListQuerySchema>;
         const customerProfileId = request.user.activeContext?.id;

         if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
           return reply.code(403).send({
             type: 'authorization_denied',
             title: 'Customer Context Required',
             detail: 'You must be in a customer context to access this resource',
           });
         }

         const { page, limit, ...filters } = query;

         const result = await apiKeyService.listApiKeys(
           customerProfileId,
           filters,
           { page, limit }
         );

         return reply.send(result);
       }
     );

     // Get available scopes
     server.get(
       '/api-keys/scopes',
       {
         schema: {
           tags: ['customer'],
           summary: 'Get available scopes',
           description: 'Get list of available API key scopes',
           security: [{ bearerAuth: [] }],
           response: {
             200: {
               description: 'Available scopes',
               type: 'object',
               properties: {
                 scopes: {
                   type: 'array',
                   items: { type: 'string' },
                 },
               },
             },
           },
         },
         preHandler: [server.authenticate, requirePermission('api_keys:read')],
       },
       async (request, reply) => {
         return reply.send({ scopes: AVAILABLE_SCOPES });
       }
     );

     // Get API key details
     server.get(
       '/api-keys/:id',
       {
         schema: {
           tags: ['customer'],
           summary: 'Get API key',
           description: 'Get details of a specific API key',
           security: [{ bearerAuth: [] }],
           params: {
             type: 'object',
             properties: {
               id: { type: 'string', format: 'uuid' },
             },
           },
           response: {
             200: {
               description: 'API key details',
               type: 'object',
               properties: {
                 id: { type: 'string', format: 'uuid' },
                 name: { type: 'string' },
                 description: { type: 'string' },
                 prefix: { type: 'string' },
                 scopes: { type: 'array', items: { type: 'string' } },
                 active: { type: 'boolean' },
                 lastUsedAt: { type: 'string', format: 'date-time' },
                 expiresAt: { type: 'string', format: 'date-time' },
                 createdAt: { type: 'string', format: 'date-time' },
               },
             },
             404: {
               description: 'API key not found',
             },
           },
         },
         preHandler: [
           server.authenticate,
           requirePermission('api_keys:read'),
           validateParams(ApiKeyParamsSchema),
         ],
       },
       async (request, reply) => {
         const { id } = request.params as z.infer<typeof ApiKeyParamsSchema>;
         const customerProfileId = request.user.activeContext?.id;

         if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
           return reply.code(403).send({
             type: 'authorization_denied',
             title: 'Customer Context Required',
             detail: 'You must be in a customer context to access this resource',
           });
         }

         try {
           const apiKey = await apiKeyService.getApiKey(id, customerProfileId);
           return reply.send(apiKey);
         } catch (error) {
           if (error instanceof Error && error.message.includes('not found')) {
             return reply.code(404).send({
               type: 'resource_not_found',
               title: 'API Key Not Found',
               detail: 'API key not found or access denied',
             });
           }
           throw error;
         }
       }
     );
   };
   
   // Create API key
     server.post(
       '/api-keys',
       {
         schema: {
           tags: ['customer'],
           summary: 'Create API key',
           description: 'Generate a new API key (key is only shown once)',
           security: [{ bearerAuth: [] }],
           body: {
             type: 'object',
             required: ['name', 'scopes'],
             properties: {
               name: { type: 'string', minLength: 1, maxLength: 100 },
               description: { type: 'string', maxLength: 500 },
               expiresAt: { type: 'string', format: 'date-time' },
               scopes: {
                 type: 'array',
                 minItems: 1,
                 maxItems: 20,
                 items: { type: 'string' },
               },
             },
           },
           response: {
             201: {
               description: 'API key created (key only shown once)',
               type: 'object',
               properties: {
                 id: { type: 'string', format: 'uuid' },
                 name: { type: 'string' },
                 description: { type: 'string' },
                 key: { type: 'string', description: 'Full API key - save this now!' },
                 prefix: { type: 'string' },
                 scopes: { type: 'array', items: { type: 'string' } },
                 active: { type: 'boolean' },
                 expiresAt: { type: 'string', format: 'date-time' },
                 createdAt: { type: 'string', format: 'date-time' },
               },
             },
             400: {
               description: 'Invalid scopes provided',
             },
           },
         },
         preHandler: [
           server.authenticate,
           requirePermission('api_keys:write'),
           validateBody(CreateApiKeySchema),
         ],
       },
       async (request, reply) => {
         const body = request.body as z.infer<typeof CreateApiKeySchema>;
         const customerProfileId = request.user.activeContext?.id;
         const userId = request.user.sub;

         if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
           return reply.code(403).send({
             type: 'authorization_denied',
             title: 'Customer Context Required',
             detail: 'You must be in a customer context to create API keys',
           });
         }

         // Validate scopes
         const invalidScopes = body.scopes.filter(
           (scope) => !AVAILABLE_SCOPES.includes(scope)
         );

         if (invalidScopes.length > 0) {
           return reply.code(400).send({
             type: 'validation_error',
             title: 'Invalid Scopes',
             detail: `Invalid scopes: ${invalidScopes.join(', ')}`,
           });
         }

         const apiKey = await apiKeyService.createApiKey({
           customerProfileId,
           name: body.name,
           description: body.description,
           expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
           scopes: body.scopes,
           createdBy: userId,
         });

         return reply.code(201).send(apiKey);
       }
     );

     // Update API key
     server.patch(
       '/api-keys/:id',
       {
         schema: {
           tags: ['customer'],
           summary: 'Update API key',
           description: 'Update API key name, description, or active status',
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
               name: { type: 'string', minLength: 1, maxLength: 100 },
               description: { type: 'string', maxLength: 500 },
               active: { type: 'boolean' },
             },
           },
           response: {
             200: {
               description: 'API key updated',
               type: 'object',
               properties: {
                 id: { type: 'string', format: 'uuid' },
                 name: { type: 'string' },
                 description: { type: 'string' },
                 active: { type: 'boolean' },
               },
             },
             404: {
               description: 'API key not found',
             },
           },
         },
         preHandler: [
           server.authenticate,
           requirePermission('api_keys:write'),
           validateParams(ApiKeyParamsSchema),
           validateBody(UpdateApiKeySchema),
         ],
       },
       async (request, reply) => {
         const { id } = request.params as z.infer<typeof ApiKeyParamsSchema>;
         const body = request.body as z.infer<typeof UpdateApiKeySchema>;
         const customerProfileId = request.user.activeContext?.id;

         if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
           return reply.code(403).send({
             type: 'authorization_denied',
             title: 'Customer Context Required',
             detail: 'You must be in a customer context to update API keys',
           });
         }

         try {
           const apiKey = await apiKeyService.updateApiKey(id, customerProfileId, body);
           return reply.send(apiKey);
         } catch (error) {
           if (error instanceof Error && error.message.includes('not found')) {
             return reply.code(404).send({
               type: 'resource_not_found',
               title: 'API Key Not Found',
               detail: 'API key not found or access denied',
             });
           }
           throw error;
         }
       }
     );

     // Revoke API key
     server.post(
       '/api-keys/:id/revoke',
       {
         schema: {
           tags: ['customer'],
           summary: 'Revoke API key',
           description: 'Revoke an API key (marks as inactive)',
           security: [{ bearerAuth: [] }],
           params: {
             type: 'object',
             properties: {
               id: { type: 'string', format: 'uuid' },
             },
           },
           response: {
             200: {
               description: 'API key revoked',
               type: 'object',
               properties: {
                 message: { type: 'string' },
               },
             },
             404: {
               description: 'API key not found',
             },
           },
         },
         preHandler: [
           server.authenticate,
           requirePermission('api_keys:revoke'),
           validateParams(ApiKeyParamsSchema),
         ],
       },
       async (request, reply) => {
         const { id } = request.params as z.infer<typeof ApiKeyParamsSchema>;
         const customerProfileId = request.user.activeContext?.id;

         if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
           return reply.code(403).send({
             type: 'authorization_denied',
             title: 'Customer Context Required',
             detail: 'You must be in a customer context to revoke API keys',
           });
         }

         try {
           await apiKeyService.revokeApiKey(id, customerProfileId);
           return reply.send({
             message: 'API key revoked successfully',
           });
         } catch (error) {
           if (error instanceof Error && error.message.includes('not found')) {
             return reply.code(404).send({
               type: 'resource_not_found',
               title: 'API Key Not Found',
               detail: 'API key not found or access denied',
             });
           }
           throw error;
         }
       }
     );

     // Rotate API key
     server.post(
       '/api-keys/:id/rotate',
       {
         schema: {
           tags: ['customer'],
           summary: 'Rotate API key',
           description: 'Generate a new key value (old key becomes invalid)',
           security: [{ bearerAuth: [] }],
           params: {
             type: 'object',
             properties: {
               id: { type: 'string', format: 'uuid' },
             },
           },
           response: {
             200: {
               description: 'API key rotated (new key only shown once)',
               type: 'object',
               properties: {
                 id: { type: 'string', format: 'uuid' },
                 name: { type: 'string' },
                 key: { type: 'string', description: 'New API key - save this now!' },
                 prefix: { type: 'string' },
                 scopes: { type: 'array', items: { type: 'string' } },
               },
             },
             404: {
               description: 'API key not found',
             },
           },
         },
         preHandler: [
           server.authenticate,
           requirePermission('api_keys:write'),
           validateParams(ApiKeyParamsSchema),
         ],
         config: {
           rateLimit: {
             max: 5,
             timeWindow: '1 hour',
           },
         },
       },
       async (request, reply) => {
         const { id } = request.params as z.infer<typeof ApiKeyParamsSchema>;
         const customerProfileId = request.user.activeContext?.id;

         if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
           return reply.code(403).send({
             type: 'authorization_denied',
             title: 'Customer Context Required',
             detail: 'You must be in a customer context to rotate API keys',
           });
         }

         try {
           const apiKey = await apiKeyService.rotateApiKey(id, customerProfileId);
           return reply.send(apiKey);
         } catch (error) {
           if (error instanceof Error && error.message.includes('not found')) {
             return reply.code(404).send({
               type: 'resource_not_found',
               title: 'API Key Not Found',
               detail: 'API key not found or access denied',
             });
           }
           throw error;
         }
       }
     );

     // Delete API key
     server.delete(
       '/api-keys/:id',
       {
         schema: {
           tags: ['customer'],
           summary: 'Delete API key',
           description: 'Permanently delete an API key',
           security: [{ bearerAuth: [] }],
           params: {
             type: 'object',
             properties: {
               id: { type: 'string', format: 'uuid' },
             },
           },
           response: {
             204: {
               description: 'API key deleted',
             },
             404: {
               description: 'API key not found',
             },
           },
         },
         preHandler: [
           server.authenticate,
           requirePermission('api_keys:write'),
           validateParams(ApiKeyParamsSchema),
         ],
       },
       async (request, reply) => {
         const { id } = request.params as z.infer<typeof ApiKeyParamsSchema>;
         const customerProfileId = request.user.activeContext?.id;

         if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
           return reply.code(403).send({
             type: 'authorization_denied',
             title: 'Customer Context Required',
             detail: 'You must be in a customer context to delete API keys',
           });
         }

         try {
           await apiKeyService.deleteApiKey(id, customerProfileId);
           return reply.code(204).send();
         } catch (error) {
           if (error instanceof Error && error.message.includes('not found')) {
             return reply.code(404).send({
               type: 'resource_not_found',
               title: 'API Key Not Found',
               detail: 'API key not found or access denied',
             });
           }
           throw error;
         }
       }
     );
   };
Register API keys route in apps/api/src/routes/customer/index.ts:
TypeScript
import { FastifyPluginAsync } from 'fastify';
import { venuesRoute } from './venues';
import { systemsRoute } from './systems';
import { songdbRoute } from './songdb';
import { requestsRoute } from './requests';
import { websocketRoute } from './websocket';
import { apiKeysRoute } from './api-keys';

export const customerRoutes: FastifyPluginAsync = async (server) => {
  await server.register(venuesRoute);
  await server.register(systemsRoute);
  await server.register(songdbRoute);
  await server.register(requestsRoute);
  await server.register(websocketRoute);
  await server.register(apiKeysRoute);
};
Deliverables:

✅ GET /v1/customer/api-keys - List all API keys
✅ GET /v1/customer/api-keys/scopes - Get available scopes
✅ GET /v1/customer/api-keys/:id - Get API key details
✅ POST /v1/customer/api-keys - Create new API key
✅ PATCH /v1/customer/api-keys/:id - Update API key
✅ POST /v1/customer/api-keys/:id/revoke - Revoke API key
✅ POST /v1/customer/api-keys/:id/rotate - Rotate API key secret
✅ DELETE /v1/customer/api-keys/:id - Delete API key
✅ SHA-256 hash storage for keys
✅ Prefix display for identification
✅ Scope-based authorization
✅ Expiration date support
✅ Last used timestamp tracking
✅ Key only shown once on creation/rotation
✅ Rate limiting on rotation
✅ RBAC permission checks (api_keys:read, api_keys:write, api_keys:revoke)

---

### 11.2 OpenKJ Integration Endpoints

**Objective:** Provide OpenKJ-compatible API endpoint matching the existing implementation.

**Duration:** 2-3 days  
**Team Size:** 1 developer

**Tasks:**

1. **Create OpenKJ schemas in `apps/api/src/routes/openkj/schemas.ts`:**
   ```typescript
   import { z } from 'zod';

   // Base OpenKJ request schema
   export const OpenKJBaseSchema = z.object({
     api_key: z.string().min(1),
     command: z.string().min(1),
   });

   // Command-specific schemas
   export const OpenKJGetVenuesSchema = OpenKJBaseSchema.extend({
     command: z.literal('getVenues'),
   });

   export const OpenKJGetSongsSchema = OpenKJBaseSchema.extend({
     command: z.literal('getSongs'),
     system_id: z.coerce.number().optional(),
   });

   export const OpenKJAddRequestSchema = OpenKJBaseSchema.extend({
     command: z.literal('addRequest'),
     venue_id: z.coerce.number().int().positive(),
     singer: z.string().optional(),
     artist: z.string().min(1),
     title: z.string().min(1),
     key_change: z.coerce.number().int().min(-12).max(12).default(0),
   });

   export const OpenKJGetRequestsSchema = OpenKJBaseSchema.extend({
     command: z.literal('getRequests'),
     venue_id: z.coerce.number().int().positive(),
   });

   export const OpenKJClearRequestsSchema = OpenKJBaseSchema.extend({
     command: z.literal('clearRequests'),
     venue_id: z.coerce.number().int().positive(),
   });

   export const OpenKJDeleteRequestSchema = OpenKJBaseSchema.extend({
     command: z.literal('deleteRequest'),
     request_id: z.coerce.number().int().positive(),
   });

   // Union type for all commands
   export const OpenKJRequestSchema = z.discriminatedUnion('command', [
     OpenKJGetVenuesSchema,
     OpenKJGetSongsSchema,
     OpenKJAddRequestSchema,
     OpenKJGetRequestsSchema,
     OpenKJClearRequestsSchema,
     OpenKJDeleteRequestSchema,
   ]);
   ```

2. **Create OpenKJ service in `packages/shared/src/services/openkj-service.ts`:**
   ```typescript
   import { PrismaClient } from '@prisma/database';
   import { createLogger } from '@singr/observability';
   import { createHash } from 'crypto';

   const logger = createLogger('services:openkj');

   export class OpenKJService {
     constructor(private prisma: PrismaClient) {}

     async verifyApiKey(apiKey: string): Promise<string | null> {
       // Hash the API key
       const hash = createHash('sha256').update(apiKey).digest('hex');

       // Find API key
       const key = await this.prisma.apiKey.findUnique({
         where: { keyHash: hash },
       });

       if (!key || !key.active) {
         return null;
       }

       // Check expiration
       if (key.expiresAt && key.expiresAt < new Date()) {
         return null;
       }

       // Check scopes - OpenKJ needs at minimum requests:write and songdb:read
       const scopes = key.scopes as string[];
       if (!scopes.includes('requests:write') || !scopes.includes('songdb:read')) {
         logger.warn(
           { apiKeyId: key.id, scopes },
           'OpenKJ API key missing required scopes'
         );
         return null;
       }

       // Update last used (fire and forget)
       this.prisma.apiKey
         .update({
           where: { id: key.id },
           data: { lastUsedAt: new Date() },
         })
         .catch((err) => {
           logger.error({ error: err, apiKeyId: key.id }, 'Failed to update lastUsedAt');
         });

       return key.customerProfileId;
     }

     async getVenues(customerProfileId: string): Promise<
       Array<{
         venue_id: number;
         name: string;
         url_name: string;
         accepting: number;
       }>
     > {
       const venues = await this.prisma.venue.findMany({
         where: { customerProfileId },
         orderBy: { name: 'asc' },
       });

       return venues.map((v) => ({
         venue_id: v.openkjVenueId,
         name: v.name,
         url_name: v.urlName,
         accepting: v.acceptingRequests ? 1 : 0,
       }));
     }

     async getSongs(
       customerProfileId: string,
       systemId?: number
     ): Promise<
       Array<{
         song_id: number;
         artist: string;
         title: string;
         songid: string;
       }>
     > {
       const where: any = { customerProfileId };

       if (systemId) {
         where.openkjSystemId = systemId;
       }

       const songs = await this.prisma.songDb.findMany({
         where,
         orderBy: [{ artist: 'asc' }, { title: 'asc' }],
       });

       return songs.map((s) => ({
         song_id: Number(s.id),
         artist: s.artist,
         title: s.title,
         songid: String(s.id), // OpenKJ expects string
       }));
     }

     async addRequest(
       customerProfileId: string,
       venueId: number,
       data: {
         singer?: string;
         artist: string;
         title: string;
         key_change: number;
       }
     ): Promise<{ request_id: number }> {
       // Find venue
       const venue = await this.prisma.venue.findFirst({
         where: {
           customerProfileId,
           openkjVenueId: venueId,
         },
       });

       if (!venue) {
         throw new Error('Venue not found');
       }

       if (!venue.acceptingRequests) {
         throw new Error('Venue not accepting requests');
       }

       // Create request
       const request = await this.prisma.request.create({
         data: {
           venueId: venue.id,
           artist: data.artist,
           title: data.title,
           keyChange: data.key_change,
           notes: data.singer ? `Singer: ${data.singer}` : null,
         },
       });

       // Add to history if we have singer info
       // Note: We don't have singerProfileId from OpenKJ, so this is a guest request
       await this.prisma.singerRequestHistory.create({
         data: {
           venueId: venue.id,
           artist: data.artist,
           title: data.title,
           keyChange: data.key_change,
           songFingerprint: `${data.artist.toLowerCase()}::${data.title.toLowerCase()}`,
         },
       });

       logger.info(
         {
           requestId: request.id,
           venueId: venue.id,
           customerProfileId,
         },
         'OpenKJ request added'
       );

       return { request_id: Number(request.id) };
     }

     async getRequests(
       customerProfileId: string,
       venueId: number
     ): Promise<
       Array<{
         request_id: number;
         singer: string;
         artist: string;
         title: string;
         key_change: number;
         request_time: string;
       }>
     > {
       // Find venue
       const venue = await this.prisma.venue.findFirst({
         where: {
           customerProfileId,
           openkjVenueId: venueId,
         },
       });

       if (!venue) {
         throw new Error('Venue not found');
       }

       // Get pending requests only
       const requests = await this.prisma.request.findMany({
         where: {
           venueId: venue.id,
           processed: false,
         },
         orderBy: { requestedAt: 'asc' },
         include: {
           singerProfile: {
             select: {
               nickname: true,
               user: {
                 select: { name: true },
               },
             },
           },
         },
       });

       return requests.map((r) => {
         // Extract singer name from notes if it exists, otherwise use profile
         let singerName = '';
         if (r.notes?.startsWith('Singer: ')) {
           singerName = r.notes.replace('Singer: ', '');
         } else if (r.singerProfile) {
           singerName =
             r.singerProfile.nickname ||
             r.singerProfile.user.name ||
             'Unknown Singer';
         }

         return {
           request_id: Number(r.id),
           singer: singerName,
           artist: r.artist,
           title: r.title,
           key_change: r.keyChange,
           request_time: Math.floor(r.requestedAt.getTime() / 1000).toString(),
         };
       });
     }

     async clearRequests(
       customerProfileId: string,
       venueId: number
     ): Promise<{ deleted: number }> {
       // Find venue
       const venue = await this.prisma.venue.findFirst({
         where: {
           customerProfileId,
           openkjVenueId: venueId,
         },
       });

       if (!venue) {
         throw new Error('Venue not found');
       }

       // Delete all pending requests for this venue
       const result = await this.prisma.request.deleteMany({
         where: {
           venueId: venue.id,
           processed: false,
         },
       });

       logger.info(
         {
           venueId: venue.id,
           customerProfileId,
           count: result.count,
         },
         'OpenKJ requests cleared'
       );

       return { deleted: result.count };
     }

     async deleteRequest(
       customerProfileId: string,
       requestId: number
     ): Promise<void> {
       // Find request and verify ownership
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
         'OpenKJ request deleted'
       );
     }
   }
   ```

3. **Implement OpenKJ route in `apps/api/src/routes/openkj/index.ts`:**
   ```typescript
   import { FastifyPluginAsync } from 'fastify';
   import { OpenKJRequestSchema } from './schemas';
   import { OpenKJService } from '@singr/shared/services/openkj-service';
   import { createLogger } from '@singr/observability';

   const logger = createLogger('routes:openkj');

   export const openkjRoutes: FastifyPluginAsync = async (server) => {
     const openkjService = new OpenKJService(server.prisma);

     // Single endpoint for all OpenKJ commands
     server.post(
       '/api',
       {
         schema: {
           tags: ['openkj'],
           summary: 'OpenKJ API endpoint',
           description: 'Single endpoint handling all OpenKJ commands',
           body: {
             type: 'object',
             required: ['api_key', 'command'],
             properties: {
               api_key: { type: 'string' },
               command: { type: 'string' },
               venue_id: { type: 'integer' },
               system_id: { type: 'integer' },
               singer: { type: 'string' },
               artist: { type: 'string' },
               title: { type: 'string' },
               key_change: { type: 'integer' },
               request_id: { type: 'integer' },
             },
           },
           response: {
             200: {
               description: 'Command response',
               type: 'object',
             },
             401: {
               description: 'Invalid API key',
               type: 'object',
               properties: {
                 error: { type: 'string' },
               },
             },
             400: {
               description: 'Invalid request',
               type: 'object',
               properties: {
                 error: { type: 'string' },
               },
             },
           },
         },
         config: {
           rateLimit: {
             max: 100,
             timeWindow: '1 minute',
           },
         },
       },
       async (request, reply) => {
         const body = request.body as any;

         // Validate API key first
         const customerProfileId = await openkjService.verifyApiKey(body.api_key);

         if (!customerProfileId) {
           logger.warn(
             { command: body.command, ip: request.ip },
             'OpenKJ API call with invalid key'
           );
           return reply.code(401).send({
             error: 'Invalid API key',
           });
         }

         try {
           // Validate request with Zod
           const validated = OpenKJRequestSchema.parse(body);

           // Route to appropriate handler based on command
           switch (validated.command) {
             case 'getVenues': {
               const venues = await openkjService.getVenues(customerProfileId);
               return reply.send({ venues });
             }

             case 'getSongs': {
               const songs = await openkjService.getSongs(
                 customerProfileId,
                 validated.system_id
               );
               return reply.send({ songs });
             }

             case 'addRequest': {
               const result = await openkjService.addRequest(
                 customerProfileId,
                 validated.venue_id,
                 {
                   singer: validated.singer,
                   artist: validated.artist,
                   title: validated.title,
                   key_change: validated.key_change,
                 }
               );
               return reply.send(result);
             }

             case 'getRequests': {
               const requests = await openkjService.getRequests(
                 customerProfileId,
                 validated.venue_id
               );
               return reply.send({ requests });
             }

             case 'clearRequests': {
               const result = await openkjService.clearRequests(
                 customerProfileId,
                 validated.venue_id
               );
               return reply.send(result);
             }

             case 'deleteRequest': {
               await openkjService.deleteRequest(
                 customerProfileId,
                 validated.request_id
               );
               return reply.send({ success: true });
             }

             default:
               return reply.code(400).send({
                 error: 'Unknown command',
               });
           }
         } catch (error) {
           if (error instanceof Error) {
             logger.error(
               {
                 error,
                 command: body.command,
                 customerProfileId,
               },
               'OpenKJ API error'
             );

             if (error.message.includes('not found')) {
               return reply.code(404).send({
                 error: error.message,
               });
             }

             if (error.message.includes('not accepting')) {
               return reply.code(422).send({
                 error: error.message,
               });
             }

             // Validation errors
             if (error.name === 'ZodError') {
               return reply.code(400).send({
                 error: 'Invalid request parameters',
               });
             }
           }

           return reply.code(500).send({
             error: 'Internal server error',
           });
         }
       }
     );
   };
   ```

4. **Register OpenKJ routes in main API:**
   ```typescript
   // Update apps/api/src/server.ts
   import { openkjRoutes } from './routes/openkj';

   // In the route registration section:
   await server.register(openkjRoutes, { prefix: '/openkj' });
   ```

5. **Create OpenKJ integration documentation in `docs/OPENKJ_INTEGRATION.md`:**
   ````markdown
   # OpenKJ Integration Guide

   ## Overview

   Singr provides a single API endpoint compatible with the OpenKJ karaoke hosting software.

   ## Endpoint

   ```
   POST https://api.singrkaraoke.com/openkj/api
   ```

   ## Authentication

   All requests require an `api_key` parameter in the request body. Generate an API key in your Singr customer dashboard with the following scopes:
   - `requests:write`
   - `songdb:read`
   - `venues:read`

   ## Commands

   ### Get Venues

   Retrieve all venues for your account.

   **Request:**
   ```json
   {
     "api_key": "your_api_key",
     "command": "getVenues"
   }
   ```

   **Response:**
   ```json
   {
     "venues": [
       {
         "venue_id": 1001,
         "name": "The Karaoke Bar",
         "url_name": "the-karaoke-bar",
         "accepting": 1
       }
     ]
   }
   ```

   ### Get Songs

   Retrieve song database for a specific system (optional).

   **Request:**
   ```json
   {
     "api_key": "your_api_key",
     "command": "getSongs",
     "system_id": 1001
   }
   ```

   **Response:**
   ```json
   {
     "songs": [
       {
         "song_id": 12345,
         "artist": "Queen",
         "title": "Bohemian Rhapsody",
         "songid": "12345"
       }
     ]
   }
   ```

   ### Add Request

   Submit a new song request to a venue.

   **Request:**
   ```json
   {
     "api_key": "your_api_key",
     "command": "addRequest",
     "venue_id": 1001,
     "singer": "John Doe",
     "artist": "Queen",
     "title": "Bohemian Rhapsody",
     "key_change": 0
   }
   ```

   **Response:**
   ```json
   {
     "request_id": 54321
   }
   ```

   ### Get Requests

   Retrieve all pending requests for a venue.

   **Request:**
   ```json
   {
     "api_key": "your_api_key",
     "command": "getRequests",
     "venue_id": 1001
   }
   ```

   **Response:**
   ```json
   {
     "requests": [
       {
         "request_id": 54321,
         "singer": "John Doe",
         "artist": "Queen",
         "title": "Bohemian Rhapsody",
         "key_change": 0,
         "request_time": "1699738800"
       }
     ]
   }
   ```

   ### Clear Requests

   Delete all pending requests for a venue.

   **Request:**
   ```json
   {
     "api_key": "your_api_key",
     "command": "clearRequests",
     "venue_id": 1001
   }
   ```

   **Response:**
   ```json
   {
     "deleted": 5
   }
   ```

   ### Delete Request

   Delete a specific request.

   **Request:**
   ```json
   {
     "api_key": "your_api_key",
     "command": "deleteRequest",
     "request_id": 54321
   }
   ```

   **Response:**
   ```json
   {
     "success": true
   }
   ```

   ## Error Responses

   ### 401 Unauthorized
   ```json
   {
     "error": "Invalid API key"
   }
   ```

   ### 400 Bad Request
   ```json
   {
     "error": "Invalid request parameters"
   }
   ```

   ### 404 Not Found
   ```json
   {
     "error": "Venue not found"
   }
   ```

   ### 422 Unprocessable Entity
   ```json
   {
     "error": "Venue not accepting requests"
   }
   ```

   ## Rate Limits

   - 100 requests per minute per API key

   ## OpenKJ Configuration

   In your OpenKJ application, configure:

   1. **API Endpoint:** `https://api.singrkaraoke.com/openkj/api`
   2. **API Key:** Your generated API key from Singr
   3. **Venue ID:** The `venue_id` from the `getVenues` response

   ## Notes

   - All requests must be sent as `POST` with `Content-Type: application/json`
   - The `request_time` field is a Unix timestamp (seconds since epoch)
   - The `accepting` field is `1` for true, `0` for false
   - Singer names from OpenKJ are stored in the request notes
   - Key changes range from -12 to +12 (semitones)
   ````

6. **Add test for OpenKJ endpoint:**
   ```typescript
   // Create apps/api/src/routes/openkj/__tests__/openkj.test.ts
   import { buildServer } from '../../../server';
   import { FastifyInstance } from 'fastify';

   describe('OpenKJ API', () => {
     let server: FastifyInstance;
     let apiKey: string;
     let customerProfileId: string;
     let venueId: number;

     beforeAll(async () => {
       server = await buildServer();
       await server.ready();

       // Setup test data
       // ... (create customer profile, API key, venue, etc.)
     });

     afterAll(async () => {
       await server.close();
     });

     describe('POST /openkj/api', () => {
       it('should return error for invalid API key', async () => {
         const response = await server.inject({
           method: 'POST',
           url: '/openkj/api',
           payload: {
             api_key: 'invalid_key',
             command: 'getVenues',
           },
         });

         expect(response.statusCode).toBe(401);
         expect(JSON.parse(response.payload)).toEqual({
           error: 'Invalid API key',
         });
       });

       it('should get venues', async () => {
         const response = await server.inject({
           method: 'POST',
           url: '/openkj/api',
           payload: {
             api_key: apiKey,
             command: 'getVenues',
           },
         });

         expect(response.statusCode).toBe(200);
         const data = JSON.parse(response.payload);
         expect(data.venues).toBeInstanceOf(Array);
         expect(data.venues[0]).toHaveProperty('venue_id');
         expect(data.venues[0]).toHaveProperty('name');
       });

       it('should add request', async () => {
         const response = await server.inject({
           method: 'POST',
           url: '/openkj/api',
           payload: {
             api_key: apiKey,
             command: 'addRequest',
             venue_id: venueId,
             singer: 'Test Singer',
             artist: 'Test Artist',
             title: 'Test Song',
             key_change: 0,
           },
         });

         expect(response.statusCode).toBe(200);
         const data = JSON.parse(response.payload);
         expect(data).toHaveProperty('request_id');
         expect(typeof data.request_id).toBe('number');
       });

       it('should get requests', async () => {
         const response = await server.inject({
           method: 'POST',
           url: '/openkj/api',
           payload: {
             api_key: apiKey,
             command: 'getRequests',
             venue_id: venueId,
           },
         });

         expect(response.statusCode).toBe(200);
         const data = JSON.parse(response.payload);
         expect(data.requests).toBeInstanceOf(Array);
       });

       it('should return error for unknown command', async () => {
         const response = await server.inject({
           method: 'POST',
           url: '/openkj/api',
           payload: {
             api_key: apiKey,
             command: 'unknownCommand',
           },
         });

         expect(response.statusCode).toBe(400);
         expect(JSON.parse(response.payload)).toEqual({
           error: 'Unknown command',
         });
       });
     });
   });
   ```

**Deliverables:**
- ✅ Single `POST /openkj/api` endpoint matching original implementation
- ✅ Command-based routing (getVenues, getSongs, addRequest, getRequests, clearRequests, deleteRequest)
- ✅ API key authentication via request body
- ✅ Exact response format matching original portal
- ✅ Unix timestamp format for request_time
- ✅ Singer name extraction from notes
- ✅ Request history tracking
- ✅ Venue ID mapping via openkjVenueId
- ✅ System ID filtering for songs
- ✅ Pending requests only for getRequests
- ✅ Bulk clear requests functionality
- ✅ Rate limiting (100 req/min)
- ✅ Comprehensive error handling
- ✅ Integration documentation
- ✅ Unit tests

---
