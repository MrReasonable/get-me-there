// The worker's limits as behaviour and as source facts (brief Task 14.11; TS-02, TS-03, arch-016, TS2-10): not string
// scans, but a full page session over the fake browser and the TypeScript compiler API over src/.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asIata, asIsoDate } from '@gmt/core';
import ts from 'typescript';
import { beforeEach, describe, expect, it } from 'vitest';
import { CooldownStore } from '../src/cooldown.js';
import { buildLaunchOptions } from '../src/launch.js';
import { MonthlyCounter } from '../src/monthly.js';
import { Pacer } from '../src/pacer.js';
import { Refusal } from '../src/refusal.js';
import { PageSession } from '../src/session.js';
import { loadSocs, socsCookie } from '../src/socs.js';
import { FakeContext } from './support/fakeContext.js';
import { n, resultsTree } from './support/fakePage.js';
import { memoryLog } from './support/log.js';
import { fakeTimers } from './support/timers.js';
import { tmpDir } from './support/tmp.js';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const PKG = fileURLToPath(new URL('../package.json', import.meta.url));
const sources = readdirSync(SRC)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => ({
    f,
    sf: ts.createSourceFile(f, readFileSync(join(SRC, f), 'utf8'), ts.ScriptTarget.Latest, true),
  }));

function visit(node: ts.Node, fn: (n: ts.Node) => void): void {
  fn(node);
  ts.forEachChild(node, (c) => visit(c, fn));
}
/** Calls whose callee name (`x.name(...)` or `name(...)`) is `name`, with their file. */
function callsTo(name: string): Array<{ f: string; call: ts.CallExpression }> {
  const out: Array<{ f: string; call: ts.CallExpression }> = [];
  for (const { f, sf } of sources)
    visit(sf, (x) => {
      if (!ts.isCallExpression(x)) return;
      const e = x.expression;
      const callee = ts.isPropertyAccessExpression(e) ? e.name.text : ts.isIdentifier(e) ? e.text : '';
      if (callee === name) out.push({ f, call: x });
    });
  return out;
}
/** Files importing any of `names` from a module. */
function importersOf(names: readonly string[]): string[] {
  const out = new Set<string>();
  for (const { f, sf } of sources)
    for (const st of sf.statements)
      if (
        ts.isImportDeclaration(st) &&
        st.importClause?.namedBindings !== undefined &&
        ts.isNamedImports(st.importClause.namedBindings)
      )
        for (const el of st.importClause.namedBindings.elements) if (names.includes(el.name.text)) out.add(f);
  return [...out].sort();
}
/** Files importing anything from the module `spec` (as written, e.g. './gridRecord.js'). */
function moduleImporters(spec: string): string[] {
  const out = new Set<string>();
  for (const { f, sf } of sources)
    for (const st of sf.statements)
      if (
        ts.isImportDeclaration(st) &&
        ts.isStringLiteral(st.moduleSpecifier) &&
        st.moduleSpecifier.text === spec
      )
        out.add(f);
  return [...out].sort();
}
/** A delay a reviewer can read: a number, a name, a field, or arithmetic over those; never a call (no jitter). */
function plainDelay(e: ts.Expression): boolean {
  if (ts.isNumericLiteral(e) || ts.isIdentifier(e) || ts.isPropertyAccessExpression(e)) return true;
  if (ts.isParenthesizedExpression(e)) return plainDelay(e.expression);
  if (ts.isBinaryExpression(e)) return plainDelay(e.left) && plainDelay(e.right);
  return false;
}

beforeEach(() => {
  expect.hasAssertions();
});

describe('worker rules: launch and dependencies', () => {
  it('the launch options are exactly the pinned set: no proxy, no geoip, no humanise, no add-on, service workers blocked, a minimal env, six prefs', () => {
    const o = buildLaunchOptions({ ffMajor: 152, home: '/h', path: '/p', tmp: '/t' });
    expect(Object.keys(o).sort()).toEqual(
      [
        'env',
        'exclude_addons',
        'ff_version',
        'firefox_user_prefs',
        'geoip',
        'handleSIGHUP',
        'handleSIGINT',
        'handleSIGTERM',
        'headless',
        'i_know_what_im_doing',
        'locale',
        'os',
        'serviceWorkers',
        'window',
      ].sort(),
    );
    expect([
      o.geoip,
      o.exclude_addons,
      o.serviceWorkers,
      Object.keys(o.env).sort(),
      Object.keys(o.firefox_user_prefs).length,
    ]).toEqual([false, ['UBO'], 'block', ['HOME', 'LANG', 'PATH', 'TMPDIR'], 6]);
  });
  // why: WP17 Task 17.5: zod for the consent line's strict schema (consentLine.ts), at core's own version
  it('the dependencies are exactly @gmt/core, camoufox-js 0.11.5, playwright-core 1.59.1 and zod 4.6.7', () => {
    const pkg: unknown = JSON.parse(readFileSync(PKG, 'utf8'));
    expect(
      typeof pkg === 'object' && pkg !== null && 'dependencies' in pkg ? pkg.dependencies : null,
    ).toEqual({
      '@gmt/core': 'workspace:*',
      'camoufox-js': '0.11.5',
      'playwright-core': '1.59.1',
      zod: '4.6.7',
    });
  });
});

