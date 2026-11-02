import { z } from 'zod';

/**
 * A local wall-clock time, `HH:MM` on the 24-hour clock (`24:00` and an unpadded hour refused): the one pattern a
 * definition's windows, a list page's flight times and a pairing's times on the wire share (review finding 6).
 */
export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Spec revision 56 §6.2: a local time window, `HH:mm` at both ends (a start later than its end wraps midnight, as
 * `inWindow` reads it). The definition's constraints (`api-contract/definitions.ts`) read it as they always have (an
 * unknown key stripped); the flight limits read its strict form, so a stored or sent window carries nothing else.
 */
const timeOfDay = z.string().regex(HHMM, 'HH:mm');
const windowShape = { from: timeOfDay, to: timeOfDay };
export const localTimeWindowSchema = z.object(windowShape);
/** The same window, strict: what `flightLimitsSchema` stores and the worker request carries. */
export const strictLocalTimeWindowSchema = z.strictObject(windowShape);
