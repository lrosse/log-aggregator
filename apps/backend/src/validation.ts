import { z } from 'zod';

const service = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
const level = z.enum(['info', 'warn', 'error']);

export const logInputSchema = z
  .object({
    service,
    level,
    message: z.string().trim().min(1).max(8000),
    timestamp: z.iso
      .datetime({ offset: true })
      .refine((value) => Number.isFinite(Date.parse(value)), 'Invalid timestamp'),
  })
  .strict();

export const logFilterSchema = z
  .object({
    service: service.optional(),
    level: level.optional(),
    q: z.string().trim().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();
