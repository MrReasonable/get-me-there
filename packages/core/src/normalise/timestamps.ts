import { type IsoDateTime, isoDateTimeOfEpochMs } from '../types/ids.js';
import { type TimeKind, vendorInstant } from './localTime.js';

/**
 * A vendor time as the one stored timestamp form, `Date#toISOString()` (spec §6.3:
 * "vendor times normalised to it in `core`"). Same accepted shapes and DST rules as
 * `departLocal`; `tz` is read only for `local` input (pass the airport's zone regardless).
 */
export function toIsoDateTime(value: string, timeKind: TimeKind, tz: string): IsoDateTime {
  return isoDateTimeOfEpochMs(vendorInstant(value, timeKind, tz));
}
