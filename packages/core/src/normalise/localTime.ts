import { TZDate, tzOffset } from '@date-fns/tz';
import { NormalisationError } from '../errors.js';
import { isRealDate } from '../types/ids.js';

/** How a vendor states a segment time (spec §5.1 `RawSegment.timeKind`). */
export type TimeKind = 'local' | 'utc' | 'offset';

/** A wall-clock reading split into parts. */
export interface WallTime {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
  ms: number;
}

/** A vendor time string split into parts; `suffix` is `Z`, `±HH:MM`/`±HHMM`, or absent. */
export interface VendorTimeParts extends WallTime {
  suffix: string | undefined;
}

// why: vendors use `T` or a space, may omit seconds, and may append Z or an offset. Anything
// else (day-first dates, 12-hour clocks, epoch numbers) is rejected rather than guessed.
const VENDOR_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})?$/;

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

const pad = (n: number): string => String(n).padStart(2, '0');

/** Parse and range-check a vendor time; `bad-local-time` on any other shape. */
export function parseVendorTime(value: string): VendorTimeParts {
  const m = VENDOR_RE.exec(value.trim());
  if (m === null) {
    throw new NormalisationError('bad-local-time', `unrecognised time ${JSON.stringify(value)}`);
  }
  // why: each capture is read on its own; Number(undefined) is NaN, which isRealDate rejects, so
  // no cast is needed to satisfy noUncheckedIndexedAccess.
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const s = m[6] === undefined ? 0 : Number(m[6]);
  const ms = m[7] === undefined ? 0 : Number(m[7].padEnd(3, '0'));
  if (!isRealDate(y, mo, d) || h > 23 || mi > 59 || s > 59) {
    throw new NormalisationError('bad-local-time', `out-of-range time ${JSON.stringify(value)}`);
  }
  return { y, mo, d, h, mi, s, ms, suffix: m[8] };
}

/**
 * Throws `unknown-airport-tz` unless `tz` names an IANA zone the runtime knows. Spec §5.6.
 *
 * why: `tzOffset` is not a validator. It caches offsets under a key that is `""` on ICU builds that
 * print a zero offset as "GMT", and falls back to an unanchored `±HH` regex on the zone string, so
 * `''`, `'Garbage-05'` and `'+05:30'` can all yield a number (review arch-001). `Intl.DateTimeFormat`
 * throws RangeError on an unknown zone; offset-form strings are refused before it, because an
 * airport zone without DST rules would hash wrong wall times.
 */
export function requireZone(tz: string | null): string {
  if (tz === null || /^[+-]\d/.test(tz) || (!tz.includes('/') && tz !== 'UTC')) {
    throw new NormalisationError('unknown-airport-tz', `time zone ${JSON.stringify(tz)}`);
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    throw new NormalisationError('unknown-airport-tz', `time zone ${JSON.stringify(tz)}`);
  }
  return tz;
}

/**
 * The UTC instant (epoch ms) of a wall-clock time in `tz`, with the spec §5.6 DST rules:
 * a nonexistent wall time (spring-forward gap) shifts forward by the gap; an ambiguous one
 * (fall-back overlap) takes the first occurrence. `tz` must already have passed `requireZone`.
 *
 * why: `new TZDate(y, m, d, h, mi, tz)` resolves wall components through the *system* zone and
 * has no disambiguation option (context7 /date-fns/tz, src/date/mini.js), so it would make the
 * result depend on the host's TZ. We compute both candidate offsets with `tzOffset` instead.
 */
export function wallToInstant(p: WallTime, tz: string): number {
  const wall = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s, p.ms);
  const before = tzOffset(tz, new Date(wall - 24 * HOUR_MS));
  const after = tzOffset(tz, new Date(wall + 24 * HOUR_MS));
  const candidates = [wall - before * MINUTE_MS, wall - after * MINUTE_MS].sort((a, b) => a - b);
  const valid = candidates.filter((c) => tzOffset(tz, new Date(c)) * MINUTE_MS === wall - c);
  // why: no valid candidate means the wall time sits in a gap; reading it with the offset in
  // force before the gap lands after the gap, i.e. shifted forward by the gap length.
  return valid[0] ?? wall - before * MINUTE_MS;
}

/** `YYYY-MM-DDTHH:mm` wall-clock reading of an instant in `tz`. */
export function localMinute(instantMs: number, tz: string): string {
  const t = new TZDate(instantMs, tz);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
}

function suffixOffsetMinutes(suffix: string): number {
  if (suffix === 'Z') return 0;
  const sign = suffix.startsWith('-') ? -1 : 1;
  const digits = suffix.slice(1).replace(':', '');
  return sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
}

/**
 * Epoch ms of a vendor time. `utc` accepts a `Z` suffix or none; `offset` needs `Z` or `±HH:MM`;
 * `local` must carry no suffix and needs the airport's zone. A suffix that contradicts
 * `timeKind` is `bad-local-time`, never reinterpreted.
 */
export function vendorInstant(value: string, timeKind: TimeKind, tz: string): number {
  const p = parseVendorTime(value);
  if (timeKind === 'local') {
    if (p.suffix !== undefined) {
      throw new NormalisationError('bad-local-time', `local time with suffix ${JSON.stringify(value)}`);
    }
    return wallToInstant(p, requireZone(tz));
  }
  if (timeKind === 'utc' && p.suffix !== undefined && p.suffix !== 'Z') {
    throw new NormalisationError('bad-local-time', `utc time with offset ${JSON.stringify(value)}`);
  }
  if (timeKind === 'offset' && p.suffix === undefined) {
    throw new NormalisationError('bad-local-time', `offset time without offset ${JSON.stringify(value)}`);
  }
  const wall = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s, p.ms);
  return wall - suffixOffsetMinutes(p.suffix ?? 'Z') * MINUTE_MS;
}

/**
 * Departure (or arrival) wall time at the airport, exactly `YYYY-MM-DDTHH:mm`. Spec §5.6, §6.4.
 * UTC and offset inputs are converted into `tz`; local inputs are re-read through `tz` so a
 * nonexistent wall time comes out shifted forward. A zone the runtime does not know, or an
 * offset-form string, is `unknown-airport-tz` for every time kind: UTC is never hashed. (An
 * airport missing from the table is caught one step earlier, in `normaliseOffer`.)
 */
export function departLocal(value: string, timeKind: TimeKind, tz: string): string {
  const zone = requireZone(tz);
  return localMinute(vendorInstant(value, timeKind, zone), zone);
}
