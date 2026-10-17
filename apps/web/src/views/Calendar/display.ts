import { compareAges, effectiveAge, type IsoDateTime } from '@gmt/core';
import { bestCovered } from './marker.js';
import type { DayBasis, DayPrice, DaySlice, GlyphStatus, GridDay } from './types.js';

/** Why a priceless day shows what it shows. */
export type GlyphReason =
  /** one glyph per non-zero unpriced bucket */
  | 'counts'
  /** discovery is configured but no run has outcome rows for this day yet: not searched */
  | 'no-run'
  /** the definition has no discovery provider */
  | 'no-provider';

/** One glyph of a priceless day and its cell count (null when no run has counted the day: review ui-r2-003). */
export interface Glyph {
  status: GlyphStatus;
  count: number | null;
}

/** What one calendar day shows (spec §11 View B). */
export type DayDisplay =
  | {
      kind: 'price';
      basis: DayBasis;
      price: DayPrice;
      stale: boolean;
      why:
        | 'fresh-verified'
        | 'stale-verified-fresher'
        | 'calendar-fresher'
        | 'stale-verified-only'
        | 'calendar-only';
      /** A cheaper calendar price the verified day price hides (plan decision 38: "cached from £X"). */
      cheaperCached: DayPrice | null;
    }
  | { kind: 'glyphs'; glyphs: Glyph[]; reason: GlyphReason };

const GLYPH_ORDER: readonly GlyphStatus[] = ['empty', 'no_data', 'error', 'skipped', 'not_run'];

function priceless(slice: DaySlice): DayDisplay {
  if (slice.discoveryProviders.length === 0) return { kind: 'glyphs', glyphs: [], reason: 'no-provider' };
  // why: WP8 sends discovery [] for a day no run has reached (no parent yet, or a relative window that moved on): not searched.
  const best = bestCovered(slice.discovery);
  if (best === null)
    return { kind: 'glyphs', glyphs: [{ status: 'not_run', count: null }], reason: 'no-run' };
  // why: ui-r2-003 — counts from one source (the cue's best-covered one), so "1 no fares, 47 not searched" never
  // reads like "47 no fares, 1 not searched", and two providers' states are never mixed; the panel lists every source.
  const glyphs = GLYPH_ORDER.filter((s) => best.buckets[s] > 0).map((status) => ({
    status,
    count: best.buckets[status],
  }));
  return { kind: 'glyphs', glyphs, reason: 'counts' };
}

/**
 * Spec §11 precedence: a class-verified price that is not stale (the api's `stale` uses STALE_AFTER_HOURS, §8.1);
 * else the fresher of a stale verified price and the cheapest calendar price (unknown age loses to known, two unknowns
 * and equal ages go to verified); else glyphs. Partially-verified prices never become the day price.
 */
export function resolveDayDisplay(slice: DaySlice, now: IsoDateTime): DayDisplay {
  const v = slice.cheapestVerified;
  const c = slice.cheapestCalendar;
  const cheaper = (shown: DayPrice) => (c !== null && c.pricePence < shown.pricePence ? c : null);
  if (v !== null && !v.stale) {
    return {
      kind: 'price',
      basis: 'verified',
      price: v,
      stale: false,
      why: 'fresh-verified',
      cheaperCached: cheaper(v),
    };
  }
  if (v !== null && c !== null) {
    // why: §8.1 — compareAges(a, b) < 0 means a is fresher; unknown loses to any known age; ties go to verified.
    const cmp = compareAges(effectiveAge(v.provenance, now), effectiveAge(c.provenance, now));
    return cmp <= 0
      ? {
          kind: 'price',
          basis: 'verified',
          price: v,
          stale: true,
          why: 'stale-verified-fresher',
          cheaperCached: cheaper(v),
        }
      : {
          kind: 'price',
          basis: 'calendar',
          price: c,
          stale: c.stale,
          why: 'calendar-fresher',
          cheaperCached: null,
        };
  }
  if (v !== null)
    return {
      kind: 'price',
      basis: 'verified',
      price: v,
      stale: true,
      why: 'stale-verified-only',
      cheaperCached: null,
    };
  if (c !== null)
    return {
      kind: 'price',
      basis: 'calendar',
      price: c,
      stale: c.stale,
      why: 'calendar-only',
      cheaperCached: null,
    };
  return priceless(slice);
}

/**
 * The default colour basis (plan decision 38): the calendar basis unless days showing a class-verified price are a
 * strict majority of the priced days, judged over all destinations so a filter change never flips what colour means.
 */
export function defaultColourBasis(
  days: readonly GridDay[],
  hasVerification: boolean,
  now: IsoDateTime,
): DayBasis {
  if (!hasVerification) return 'calendar';
  let priced = 0;
  let verified = 0;
  for (const d of days) {
    const disp = resolveDayDisplay(d.slice, now);
    if (disp.kind !== 'price') continue;
    priced += 1;
    if (disp.basis === 'verified') verified += 1;
  }
  return verified * 2 > priced ? 'verified' : 'calendar';
}
