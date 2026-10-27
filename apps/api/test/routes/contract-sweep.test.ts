// Spec §9 item 5 sweeps: strict mounting, auth flags, every GET against core/api-contract with provenance on every
// price, banned words in every API string, sentinel secrets never in a body or a log line.
import {
  apiContract,
  BANNED_WORD_ALLOWLIST,
  decodeDatePairs,
  findBannedWords,
  TRUNCATED_NOTE,
} from '@gmt/core';
import { AIRPORTS_DATA_DIR, loadAirportsDataset } from '@gmt/db';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../../src/app.js';
import { API_TEXT } from '../../src/text.js';
import { expectEnvelopeOrContract } from '../helpers/contract.js';
import { SENTINEL_AUTH, SENTINEL_SA, SENTINEL_TP } from '../helpers/env.js';
import { exampleDefinitionInput } from '../helpers/examples.js';
import { AUTH_USER, basic, createHarness, type Harness } from '../helpers/harness.js';
import { at, cell, seeder } from '../helpers/seed.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});
async function harness(env: Record<string, string> = {}): Promise<Harness> {
  h = await createHarness({ env });
  return h;
}

const C1 = cell('LHR', 'JFK', '2026-11-02', '2026-11-12');
const C2 = cell('LHR', 'JFK', '2026-11-03', '2026-11-13');
const mounted = apiContract.ROUTES;

/**
 * A small world touching every read route and every provenance shape (review TS-4): a parent execution, a calendar
 * price, a truncated tile, a confirmed observation, an unconfirmed one, an unknown-age one, a route-level point and an
 * alert rule.
 */
function seedWorld(x: Harness): { def: string; exec: string; alert: string } {
  const s = seeder(x.ports);
  const def = x.ports.repos.definitions.create(exampleDefinitionInput({ constraints: { maxStops: 1 } }));
  s.execution('E1', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
  s.cells('E1', [C1], { selected: [{ cell: C1, reason: 'top_n' }] });
  s.cells('E1', [C2]);
  s.tile('E1', C1, { status: 'priced', pricePence: 45_000, fetchedAt: at(-1) });
  s.tile('E1', C2, {
    status: 'priced',
    pricePence: 41_000,
    fetchedAt: at(-1),
    lastError: TRUNCATED_NOTE,
    tileIndex: 1,
  });
  s.verified('E1', C1, [
    { hash: 'hV', pricePence: 60_000, fetchedAt: at(-1) },
    { hash: 'hU', pricePence: 58_000, fetchedAt: at(-1), confirmed: false },
    { hash: 'hA', pricePence: 61_000, fetchedAt: at(-1), maxAgeHours: 'unknown' },
    // why: review SEC-R2-3: a hostile stored link, so a route that bypassed the re-validation fails the contract here
    {
      hash: 'hH',
      pricePence: 62_000,
      fetchedAt: at(-1),
      booking: {
        kind: 'post',
        url: 'https://user:pw@evil.example:8443/book',
        postData: 'a=1',
        host: 'evil.example',
      },
    },
  ]);
  s.routeLowest({
    origin: 'LHR',
    destination: 'JFK',
    date: '2026-11-02',
    pricePence: 40_000,
    fetchedAt: at(-1),
  });
  const alert = x.ports.repos.alerts.create({
    definitionId: def.id,
    type: 'absolute',
    thresholdPence: 50_000,
    pct: null,
    basis: 'verified',
    requireAllVerified: true,
    cooldownHours: 336,
    enabled: true,
  });
  return { def: def.id, exec: s.id('E1'), alert: alert.id };
}

function fill(path: string, ids: { def: string; exec: string; alert: string }): string {
  const p = path
    .replace(/^\/api\/definitions\/:id/, `/api/definitions/${ids.def}`)
    .replace(/^\/api\/executions\/:id/, `/api/executions/${ids.exec}`)
    .replace(/^\/api\/alerts\/:id/, `/api/alerts/${ids.alert}`)
    .replace(':hash', 'hV')
    .replace(':origin', 'LHR')
    .replace(':destination', 'JFK')
    .replace(':departureDate', '2026-11-02')
    .replace(':returnDate', '2026-11-12');
  return p === '/api/airports' ? `${p}?q=LHR` : p;
}
const missing = { def: 'zz-missing', exec: 'zz-missing', alert: 'zz-missing' };

const PRICE_KEYS = ['pricePence', 'minPence', 'lowestPricePence'] as const;

/**
 * Paths of every object holding a price (`pricePence`, `minPence`, `lowestPricePence`) that does not say where it came
 * from and how old it is (spec §10, review TS-4): it must carry `provenance` or a `providerId` + `sourceKind` pair, and a
 * `stale` flag unless its provenance is the cell-level roll-up's; a fixture price must be synthetic and the reverse.
 * Shape-based, so a price field a later change adds is checked without editing this list.
 */
function unlabelledPrices(
  v: unknown,
  path = '$',
  inherited: { stale: boolean } = { stale: false },
): string[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => unlabelledPrices(x, `${path}[${i}]`, inherited));
  if (v === null || typeof v !== 'object') return [];
  const o = z.record(z.string(), z.unknown()).parse(v);
  const scope = { stale: inherited.stale || 'stale' in o };
  const problems: string[] = [];
  if (PRICE_KEYS.some((k) => typeof o[k] === 'number')) {
    const prov = z.object({ providerId: z.string(), sourceKind: z.string() }).safeParse(o.provenance ?? o);
    if (!prov.success) problems.push(`${path}: price without provenance`);
    else if ((prov.data.providerId === 'fixture') !== (prov.data.sourceKind === 'synthetic'))
      problems.push(`${path}: fixture and synthetic must go together`);
    if (!scope.stale && !('verdictClass' in o) && !('status' in o))
      problems.push(`${path}: price without stale`);
  }
  return [...problems, ...Object.entries(o).flatMap(([k, x]) => unlabelledPrices(x, `${path}.${k}`, scope))];
}

