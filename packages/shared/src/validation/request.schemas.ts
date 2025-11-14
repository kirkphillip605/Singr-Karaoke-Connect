import { z } from 'zod';

export const createRequestSchema = z.object({
  artist: z.string().min(1, 'Artist is required'),
  title: z.string().min(1, 'Title is required'),
  keyChange: z.number().int().default(0),
  notes: z.string().optional(),
  guestName: z.string().optional(),
});

export const updateRequestSchema = z.object({
  processed: z.boolean().optional(),
  notes: z.string().optional(),
});

export const listRequestsSchema = z.object({
  processed: z.boolean().optional(),
  since: z.string().datetime().optional(),
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
});

export type CreateRequestInput = z.infer<typeof createRequestSchema>;
export type UpdateRequestInput = z.infer<typeof updateRequestSchema>;
export type ListRequestsInput = z.infer<typeof listRequestsSchema>;