describe('worker rules: a full page session sets only SOCS and clicks nothing on a consent page', () => {
  it('every addCookies call is exactly [socsCookie(capture)]; the consent page is never clicked', async () => {
    const dir = tmpDir();
    writeFileSync(
      join(dir, 'socs.json'),
      JSON.stringify({
        value: 'synthetic-socs',
        domain: '.google.com',
        path: '/',
        expires: 1_800_000_000,
        secure: true,
        sameSite: 'Lax',
        capturedAt: '2026-10-18T04:00:00.000Z',
      }),
      { mode: 0o600 },
    );
    const timers = fakeTimers();
    const socs = loadSocs(dir, timers.clock);
    const contexts: FakeContext[] = [];
    const session = new PageSession({
      launch: async () => {
        const c = new FakeContext();
        c.navigations = [
          {
            hops: [
              'https://www.google.com/travel/flights?q=x',
              'https://www.google.com/travel/flights/search',
            ],
            tree: resultsTree(),
          },
          {
            hops: ['https://www.google.com/travel/flights?q=x', 'https://consent.google.com/ml'],
            tree: n('document', '', [
              n('heading', 'Before you continue to Google'),
              n('button', 'Reject all'),
              n('button', 'Accept all'),
            ]),
          },
        ];
        contexts.push(c);
        return c;
      },
      profileDir: join(dir, 'profile'),
      socs,
      cooldown: new CooldownStore({ dir, challengeHours: 48, clock: timers.clock }),
      pacer: new Pacer({ dir, minSpacingSeconds: 30, clock: timers.clock }),
      monthly: new MonthlyCounter({
        dir,
        caps: { pages: 1500, scrolls: 6000, billingDay: 1 },
        clock: timers.clock,
      }),
      refusal: new Refusal({ dir, clock: timers.clock }),
      clock: timers.clock,
      timers,
      pageTimeoutMs: 90_000,
      log: memoryLog(),
      versions: { selectors: 's', grammar: 'g', camoufoxJs: '0.11.5', binary: 'b' },
    });
    const req = {
      mode: 'list' as const,
      origin: asIata('LHR'),
      destination: asIata('JFK'),
      departureDate: asIsoDate('2026-11-05'),
      returnDate: asIsoDate('2026-11-15'),
      gl: 'GB',
      airportNames: {
        origin: ['London Heathrow Airport'],
        destination: ['John F Kennedy International Airport'],
      },
    };
    expect((await session.page(req)).answer.kind).toBe('cells');
    timers.clock.advance(30_000);
    expect((await session.page(req)).answer).toMatchObject({ kind: 'blocked', page: 'consent-unhandled' });
    const all = contexts.flatMap((c) => c.added);
    expect(all.length).toBeGreaterThan(0);
    for (const call of all) expect(call).toEqual([socsCookie(socs)]);
    // why: with the module's verified flags the results page clicks only its Cheapest tab; the consent page nothing
    const pages = contexts.flatMap((c) => c.pages);
    expect(pages.at(-1)?.calls.clicks).toEqual([]);
    for (const click of pages.flatMap((p) => p.calls.clicks)) expect(click).toMatch(/^tab:Cheapest/);
  });
});