/** Every user-facing string in a response: reasons, notices, messages, labels, notes, summaries, assumptions. */
function userStrings(v: unknown): string[] {
  if (Array.isArray(v)) return v.flatMap(userStrings);
  if (v === null || typeof v !== 'object') return [];
  return Object.entries(v).flatMap(([k, x]) => {
    if (['basisReason', 'message', 'label', 'ceilingNote', 'summary'].includes(k) && typeof x === 'string')
      return [x];
    if (['notices', 'assumptions', 'lines', 'notes'].includes(k) && Array.isArray(x))
      return x.filter((s): s is string => typeof s === 'string');
    return userStrings(x);
  });
}

/** Every API_TEXT entry as text: strings as they are, functions applied to sample arguments. */
function apiTexts(): string[] {
  return [
    API_TEXT.internal,
    API_TEXT.notFound,
    API_TEXT.unauthenticated,
    API_TEXT.rateLimited(42),
    API_TEXT.hostRejected('evil.example:3000'),
    API_TEXT.originRejected('https://evil.example'),
    API_TEXT.bodyTooLarge,
    API_TEXT.contentType,
    API_TEXT.requestedWith,
    API_TEXT.validation('body'),
    API_TEXT.malformedJson,
    API_TEXT.definitionNotFound,
    API_TEXT.executionNotFound,
    API_TEXT.noExecution,
    API_TEXT.alertNotFound,
    API_TEXT.emailNotConfigured,
    API_TEXT.emailLimit,
    API_TEXT.alreadyRunning,
    API_TEXT.unknownProvider('fixture'),
    API_TEXT.unknownDestination,
    API_TEXT.unknownScopeAirport('ZZZ'),
    API_TEXT.invalidJourneyLimit(60, 6000),
    API_TEXT.tooManyCells(60_000, 50_000),
    API_TEXT.datePairIncomplete,
    API_TEXT.invalidDatePair,
    API_TEXT.datePairOutsideSpace,
    API_TEXT.itineraryNotFound,
    API_TEXT.draftNotice,
    API_TEXT.draftCannotEnable,
    API_TEXT.draftNoEstimate,
    API_TEXT.deletedNotice,
    API_TEXT.invalidDefinition,
    API_TEXT.zeroCells,
    API_TEXT.invalidCron('sub-hourly schedules are not allowed'),
    API_TEXT.scheduleOverBudget(['provider-month:searchapi']),
    API_TEXT.coverageCheckUnavailable,
    API_TEXT.zeroCapVerification,
    API_TEXT.zeroCapBootWarning,
    API_TEXT.verifyZeroRunCap(6),
    API_TEXT.zeroRunCapDefault,
    API_TEXT.spendCapBelowFees(3000, 3200),
    API_TEXT.callCapGoverns('lifetime', 24),
    API_TEXT.ceilingNote(3500, 3200),
    API_TEXT.notCancellable('completed'),
    API_TEXT.cellNotInSpace,
    API_TEXT.unknownAirport('ZZZ'),
    API_TEXT.noVerificationProvider,
    API_TEXT.basisNoVerificationProvider,
    API_TEXT.basisNoObservations,
    API_TEXT.basisNoObservationsInSpace,
    API_TEXT.basisItinerarySearch,
    API_TEXT.basisRequestedCalendar,
    API_TEXT.insideSpace(0, 3),
    API_TEXT.toolUnavailable('record'),
    API_TEXT.toolBusy('record'),
    API_TEXT.recordingInContainer,
    API_TEXT.toolFailed('record'),
    API_TEXT.toolSynthetic('record'),
    API_TEXT.toolSummary('record', 0, 3),
  ];
}

