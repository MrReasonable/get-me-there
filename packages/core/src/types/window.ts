import { z } from 'zod';

/**
 * Spec revision 56 §6.2: a local time window, `HH:mm` on the 24-hour clock at both ends (a start later than its end wraps
 * midnight, as `inWindow` reads it). One leaf schema, read by the definition's constraints (`api-contract/definitions.ts`)
 * and by the flight limits (`flights/choose.ts`), so the two can never accept different windows.
 */
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:mm');
export const localTimeWindowSchema = z.object({ from: timeOfDay, to: timeOfDay });
