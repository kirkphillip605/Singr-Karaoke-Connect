import { prisma } from '@singr/database';
import { createLogger } from '@singr/observability';
import { NotFoundError } from '@singr/shared';
import { randomBytes, createHash } from 'crypto';

const logger = createLogger('service:apikey');

const API_KEY_PREFIX = 'sk_';

export interface ApiKeyFilters {
  status?: 'active' | 'revoked' | 'expired' | 'suspended';
}

export interface CreateApiKeyInput {
  description: string;
  createdByUserId: string;
}

export class ApiKeyService {
  generateApiKey(): { key: string; hash: string; prefix: string } {
    // Generate random 32-byte key
    const randomKey = randomBytes(32).toString('base64url');

    // Create prefix (first 7 chars)
    const prefix = randomKey.substring(0, 7);

    // Full key with prefix
    const key = `${API_KEY_PREFIX}${randomKey}`;

    // Hash for storage (SHA-256)
    const hash = createHash('sha256').update(key).digest('hex');

    return { key, hash, prefix };
  }

  async listApiKeys(
    customerProfileId: string,
    filters: ApiKeyFilters,
    limit: number,
    offset: number
  ) {
    const where: Record<string, unknown> = { customerProfileId };

    if (filters.status) {
      where.status = filters.status;
    }

    const [apiKeys, total] = await Promise.all([
      prisma.apiKey.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          description: true,
          status: true,
          lastUsedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.apiKey.count({ where }),
    ]);

    return { apiKeys, total };
  }

  async getApiKey(apiKeyId: string, customerProfileId: string) {
    const apiKey = await prisma.apiKey.findFirst({
      where: {
        id: apiKeyId,
        customerProfileId,
      },
      select: {
        id: true,
        description: true,
        status: true,
        lastUsedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!apiKey) {
      throw new NotFoundError('API Key');
    }

    return apiKey;
  }

  async createApiKey(
    customerProfileId: string,
    input: CreateApiKeyInput
  ): Promise<{
    id: string;
    key: string;
    description: string | null;
    status: string;
    createdAt: Date;
  }> {
    const { key, hash } = this.generateApiKey();

    const apiKey = await prisma.apiKey.create({
      data: {
        customerProfileId,
        createdByUserId: input.createdByUserId,
        description: input.description,
        apiKeyHash: hash,
        status: 'active',
      },
    });

    logger.info(
      { apiKeyId: apiKey.id, customerProfileId },
      'API key created'
    );

    return {
      id: apiKey.id,
      key, // Only returned once!
      description: apiKey.description,
      status: apiKey.status,
      createdAt: apiKey.createdAt,
    };
  }

  async revokeApiKey(apiKeyId: string, customerProfileId: string) {
    const apiKey = await prisma.apiKey.findFirst({
      where: {
        id: apiKeyId,
        customerProfileId,
      },
    });

    if (!apiKey) {
      throw new NotFoundError('API Key');
    }

    await prisma.apiKey.update({
      where: { id: apiKeyId },
      data: {
        status: 'revoked',
        revokedAt: new Date(),
      },
    });

    logger.info({ apiKeyId, customerProfileId }, 'API key revoked');
  }

  async verifyApiKey(key: string): Promise<{
    valid: boolean;
    customerProfileId?: string;
    apiKeyId?: string;
  }> {
    const hash = createHash('sha256').update(key).digest('hex');

    const apiKey = await prisma.apiKey.findFirst({
      where: {
        apiKeyHash: hash,
        status: 'active',
      },
      select: {
        id: true,
        customerProfileId: true,
      },
    });

    if (!apiKey) {
      return { valid: false };
    }

    // Update last used timestamp
    await prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    });

    return {
      valid: true,
      customerProfileId: apiKey.customerProfileId,
      apiKeyId: apiKey.id,
    };
  }
}
