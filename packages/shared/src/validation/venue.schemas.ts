import { z } from 'zod';

export const createVenueSchema = z.object({
  name: z.string().min(1, 'Venue name is required'),
  urlName: z
    .string()
    .regex(/^[a-z0-9-]+$/, 'URL name must contain only lowercase letters, numbers, and hyphens')
    .min(3, 'URL name must be at least 3 characters'),
  address: z.string().min(1, 'Address is required'),
  city: z.string().min(1, 'City is required'),
  state: z.string().min(2, 'State is required'),
  postalCode: z.string().min(1, 'Postal code is required'),
  country: z.string().default('USA'),
  phoneNumber: z.string().optional(),
  website: z.string().url().optional().or(z.literal('')),
  acceptingRequests: z.boolean().default(true),
});

export const updateVenueSchema = z.object({
  name: z.string().min(1).optional(),
  address: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
  state: z.string().min(2).optional(),
  postalCode: z.string().min(1).optional(),
  country: z.string().optional(),
  phoneNumber: z.string().optional().nullable(),
  website: z.string().url().optional().or(z.literal('')).nullable(),
  acceptingRequests: z.boolean().optional(),
});

export const searchVenuesSchema = z.object({
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  radiusMiles: z.number().min(1).max(100).default(25),
  acceptingRequests: z.boolean().optional(),
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
});

export type CreateVenueInput = z.infer<typeof createVenueSchema>;
export type UpdateVenueInput = z.infer<typeof updateVenueSchema>;
export type SearchVenuesInput = z.infer<typeof searchVenuesSchema>;