describe('ROUTES mounting (spec §10)', () => {
  it('refuses a ROUTES entry without a handler and a handler without a ROUTES entry', async () => {
    const x = await harness();
    const extra = { method: 'GET', path: '/api/unmapped', response: z.object({}), auth: 'required' } as const;
    expect(() => createApp(x.ports, x.engine, { routes: [...apiContract.ROUTES, extra] })).toThrow(
      /no handler for GET \/api\/unmapped/,
    );
    expect(() =>
      createApp(x.ports, x.engine, { routes: apiContract.ROUTES.filter((r) => r.path !== '/api/budget') }),
    ).toThrow(/no route for handler GET \/api\/budget/);
  });

  it('every ROUTES entry is mounted with its method and auth flag, and answers the contract or the envelope', async () => {
    const x = await harness();
    for (const route of mounted) {
      const path = fill(route.path, missing);
      const json = route.method === 'GET' ? undefined : {};
      const anonymous = await x.request(path, {
        method: route.method,
        auth: false,
        ...(json === undefined ? {} : { json }),
      });
      if (route.auth === 'required')
        expect(anonymous.status, `${route.method} ${route.path} without auth`).toBe(401);
      else expect(anonymous.status, `${route.method} ${route.path} is public`).not.toBe(401);
      const authed = await x.request(path, { method: route.method, ...(json === undefined ? {} : { json }) });
      const body = await expectEnvelopeOrContract(authed, route.method, route.path);
      const parsed = apiContract.errorEnvelopeSchema.safeParse(body);
      expect(parsed.success && parsed.data.error.code, `${route.method} ${route.path} is mounted`).not.toBe(
        'not_found',
      );
    }
  });
});

describe('every GET route against the contract, with provenance on every price (spec §9 item 5)', () => {
  it('validates each response and finds no price without provenance', async () => {
    const x = await harness();
    const ids = seedWorld(x);
    for (const route of mounted.filter((r) => r.method === 'GET')) {
      const res = await x.request(fill(route.path, ids));
      expect(res.status, route.path).toBe(200);
      const body = await expectEnvelopeOrContract(res, 'GET', route.path);
      expect(unlabelledPrices(body), route.path).toEqual([]);
      expect(JSON.stringify(body), route.path).not.toContain('evil.example:8443'); // the hostile stored link
    }
  });
});

describe('the date-pairs route by shape (spec §10, WP19)', () => {
  it("every decoded figure and cheaper-cached price carries its provenance and stale flag; the body's strings pass", async () => {
    const x = await harness();
    const ids = seedWorld(x);
    const res = await x.request(`/api/definitions/${ids.def}/date-pairs`);
    const body = apiContract.datePairsResponseSchema.parse(await res.json());
    // why: the wire's columns index a provenance table, so the shape check runs on the decoder's records, which are
    // the only form the web reads (spec §10)
    const figures = decodeDatePairs(body).pairs.flatMap((p) => (p.figure === null ? [] : [p.figure]));
    expect(figures.length).toBeGreaterThan(0);
    expect(unlabelledPrices(figures.map((f) => f.price))).toEqual([]);
    expect(
      unlabelledPrices(figures.flatMap((f) => (f.cheaperCached === null ? [] : [f.cheaperCached]))),
    ).toEqual([]);
    for (const t of userStrings(body)) expect(findBannedWords(t, BANNED_WORD_ALLOWLIST), t).toEqual([]);
  });
});