describe('worker rules: source facts through the compiler API', () => {
  it('no Math.random and no crypto.random* anywhere in src/', () => {
    const hits: string[] = [];
    for (const { f, sf } of sources)
      visit(sf, (x) => {
        if (!ts.isPropertyAccessExpression(x)) return;
        const obj = x.expression.getText(sf);
        const prop = x.name.text;
        if ((obj === 'Math' && prop === 'random') || (/crypto$/.test(obj) && prop.startsWith('random')))
          hits.push(`${f}: ${x.getText(sf)}`);
        if (prop === 'randomUUID' || prop === 'randomBytes' || prop === 'randomInt')
          hits.push(`${f}: ${x.getText(sf)}`);
      });
    expect(hits).toEqual([]);
  });
  it('every setTimeout or sleep delay is a number, a name or a field (never randomised)', () => {
    const calls = [
      ...callsTo('setTimeout').map((c) => ({ ...c, arg: c.call.arguments[1] })),
      ...callsTo('sleep').map((c) => ({ ...c, arg: c.call.arguments[0] })),
    ];
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls)
      expect(c.arg !== undefined && plainDelay(c.arg), `${c.f}: ${c.call.getText()}`).toBe(true);
  });
  it('addCookies is called only in session.ts and record.ts, each with a socsCookie(...) argument (TS2-10)', () => {
    const calls = callsTo('addCookies');
    expect([...new Set(calls.map((c) => c.f))].sort()).toEqual(['record.ts', 'session.ts']);
    for (const c of calls) {
      const [arg] = c.call.arguments;
      const only =
        arg !== undefined && ts.isArrayLiteralExpression(arg) && arg.elements.length === 1
          ? arg.elements[0]
          : undefined;
      expect(
        only !== undefined && ts.isCallExpression(only) && only.expression.getText() === 'socsCookie',
        c.call.getText(),
      ).toBe(true);
    }
  });
  // why: decision 74 (Task 17.4): the consent capture's guard and driver are reached only from the consent paths
  it('the consent capture’s guard only from consentDriver.ts, and the consent driver only from record.ts', () => {
    expect(importersOf(['installConsentCaptureGuard'])).toEqual(['consentDriver.ts']);
    expect(importersOf(['createConsentDriver'])).toEqual(['record.ts']);
    expect(importersOf(['launchHeadedContext'])).toEqual(['record.ts']);
  });
  it('installProbeGuard and the probe page type are imported only by record.ts (never session.ts or server.ts)', () => {
    expect(importersOf(['installProbeGuard', 'ProbePage', 'probePage'])).toEqual(['record.ts']);
  });
  // why: the Price graph exploration (2026-10-18) stores a printed snapshot for reading by people; nothing parses it, and
  // the provider path (session.ts, server.ts) never reaches it
  it('ariaSnapshot is called only in dialogSettle.ts and graph.ts, and the explorations are reached only from record.ts', () => {
    expect([...new Set(callsTo('ariaSnapshot').map((c) => c.f))].sort()).toEqual([
      'dialogSettle.ts',
      'graph.ts',
    ]);
    expect(importersOf(['exploreGraph', 'exploreGrid'])).toEqual(['recordDialogs.ts']);
    expect(importersOf(['recordGraph', 'recordGrid'])).toEqual(['record.ts']);
  });
  // why: WP15 Task 15.11: the grid flows click only the dialog's named controls (Price graph, Dates, the four scrolls)
  it('the grid flows find buttons and tabs only by the selectors module’s names', () => {
    const named: string[] = [];
    for (const { f, sf } of sources.filter((x) =>
      ['gridPage.ts', 'gridRecord.ts', 'gridView.ts'].includes(x.f),
    ))
      visit(sf, (x) => {
        if (!ts.isCallExpression(x)) return;
        const e = x.expression;
        if (!ts.isPropertyAccessExpression(e) || e.name.text !== 'getByRole') return;
        const [role, opts] = x.arguments;
        if (role === undefined || !ts.isStringLiteral(role) || !['button', 'tab'].includes(role.text)) return;
        const name =
          opts !== undefined && ts.isObjectLiteralExpression(opts)
            ? opts.properties.find((p) => p.name?.getText(sf) === 'name')
            : undefined;
        // a button lookup without a name lists the panel's cells (it is never clicked); with one, the name is the module's
        named.push(
          name === undefined
            ? `${f}: unnamed ${role.text}`
            : `${f}: ${/S\.results\.|G\.(datesTab|scroll|grid|dialog)|name\b|nm\b/.test(name.getText(sf)) ? 'module' : name.getText(sf)}`,
        );
      });
    expect(named.filter((n) => !n.endsWith(': module') && !n.endsWith(': unnamed button'))).toEqual([]);
    expect(named.length).toBeGreaterThan(0);
  });
  it('the grid page is reached only from the page session, and the recorder’s flow only from record.ts', () => {
    expect(importersOf(['gridPage'])).toEqual(['gridSession.ts']);
    expect(importersOf(['readGrid'])).toEqual(['session.ts']);
    expect(importersOf(['exploreGrid'])).toEqual(['recordDialogs.ts']);
    // why: CA 6: the server process never loads the recorder's modules; the move budgets live in core
    expect(moduleImporters('./gridRecord.js')).toEqual(['recordDialogs.ts']);
    expect(moduleImporters('./recordDialogs.js')).toEqual(['record.ts']);
  });
  it('no route.continue with a URL option', () => {
    const bad = callsTo('continue').filter((c) =>
      c.call.arguments.some(
        (a) => ts.isObjectLiteralExpression(a) && a.properties.some((p) => p.name?.getText() === 'url'),
      ),
    );
    expect(bad.map((c) => c.f)).toEqual([]);
    expect(callsTo('continue')).toEqual([]);
  });
});

// why: po-b1-007: the hand-written launchd agent example is gone; gmt renders and installs the worker's service
describe('the worker’s launchd agent', () => {
  it('is gmt’s own: no hand-written example is shipped beside the worker', () => {
    expect(existsSync(fileURLToPath(new URL('../launchd', import.meta.url)))).toBe(false);
  });
});
