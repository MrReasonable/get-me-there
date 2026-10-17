// Spec §9 item 4, layer B (WP13): the engine over the real adapters on WP4b's recorded session. Skips visibly when the
// local-only recordings are absent (plan decisions 61, 64).
import { asIata, asIsoDate } from '@gmt/core';
import { skipTitle } from '@gmt/providers/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createEngine } from '../../src/engine.js';
import {
  type LayerB,
  layerB,
  PRESENT,
  recordedChain,
  recordedDefinition,
  recordedSession,
  settled,
} from './support.js';

let open: LayerB | undefined;
afterEach(() => {
  open?.close();
  open = undefined;
});

interface PriceRow {
  provider_id: string;
  source_kind: string;
  point_of_sale: string;
  max_age_hours: number | null;
  fetched_at: string;
  provider_observed_at: string | null;
  reused_from_execution_id: string | null;
  fx_converted: number;
}
interface ObservationRow {
  provider_id: string;
  seller: string;
  source_kind: string;
  max_age_hours: number | null;
  point_of_sale: string;
  fetched_at: string;
  fx_converted: number;
  supplied_fields_json: string;
  booking_json: string | null;
}
/** A stored booking, read as unknown and narrowed (no cast; arch-wp13-r1-009). */
const bookingSchema = z.union([
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.string(), url: z.string() }),
]);
const suppliedSchema = z.array(z.string());

