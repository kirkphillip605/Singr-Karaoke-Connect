import { z } from 'zod';

export const createApiKeySchema = z.object({
  description: z.string().min(1, 'Description is required').max(500),
});

export const listApiKeysSchema = z.object({
  status: z.enum(['active', 'revoked', 'expired', 'suspended']).optional(),
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
});

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
export type ListApiKeysInput = z.infer<typeof listApiKeysSchema>;
