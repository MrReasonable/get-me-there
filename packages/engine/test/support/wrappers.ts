/**
 * Provider decorators for layer-A tests. Each wraps the fixture provider and changes one thing the test needs; the
 * result keeps the id `fixture` and sourceKind `synthetic` (ruling 1), and every call it makes still goes through
 * http-kit, the ledger and the cache. No wrapper invents a price: it rewrites, drops or re-requests what the fixture
 * server answered.
 */
import type {
  Cabin,
  CellKey,
  DiscoveryCapability,
  DiscoveryTileResult,
  FlightProvider,
  ItinerarySearchResult,
  RawCalendarPrice,
  RawOffer,
  VerificationCapability,
} from '@gmt/core';
import { discoveryOf, verificationOf } from './harness.js';

function shell(
  p: FlightProvider,
  parts: {
    discovery?: DiscoveryCapability;
    verification?: VerificationCapability;
    cabins?: readonly Cabin[];
  },
): FlightProvider {
  const discovery = parts.discovery ?? p.discovery;
  const verification = parts.verification ?? p.verification;
  return {
    id: p.id,
    displayName: p.displayName,
    suppliedFields: p.suppliedFields,
    cabins: parts.cabins ?? p.cabins,
    ...(discovery !== undefined ? { discovery } : {}),
    ...(verification !== undefined ? { verification } : {}),
    healthcheck: (ctx) => p.healthcheck(ctx),
  };
}

/** Declares only `cabins` (the provider sells nothing else; spec rev 10 cabin-not-offered). */
export function withCabins(p: FlightProvider, cabins: readonly Cabin[]): FlightProvider {
  return shell(p, { cabins });
}

/** Rewrites every tile result (e.g. covered cells the engine did not plan). */
export function mapTiles(
  p: FlightProvider,
  f: (r: DiscoveryTileResult) => DiscoveryTileResult,
): FlightProvider {
  const d = discoveryOf(p);
  return shell(p, {
    discovery: {
      info: d.info,
      plan: (q) => d.plan(q),
      fetchTile: async (plan, q, ctx) => f(await d.fetchTile(plan, q, ctx)),
    },
  });
}

/** Rewrites every raw calendar price of every tile (e.g. a different currency). */
export function mapPrices(
  p: FlightProvider,
  f: (price: RawCalendarPrice, i: number) => RawCalendarPrice,
): FlightProvider {
  return mapTiles(p, (r) => (r.kind === 'tile' ? { ...r, prices: r.prices.map(f) } : r));
}

/** Rewrites the whole result of every itinerary search (offers, coverage, partial, route history). */
export function mapResult(
  p: FlightProvider,
  f: (r: ItinerarySearchResult) => ItinerarySearchResult,
): FlightProvider {
  const v = verificationOf(p);
  return shell(p, {
    verification: {
      info: v.info,
      estimate: (q) => v.estimate(q),
      search: async (q, ctx) => f(await v.search(q, ctx)),
    },
  });
}

/** Rewrites every raw offer of every itinerary search. */
export function mapOffers(p: FlightProvider, f: (offer: RawOffer, i: number) => RawOffer): FlightProvider {
  return mapResult(p, (r) => ({ ...r, offers: r.offers.map(f) }));
}

/** Makes itinerary search throw `err` for cells matching `when`, without calling the fixture server. */
export function throwOnSearch(
  p: FlightProvider,
  err: Error,
  when: (cell: CellKey) => boolean,
): FlightProvider {
  const v = verificationOf(p);
  return shell(p, {
    verification: {
      info: v.info,
      estimate: (q) => v.estimate(q),
      search: async (q, ctx) => {
        if (when(q)) throw err;
        return v.search(q, ctx);
      },
    },
  });
}

/** Re-requests every tile under a second tile index, breaking parity on purpose (distinct tile requests = 2 × plan). */
export function extraTile(p: FlightProvider): FlightProvider {
  const d = discoveryOf(p);
  return shell(p, {
    discovery: {
      info: d.info,
      plan: (q) => d.plan(q),
      fetchTile: async (plan, q, ctx) => {
        await d.fetchTile({ ...plan, index: plan.index + 1000 }, q, ctx);
        return d.fetchTile(plan, q, ctx);
      },
    },
  });
}

/** A plan that leaves out the first cell of every pair: tiles no longer partition the cells (ssr-06). */
export function dropPlanCell(p: FlightProvider): FlightProvider {
  const d = discoveryOf(p);
  return shell(p, {
    discovery: {
      info: d.info,
      plan: (q) => d.plan(q).map((t, i) => (i === 0 ? { ...t, coveredCells: t.coveredCells.slice(1) } : t)),
      fetchTile: (plan, q, ctx) => d.fetchTile(plan, q, ctx),
    },
  });
}
