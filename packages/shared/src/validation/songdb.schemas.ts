import { z } from 'zod';

export const searchSongsSchema = z.object({
  systemId: z.string().uuid().optional(),
  search: z.string().min(2).optional(),
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
});

export const bulkImportSongsSchema = z.object({
  openkjSystemId: z.number().int().positive(),
  songs: z
    .array(
      z.object({
        artist: z.string().min(1, 'Artist is required'),
        title: z.string().min(1, 'Title is required'),
      })
    )
    .min(1)
    .max(10000), // Max 10k songs per import
});

export const deleteBulkSongsSchema = z.object({
  systemId: z.string().uuid(),
});

export type SearchSongsInput = z.infer<typeof searchSongsSchema>;
export type BulkImportSongsInput = z.infer<typeof bulkImportSongsSchema>;
export type DeleteBulkSongsInput = z.infer<typeof deleteBulkSongsSchema>;