describe.skipIf(!PRESENT)(
  skipTitle('layer B: the engine over the real adapters on the recorded session (spec §9 item 4)', PRESENT),
  () => {
    it('discovery: one Travelpayouts month tile and one 9 × 20 SearchApi rectangle, provenance on every row, cache absence as no_data, then a reuse run with no call (spec §5.2, §8.1)', async () => {
      const { session, at } = recordedSession();
      const b = layerB(session, at);
      open = b;
      const engine = createEngine(b.deps);
      const def = b.repos.definitions.create(recordedDefinition());
      const first = await engine.start(def.id, { trigger: 'manual' });
      if (!first.ok) throw new Error(`start refused: ${first.code}: ${first.message}`);
      expect((await settled(b.repos, first.executionId)).status).toBe('completed');
      const counts = b.repos.ledger.countsFor(first.executionId);
      expect(counts.perProvider.map((p) => [p.providerId, p.stage, p.tiles, p.cacheHits])).toEqual([
        ['searchapi', 'discovery', 1, 0],
        ['travelpayouts', 'discovery', 1, 0],
      ]);
      const rows = b.db.raw
        .prepare<[string], PriceRow>(
          'SELECT provider_id, source_kind, point_of_sale, max_age_hours, fetched_at, provider_observed_at, reused_from_execution_id, fx_converted FROM calendar_prices WHERE execution_id = ?',
        )
        .all(first.executionId);
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(r.reused_from_execution_id).toBeNull();
        expect(r.fx_converted).toBe(0); // GBP from the vendor, never converted (Global Constraints)
        expect(r.fetched_at >= at).toBe(true);
        expect([r.provider_id, r.source_kind, r.point_of_sale, r.max_age_hours]).toEqual([
          'searchapi',
          'scraped-aggregate',
          'GB',
          24,
        ]);
      }
      // why: the recorded Aviasales cache holds no row departing in these nine days, so every covered cell is no_data,
      // never empty: absence from a cache is not evidence of no fares (spec §5.2 "empty is per capability")
      const tpCells = b.repos.cells.outcomes(first.executionId, {
        stage: 'discovery',
        providerId: 'travelpayouts',
      });
      expect(tpCells.length).toBe(9 * 12); // nine departure days × 10–21 nights
      expect(new Set(tpCells.map((o) => o.status))).toEqual(new Set(['no_data']));

      const second = await engine.start(def.id, { trigger: 'manual' });
      if (!second.ok) throw new Error(`start refused: ${second.code}: ${second.message}`);
      expect((await settled(b.repos, second.executionId)).status).toBe('completed');
      expect(b.repos.ledger.countsFor(second.executionId).calls).toBe(0);
      const reused = b.db.raw
        .prepare<[string], PriceRow>('SELECT * FROM calendar_prices WHERE execution_id = ?')
        .all(second.executionId);
      expect(reused.length).toBe(rows.length);
      for (const r of reused) expect(r.reused_from_execution_id).toBe(first.executionId);
      await engine.shutdown();
      expect(b.misses()).toEqual([]);
    }, 60_000);

    it('Travelpayouts rows the vendor dated: authorised-cached provenance with the search date the vendor states (spec §3; decision 35)', async () => {
      const { session, at } = recordedSession();
      const b = layerB(session, at);
      open = b;
      const engine = createEngine(b.deps);
      // why: the recorded LHR → JFK March tile prices 2027-03-15/20 and 2027-03-17/24; the same month tile is requested
      const def = b.repos.definitions.create(
        recordedDefinition({
          window: { kind: 'absolute', from: asIsoDate('2027-03-15'), to: asIsoDate('2027-03-17') },
          minNights: 5,
          maxNights: 7,
          providers: { discovery: ['travelpayouts'], verification: [], discoveryRefreshHours: {} },
        }),
      );
      const run = await engine.start(def.id, { trigger: 'manual' });
      if (!run.ok) throw new Error(`start refused: ${run.code}: ${run.message}`);
      expect((await settled(b.repos, run.executionId)).status).toBe('completed');
      const rows = b.db.raw
        .prepare<[string], PriceRow>('SELECT * FROM calendar_prices WHERE execution_id = ?')
        .all(run.executionId);
      expect(rows.length).toBe(2);
      for (const r of rows) {
        expect([r.source_kind, r.point_of_sale, r.max_age_hours]).toEqual([
          'authorised-cached',
          'unknown',
          48,
        ]);
        // why: provenance review, fix round 1: the same row checks as the SearchApi discovery case
        expect([r.provider_id, r.fx_converted, r.reused_from_execution_id]).toEqual([
          'travelpayouts',
          0,
          null,
        ]);
        expect(r.fetched_at >= at).toBe(true);
        expect(r.provider_observed_at === null ? null : r.provider_observed_at < r.fetched_at).toBe(true);
      }
      await engine.shutdown();
      expect(b.misses()).toEqual([]);
    }, 60_000);

    it('verification: the recorded chain for its cell as a child execution, scraped-search provenance, every offer naming its seller and at least one price confirmed by a seller listing (spec §5.4; decisions 27, 37)', async () => {
      const { session, at } = recordedSession();
      const { cell, expandTop } = recordedChain(session);
      const b = layerB(session, at);
      open = b;
      const engine = createEngine(b.deps);
      const def = b.repos.definitions.create(
        recordedDefinition({
          providers: { discovery: [], verification: ['searchapi'], discoveryRefreshHours: {} },
          verification: { maxCells: 1, topN: 1, alwaysInclude: [], expandTop, bookingLinks: true },
        }),
      );
      const key = {
        origin: asIata('LHR'),
        destination: asIata('JFK'),
        departureDate: asIsoDate(cell.departureDate),
        returnDate: asIsoDate(cell.returnDate),
      };
      const child = await engine.verifyCell(def.id, key);
      if (!child.ok) throw new Error(`verify refused: ${child.code}: ${child.message}`);
      expect((await settled(b.repos, child.executionId)).status).toBe('completed');
      const obs = b.db.raw
        .prepare<[string], ObservationRow>(
          `SELECT o.provider_id, o.seller, p.source_kind, p.max_age_hours, p.point_of_sale, p.fetched_at, p.fx_converted,
                  p.supplied_fields_json, p.booking_json
             FROM price_observations p JOIN fare_offers o ON o.id = p.offer_id WHERE p.execution_id = ?`,
        )
        .all(child.executionId);
      expect(obs.length).toBeGreaterThan(0);
      let confirmed = 0;
      for (const o of obs) {
        expect([o.provider_id, o.source_kind, o.max_age_hours, o.point_of_sale, o.fx_converted]).toEqual([
          'searchapi',
          'scraped-search',
          null,
          'GB',
          0,
        ]);
        expect(o.fetched_at >= at).toBe(true);
        expect(o.seller.trim()).not.toBe('');
        // why: decision 37: an offer whose price is not a supplied field is "price not confirmed by the final step"
        if (suppliedSchema.parse(JSON.parse(o.supplied_fields_json)).includes('price')) confirmed += 1;
        const booking = bookingSchema.parse(
          o.booking_json === null ? { kind: 'none' } : JSON.parse(o.booking_json),
        );
        if ('url' in booking) expect(new URL(booking.url).hostname.endsWith('google.com')).toBe(true);
      }
      expect(confirmed).toBeGreaterThan(0);
      expect(b.repos.ledger.countsFor(child.executionId).calls).toBeLessThanOrEqual(1 + 2 * expandTop);
      await engine.shutdown();
      expect(b.misses()).toEqual([]);
    }, 60_000);
  },
);