describe('banned words in API strings (spec §11, §8.3)', () => {
  it('no fixed API string contains a banned word, and every API_TEXT entry is checked', () => {
    const texts = apiTexts();
    expect(texts).toHaveLength(Object.keys(API_TEXT).length);
    for (const text of texts) expect(findBannedWords(text, BANNED_WORD_ALLOWLIST), text).toEqual([]);
    // why: CodeRabbit batch 3 — tests name only the worked example's airports; a sample code for "not in the airports
    // table" must be one the dataset does not hold (AAA is Anaa, a real airport), so it names no other place
    const dataset = loadAirportsDataset(AIRPORTS_DATA_DIR);
    const places = new Set([...dataset.airports.map((a) => a.iata), ...Object.keys(dataset.metros)]);
    const example = new Set(['LHR', 'LGW', 'JFK', 'EWR', 'LON', 'NYC']);
    const named = texts.flatMap((t) => [...t.matchAll(/\b[A-Z]{3}\b/g)].map((m) => m[0]));
    expect(named.filter((c) => places.has(c) && !example.has(c) && c !== 'GBP' && c !== 'API')).toEqual([]);
  });

  it('no reason, notice, message, label or summary in any response contains a banned word', async () => {
    const x = await harness();
    const ids = seedWorld(x);
    const texts: string[] = [];
    for (const route of mounted.filter((r) => r.method === 'GET'))
      texts.push(...userStrings(await (await x.request(fill(route.path, ids))).json()));
    texts.push(...userStrings(await (await x.request('/api/definitions', { method: 'POST' })).json()));
    texts.push(...userStrings(await (await x.request('/api/providers', { auth: false })).json()));
    expect(texts.length).toBeGreaterThan(3);
    for (const t of texts) expect(findBannedWords(t, BANNED_WORD_ALLOWLIST), t).toEqual([]);
  });
});

describe('sentinel secrets never reach a body or a log line (spec §5.3)', () => {
  it('provider keys and the auth password stay out of every response and log', async () => {
    const x = await harness({
      TRAVELPAYOUTS_TOKEN: SENTINEL_TP,
      SEARCHAPI_KEY: SENTINEL_SA,
      SEARCHAPI_PLAN: '40usd',
    });
    const ids = seedWorld(x);
    const bodies: string[] = [];
    for (const route of mounted.filter((r) => r.method === 'GET'))
      bodies.push(await (await x.request(fill(route.path, ids))).text());
    bodies.push(
      await (
        await x.request('/api/providers', { headers: { authorization: basic(SENTINEL_SA, SENTINEL_TP) } })
      ).text(),
    );
    bodies.push(await (await x.request('/api/definitions', { json: { name: SENTINEL_SA } })).text());
    // why: review SEC-6: a secret the client sends back in a path, a query or a malformed body is never echoed
    bodies.push(await (await x.request(`/api/definitions/${SENTINEL_SA}`)).text());
    bodies.push(await (await x.request(`/api/executions/${SENTINEL_TP}`)).text());
    bodies.push(
      await (await x.request(`/api/definitions/${ids.def}/calendar?destination=${SENTINEL_SA}`)).text(),
    );
    bodies.push(await (await x.request(`/api/airports?q=${SENTINEL_TP}&limit=${SENTINEL_SA}`)).text());
    bodies.push(
      await (
        await x.request('/api/definitions', { method: 'POST', body: `{"name":"${SENTINEL_TP}"` })
      ).text(),
    );
    bodies.push(
      await (
        await x.request('/api/cells/verify', {
          json: { definitionId: SENTINEL_SA, cell: { origin: SENTINEL_TP } },
        })
      ).text(),
    );
    const everything = [...bodies, ...x.logLines].join('\n');
    // why: review SEC-R2-4: a logged Basic header would hold the base64 of user:pass, which contains neither sentinel
    const encoded = [basic(AUTH_USER, SENTINEL_AUTH), basic(SENTINEL_SA, SENTINEL_TP)].map((b) =>
      b.slice('Basic '.length),
    );
    for (const secret of [SENTINEL_AUTH, SENTINEL_SA, SENTINEL_TP, ...encoded])
      expect(everything).not.toContain(secret);
  });
});
