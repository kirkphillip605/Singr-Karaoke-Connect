import { FastifyInstance } from 'fastify';
import { prisma } from '@singr/database';
import {
  NotFoundError,
  parsePaginationParams,
  createPaginationInfo,
  createApiKeySchema,
  type CreateApiKeyInput,
} from '@singr/shared';
import { ApiKeyService } from '../services/apikey.service.js';

export default async function apikeysRoutes(server: FastifyInstance) {
  const apiKeyService = new ApiKeyService();

  // List API keys
  server.get(
    '/api-keys',
    {
      preHandler: server.authenticate,
    },
    async (request, reply) => {
      const userId = (request.user as any).sub;
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

      const { apiKeys, total } = await apiKeyService.listApiKeys(
        customerProfile.id,
        {
          status: query.status as
            | 'active'
            | 'revoked'
            | 'expired'
            | 'suspended'
            | undefined,
        },
        limit,
        offset
      );

      return reply.send({
        apiKeys,
        pagination: createPaginationInfo(total, limit || 10, offset || 0, apiKeys.length),
      });
    }
  );

  // Get API key
  server.get<{ Params: { keyId: string } }>(
    '/api-keys/:keyId',
    {
      preHandler: server.authenticate,
    },
    async (request, reply) => {
      const userId = (request.user as any).sub;
      const { keyId } = request.params;

      const customerProfile = await prisma.customerProfile.findUnique({
        where: { userId },
      });

      if (!customerProfile) {
        throw new NotFoundError('Customer profile');
      }

      const apiKey = await apiKeyService.getApiKey(keyId, customerProfile.id);

      return reply.send(apiKey);
    }
  );

  // Create API key
  server.post<{ Body: CreateApiKeyInput }>(
    '/api-keys',
    {
      preHandler: server.authenticate,
      schema: {
        body: createApiKeySchema,
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

      const apiKey = await apiKeyService.createApiKey(customerProfile.id, {
        description: request.body.description,
        createdByUserId: userId,
      });

      // WARNING: The API key is only returned once!
      return reply.code(201).send({
        ...apiKey,
        warning:
          'This is the only time you will see this key. Please store it securely.',
      });
    }
  );

  // Revoke API key
  server.delete<{ Params: { keyId: string } }>(
    '/api-keys/:keyId',
    {
      preHandler: server.authenticate,
    },
    async (request, reply) => {
      const userId = (request.user as any).sub;
      const { keyId } = request.params;

      const customerProfile = await prisma.customerProfile.findUnique({
        where: { userId },
      });

      if (!customerProfile) {
        throw new NotFoundError('Customer profile');
      }

      await apiKeyService.revokeApiKey(keyId, customerProfile.id);

      return reply.code(204).send();
    }
  );
}
