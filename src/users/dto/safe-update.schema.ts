import { z } from 'zod';

export const SafeUpdateSchema = z.object({
  fullName: z.string().min(1).max(100).optional(),

  profile: z
    .object({
      bio: z.string().max(500).optional(),
      website: z.string().url().optional(),
      avatarUrl: z.string().url().optional(),
    })
    .strict()
    .optional(),
}).strict();