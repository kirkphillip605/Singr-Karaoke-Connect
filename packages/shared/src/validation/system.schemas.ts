import { z } from 'zod';

export const createSystemSchema = z.object({
  name: z.string().min(1, 'System name is required').max(255),
  configuration: z.record(z.unknown()).optional(),
});

export const updateSystemSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  configuration: z.record(z.unknown()).optional(),
});

export const searchSystemsSchema = z.object({
  search: z.string().max(100).optional(),
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
});

export type CreateSystemInput = z.infer<typeof createSystemSchema>;
export type UpdateSystemInput = z.infer<typeof updateSystemSchema>;
export type SearchSystemsInput = z.infer<typeof searchSystemsSchema>;
