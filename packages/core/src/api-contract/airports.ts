import { z } from 'zod';
import { iataSchema } from '../types/ids.js';

/** `GET /api/airports?q=`: up to 20 rows, prefix match on iata, then city/name substring. */
export const airportsQuerySchema = z.object({ q: z.string().min(1).max(40) });
export const airportsResponseSchema = z.array(
  z.object({
    iata: iataSchema,
    name: z.string(),
    city: z.string(),
    country: z.string(),
    tz: z.string(),
    metro: z.string().nullable(),
  }),
);
