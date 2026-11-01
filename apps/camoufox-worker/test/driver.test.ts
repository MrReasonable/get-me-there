import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  CLICK_LOG_MARGIN_MS,
  CLICK_TIMEOUT_MS,
  classifyAfterFailedStep,
  clickFailureOf,
  createDriver,
  type Driver,
  LOOKUP_TIMEOUT_MS,
  POLL_TIMEOUT_MS,
  type ProbePage,
  pollUntilSettled,
  probePage,
  runStep,
  StepFailed,
} from '../src/driver.js';
import type { GuardState } from '../src/guard.js';
import { SELECTORS } from '../src/selectors.js';
import { bounded, DeadlineExceeded } from '../src/timers.js';
import {
  descendants,
  type FakeNode,
  FakePage,
  n,
  option,
  optionName,
  RESULTS_URL,
  resultsTree,
  returnOptionName,
  text,
  viewMore,
} from './support/fakePage.js';
import { memoryLog } from './support/log.js';
import { fakeTimers, flush } from './support/timers.js';

const guard = (o: Partial<GuardState> = {}): GuardState => ({
  hops: [],
  frameUrls: [],
  refused: null,
  documentLoads: 0,
  ...o,
});
function setup(trees = [resultsTree()]) {
  const page = new FakePage(null);
  page.setUrl(RESULTS_URL);
  page.setTrees(trees);
  const timers = fakeTimers();
  const d = timers.deadline(90_000);
  return {
    page,
    timers,
    d,
    driver: createDriver(page, guard({ hops: ['https://www.google.com/travel/flights?q=x'] })),
  };
}

beforeEach(() => {
  expect.hasAssertions();
});

describe('createDriver.readFacts (ruling 5: locators, never printed ARIA)', () => {
  it('builds PageFacts and the settle facts from locator results', async () => {
    const { driver, d } = setup();
    expect(await driver.readFacts(d)).toEqual({
      page: {
        url: RESULTS_URL,
        hops: ['https://www.google.com/travel/flights?q=x'],
        frameUrls: [RESULTS_URL],
        text: {
          unusualTraffic: false,
          consentHeading: false,
          signInHeading: false,
          challenge: false,
          noFlights: false,
          landingHeading: false,
          returnHeading: false,
        },
        accountControl: false,
        cheapestTabs: [{ name: 'Cheapest from 451 British pounds', inTablist: true, selected: false }],
        dateGridButtons: 1,
        resultLinks: 2,
        outboundLinks: 2,
      },
      settle: {
        resultsReturned: true,
        fetching: false,
        cheapestPriced: true,
        cheapestSelected: false,
        returnHeading: false,
        linkSignature: expect.stringMatching(/^[0-9a-f]{16}$/),
      },
      names: [expect.stringMatching(/^From 478/), expect.stringMatching(/^From 451/)],
    });
  });
  it('reads the blocked signals: challenge text, unusual traffic, headings, an account control', async () => {
    const { driver, d } = setup([
      n('document', '', [
        text('Please confirm you are not a robot'),
        text('Our systems have detected unusual traffic from your computer network.'),
        n('heading', 'Before you continue to Google'),
        n('heading', 'Sign in'),
        n('link', 'Google Account: Example Person'),
        text('No results returned for this search'),
        n('heading', 'Flights'),
      ]),
    ]);
    const { page } = await driver.readFacts(d);
    expect(page.text).toEqual({
      unusualTraffic: true,
      consentHeading: true,
      signInHeading: true,
      challenge: true,
      noFlights: true,
      landingHeading: true,
      returnHeading: false,
    });
    expect(page.accountControl).toBe(true);
    expect(page.cheapestTabs).toEqual([]);
  });
  it('a Cheapest tab outside a tablist is reported as such; a loading word in the tab name is not fetching', async () => {
    const { driver, d } = setup([
      n('document', '', [
        n('tablist', '', [n('tab', 'Cheapest from Fetching results 451 British pounds')]),
        n('tab', 'Cheapest from 2 British pounds'),
      ]),
    ]);
    const r = await driver.readFacts(d);
    expect(r.page.cheapestTabs).toEqual([
      { name: 'Cheapest from Fetching results 451 British pounds', inTablist: true, selected: false },
      { name: '', inTablist: false },
    ]);
    // why: ruling of 2026-10-18: a loading word in the tab's own name is not the page loading
    expect(r.settle).toEqual({
      resultsReturned: false,
      fetching: false,
      cheapestPriced: false,
      cheapestSelected: false,
      returnHeading: false,
      linkSignature: expect.stringMatching(/^[0-9a-f]{16}$/),
    });
  });
  it('each poll sees the next scripted tree', async () => {
    const { driver, d } = setup([n('document', '', [text('Fetching results')]), resultsTree()]);
    expect((await driver.readFacts(d)).settle.fetching).toBe(true);
    expect((await driver.readFacts(d)).settle.fetching).toBe(false);
  });
});

// why: every link below carries a result-shaped accessible name, which is how results are found (ruling of
// 2026-10-18); what is read from each is its aria-label, else its text
const P = 'From 2 British pounds round trip total. ';

describe('createDriver.resultNames (PIE-R2-10)', () => {
  it('one entry per result link: aria-label, else text; nameless is empty; too long is null', async () => {
    const long = `${P}${'x'.repeat(SELECTORS.maxNameLength)}`;
    const { driver, d } = setup([
      resultsTree({
        top: [
          option(478),
          n('listitem', '', [n('link', `${P}from text`, [], { ariaLabel: null, text: `${P}from text` })]),
        ],
        other: [
          n('listitem', '', [n('link', `${P}unreadable`, [], { ariaLabel: null, text: null })]),
          n('listitem', '', [n('link', long)]),
        ],
      }),
    ]);
    const names = await driver.resultNames(d);
    expect(names).toHaveLength(4);
    expect(names.slice(1)).toEqual([`${P}from text`, null, null]);
    expect(names[0]).toMatch(/^From 478 British pounds/);
  });
});

// why: fix round 1 (prov-int M4): a real result link's text is the visible card, not the option sentence
describe('createDriver.resultNames reads aria-label before the text', () => {
  it('a link whose label and text differ yields the label', async () => {
    const { driver, d } = setup([
      resultsTree({
        top: [
          n('listitem', '', [
            n('link', `${P}the label`, [], { ariaLabel: `${P}the label`, text: 'the card text' }),
          ]),
        ],
        other: [],
      }),
    ]);
    expect(await driver.resultNames(d)).toEqual([`${P}the label`]);
  });
  it('a name of exactly the length bound is kept; one more character is null', async () => {
    const at = `${P}${'x'.repeat(SELECTORS.maxNameLength - P.length)}`;
    const { driver, d } = setup([
      resultsTree({
        top: [n('listitem', '', [n('link', at)]), n('listitem', '', [n('link', `${at}x`)])],
        other: [],
      }),
    ]);
    expect(await driver.resultNames(d)).toEqual([at, null]);
  });
});

describe('createDriver list, form and click', () => {
  it('listFacts reads the tab, the stated count, currency and location', async () => {
    const { driver, d } = setup();
    expect(await driver.listFacts(d)).toMatchObject({
      cheapestTabName: 'Cheapest from 451 British pounds',
      resultsStated: 2,
      currencyName: 'Currency GBP',
      locationName: 'Location·United Kingdom',
    });
  });
  it('listFacts on an empty page: no tab, nothing stated', async () => {
    const { driver, d } = setup([n('document', '')]);
    expect(await driver.listFacts(d)).toEqual({
      names: [],
      cheapestTabName: '',
      resultsStated: null,
      currencyName: null,
      locationName: null,
      viewMore: false,
    });
  });
  it('formFacts reads the four controls, or null when any is missing', async () => {
    const { driver, d, page } = setup();
    expect(await driver.formFacts(d)).toEqual({
      tripType: 'Change ticket type. Round trip',
      passengers: '1 passenger, change number of passengers.',
      departure: 'Thu, 5 Nov',
      return: 'Sun, 15 Nov',
    });
    page.setTrees([resultsTree({ form: [] })]);
    expect(await driver.formFacts(d)).toBeNull();
  });
  it('nameless controls read as empty names', async () => {
    const { driver, d } = setup([
      n('document', '', [
        n('combobox', 'Change ticket type. Round trip', [], { ariaLabel: null, text: null }),
        n('button', '1 passenger, change number of passengers.', [], { ariaLabel: null, text: null }),
        n('textbox', 'Departure', [], { value: 'Thu, 5 Nov' }),
        n('textbox', 'Return'),
        n('tablist', '', [n('tab', 'Cheapest from 4 British pounds', [], { ariaLabel: null, text: null })]),
      ]),
    ]);
    expect(await driver.formFacts(d)).toEqual({
      tripType: '',
      passengers: '',
      departure: 'Thu, 5 Nov',
      return: '',
    });
    expect((await driver.readFacts(d)).page.cheapestTabs).toEqual([
      { name: '', inTablist: true, selected: false },
    ]);
  });
  it('click presses the exact name with the remaining deadline', async () => {
    const { driver, d, page } = setup();
    await driver.click('button', 'View more flights', d);
    expect(page.calls.clicks).toEqual(['button:View more flights']);
  });
  it('goto loads domcontentloaded with the remaining deadline as its timeout', async () => {
    const { driver, d, page, timers } = setup();
    timers.clock.advance(30_000);
    await driver.goto('https://www.google.com/travel/flights?q=x', d);
    expect(page.calls.gotos).toEqual([
      { url: 'https://www.google.com/travel/flights?q=x', timeout: 60_000, waitUntil: 'domcontentloaded' },
    ]);
  });
});

describe('deadlines (ruling 6, PIE-R2-06)', () => {
  it('every call passes timeout equal to the remaining deadline', async () => {
    const { driver, d, page, timers } = setup();
    timers.clock.advance(10_000);
    await driver.resultNames(d);
    expect(page.calls.timeouts.length).toBeGreaterThan(0);
    expect(new Set(page.calls.timeouts)).toEqual(new Set([80_000]));
  });
  it('a call that never resolves rejects when the deadline closes the page; nothing goes unhandled', async () => {
    const spy = vi.fn();
    process.on('unhandledRejection', spy);
    try {
      const { driver, d, page, timers } = setup();
      d.onExpire(() => {
        void page.close();
      });
      page.hangAll = true;
      const p = driver.readFacts(d);
      await flush();
      timers.runOut();
      await expect(p).rejects.toThrow(/deadline|closed/);
      await flush();
      await flush();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', spy);
    }
  });
  it('the bounded finally helper gives up after 5 s of fake time and reports overran', async () => {
    const timers = fakeTimers();
    const start = timers.now();
    expect(await bounded(() => new Promise<never>(() => undefined), 5000, timers)).toEqual({ overran: true });
    expect(timers.now() - start).toBe(5000);
    expect(await bounded(() => Promise.resolve(7), 5000, timers)).toEqual({ overran: false, value: 7 });
    expect(await bounded(() => Promise.reject(new Error('x')), 5000, timers)).toEqual({ overran: true });
    expect(
      await bounded(
        () => {
          throw new Error('sync');
        },
        5000,
        timers,
      ),
    ).toEqual({ overran: true });
    expect(timers.now() - start).toBe(5000);
  });
});

// why: the operator's ruling after the second recording run (2026-10-18): the Cheapest tab keeps a hidden
// "Fetching results" label in its name on a loaded page, so settling reads stable content, and the loading text counts
// only when visible outside the tab
describe('settling on stable content (ruling of 2026-10-18)', () => {
  const EVIDENCE_TAB = 'Cheapest from Fetching results 451 British pounds Learn more about ranking';
  const tree = (
    o: { top?: ReturnType<typeof option>[]; tab?: string; extra?: ReturnType<typeof n>[] } = {},
  ) => {
    const t = resultsTree({ tab: o.tab ?? EVIDENCE_TAB, ...(o.top === undefined ? {} : { top: o.top }) });
    // the hidden loading label inside the tab, as on the evidence page
    for (const c of descendants([t]))
      if (c.role === 'tab' && c.name === (o.tab ?? EVIDENCE_TAB))
        c.children = [{ ...text('Fetching results'), hidden: true }];
    t.children = [...(t.children ?? []), ...(o.extra ?? [])];
    return t;
  };
  const poll = async (trees: ReturnType<typeof resultsTree>[], deadlineMs = 90_000) => {
    const page = new FakePage(null);
    page.setUrl(RESULTS_URL);
    page.setTrees(trees);
    const timers = fakeTimers();
    const d = timers.deadline(deadlineMs);
    const lines = memoryLog();
    const driver = createDriver(page, guard({ hops: ['https://www.google.com/travel/flights?q=x'] }));
    const run = pollUntilSettled(driver, d, timers, 2000, SELECTORS, { log: lines, startedAt: timers.now() });
    return { run, timers, lines };
  };
  it('a tab named exactly like the evidence settles once its links are stable across two polls', async () => {
    const { run, lines } = await poll([tree()]);
    const s = await run;
    expect(s.kind).toEqual({ kind: 'results' });
    expect(s.polls).toBe(2);
    expect(lines.lines.filter((l) => l.level === 'debug').map((l) => l.o)).toEqual([
      {
        view: 'best',
        elapsedMs: 0,
        pollDurationMs: 0,
        resultsReturned: true,
        fetching: false,
        cheapestPriced: true,
        cheapestSelected: false,
        stable: false,
        resultLinks: 2,
      },
      {
        view: 'best',
        elapsedMs: 2000,
        pollDurationMs: 0,
        resultsReturned: true,
        fetching: false,
        cheapestPriced: true,
        cheapestSelected: false,
        stable: true,
        resultLinks: 2,
      },
    ]);
  });
  it('links that change between polls do not settle', async () => {
    const trees = Array.from({ length: 60 }, (_, i) => tree({ top: [option(400 + i)] }));
    const { run } = await poll(trees);
    await expect(run).rejects.toThrow(DeadlineExceeded);
  });
  it('a visible "Fetching results" outside the tab blocks settling', async () => {
    const { run } = await poll([tree({ extra: [text('Fetching results')] })]);
    await expect(run).rejects.toThrow(DeadlineExceeded);
  });
  it('a tab with no price does not settle', async () => {
    const { run } = await poll([
      tree({ tab: 'Cheapest from Fetching results British pounds Learn more about ranking' }),
    ]);
    await expect(run).rejects.toThrow(DeadlineExceeded);
  });
});

// why: ruling of 2026-10-18 (recording run 3): the result lists carry no accessible name; a heading precedes each, and
// each result is a listitem holding a link whose own name starts "From <n> British pounds round trip total. "
describe('result links by their own name (ruling of 2026-10-18)', () => {
  const evidence = () =>
    n('document', 'Google Flights', [
      n('main', '', [
        n('heading', 'Top departing flights'),
        n('list', '', [option(534)]),
        n('heading', 'Other departing flights'),
        n('list', '', [option(600), option(612)]),
        n('link', 'Learn more about tracked prices'),
      ]),
      n('link', 'From 1 British pounds round trip total. outside main'),
    ]);
  it('unnamed lists under the departing-flights headings yield their links', async () => {
    const { driver, d } = setup([evidence()]);
    expect((await driver.readFacts(d)).page.resultLinks).toBe(3);
    const names = await driver.resultNames(d);
    expect(names).toHaveLength(3);
    expect(names.every((x) => x?.startsWith('From ') === true)).toBe(true);
  });
  it('a link that does not match the result-name pattern is not counted, nor one outside main', async () => {
    const { driver, d } = setup([evidence()]);
    expect(await driver.resultNames(d)).not.toContain('Learn more about tracked prices');
    expect((await driver.resultNames(d)).some((x) => x?.includes('outside main') === true)).toBe(false);
  });
});

// why: ruling of 2026-10-18 (the Cheapest recording): Google attaches an information pop-up to the Cheapest tab whose
// "Close dialogue" button intercepts the tab's click; only that button, inside that tab, may be clicked to close it
describe('clickCheapest (ruling of 2026-10-18)', () => {
  const POPUP_TAB =
    'Cheapest from £443 Close dialogue Looking for the lowest fares? These additional budget picks help you save but may involve trade-offs';
  const withTab = (tab: ReturnType<typeof n>, extra: ReturnType<typeof n>[] = []) => {
    const t = resultsTree();
    for (const c of descendants([t])) if (c.role === 'tablist') c.children = [n('tab', 'Best'), tab];
    t.children = [...(t.children ?? []), ...extra];
    return t;
  };
  const run = async (tree: ReturnType<typeof n>, url = RESULTS_URL) => {
    const page = new FakePage(null);
    page.setUrl(url);
    page.setTrees([tree]);
    const timers = fakeTimers();
    const d = timers.deadline(90_000);
    const lines = memoryLog();
    const driver = createDriver(page, guard());
    const clicked = await driver.clickCheapest(d, { timers, log: lines, startedAt: timers.now() });
    return { page, clicked, lines };
  };
  it('the pop-up from the evidence is closed, then the tab clicked', async () => {
    const tab = n('tab', POPUP_TAB, [n('button', 'Close dialogue')]);
    const { page, clicked } = await run(withTab(tab));
    expect(page.calls.clicks).toEqual(['button:Close dialogue', `tab:${POPUP_TAB}`]);
    expect(clicked).toEqual(['button:Close dialogue', 'tab:Cheapest']);
  });
  it('no pop-up: the tab is clicked directly', async () => {
    const { page, clicked } = await run(withTab(n('tab', 'Cheapest from £443')));
    expect(page.calls.clicks).toEqual(['tab:Cheapest from £443']);
    expect(clicked).toEqual(['tab:Cheapest']);
  });
  it('a "Close dialogue" button anywhere else is never clicked', async () => {
    const tree = withTab(n('tab', 'Cheapest from £443'), [
      n('button', 'Close dialogue'),
      n('dialog', '', [n('button', 'Close dialogue')]),
    ]);
    const { page } = await run(tree);
    expect(page.calls.clicks).toEqual(['tab:Cheapest from £443']);
  });
  it('a name only near "Close dialogue" (not exact) inside the tab is never clicked', async () => {
    const { page } = await run(withTab(n('tab', POPUP_TAB, [n('button', 'Close dialogue now')])));
    expect(page.calls.clicks).toEqual([`tab:${POPUP_TAB}`]);
  });
  it('off the results page nothing is closed', async () => {
    const { page } = await run(
      withTab(n('tab', POPUP_TAB, [n('button', 'Close dialogue')])),
      'https://www.example.test/',
    );
    expect(page.calls.clicks).toEqual([`tab:${POPUP_TAB}`]);
  });
  it('each click carries its own timeout inside the page deadline', async () => {
    const { page } = await run(withTab(n('tab', POPUP_TAB, [n('button', 'Close dialogue')])));
    // the two clicks carry the click bound; the lookups around them their own 5 s bound
    expect(page.calls.timeouts.filter((x) => x === CLICK_TIMEOUT_MS)).toHaveLength(2);
  });
  it('a click that fails logs its error class and the target name at debug, never a URL, and throws', async () => {
    const tab = n('tab', 'Cheapest from £443', [], { hang: false });
    const tree = withTab(tab);
    const page = new FakePage(null);
    page.setUrl(RESULTS_URL);
    page.setTrees([tree]);
    page.onClick = () => {
      throw Object.assign(new Error('locator.click: Timeout 10000ms exceeded at https://www.google.com/x'), {
        name: 'TimeoutError',
      });
    };
    const timers = fakeTimers();
    const lines = memoryLog();
    await expect(
      createDriver(page, guard()).clickCheapest(timers.deadline(90_000), {
        timers,
        log: lines,
        startedAt: timers.now(),
      }),
    ).rejects.toMatchObject({ name: 'StepFailed', step: 'click-tab', reason: 'failed' });
    expect(lines.lines.filter((l) => l.msg === 'cheapest step failed').map((l) => l.o)).toEqual([
      { step: 'click-tab', error: 'TimeoutError', elapsedMs: 0 },
    ]);
    expect(JSON.stringify(lines.lines)).not.toContain('https://');
  });
});

// why: ruling of 2026-10-18: the Cheapest view reads the selected tab, and logs which names moved between polls
describe('the Cheapest view', () => {
  it('readFacts reports the Cheapest tab selected through aria-selected', async () => {
    const t = resultsTree({ tab: 'Cheapest from £443' });
    for (const c of descendants([t]))
      if (c.role === 'tab' && c.name === 'Cheapest from £443') c.selected = true;
    const { driver, d } = setup([t]);
    expect((await driver.readFacts(d)).settle.cheapestSelected).toBe(true);
  });
  it('a Cheapest view whose links keep changing logs the changed names (60 characters each) at debug', async () => {
    const view = (p: number) => {
      const t = resultsTree({ tab: 'Cheapest from £443', top: [option(p)] });
      for (const c of descendants([t]))
        if (c.role === 'tab' && c.name === 'Cheapest from £443') c.selected = true;
      t.children = (t.children ?? []).filter((c) => !/results returned/.test(c.name ?? ''));
      return t;
    };
    const page = new FakePage(null);
    page.setUrl(RESULTS_URL);
    page.setTrees([view(400), view(401), view(401)]);
    const timers = fakeTimers();
    const lines = memoryLog();
    const s = await pollUntilSettled(
      createDriver(page, guard()),
      timers.deadline(90_000),
      timers,
      2000,
      SELECTORS,
      {
        view: 'cheapest',
        log: lines,
        startedAt: timers.now(),
      },
    );
    expect(s.polls).toBe(3);
    const changed = lines.lines.filter((l) => l.msg === 'settle names changed').map((l) => l.o);
    expect(changed).toEqual([
      {
        view: 'cheapest',
        elapsedMs: 2000,
        changed: [
          'From 401 British pounds round trip total. 1 stop flight with',
          'From 400 British pounds round trip total. 1 stop flight with',
        ],
      },
    ]);
  });
});

// why: the rerun of 2026-10-18 hung between the Best view settling and the first Cheapest poll with nothing logged;
// every await of the Cheapest flow now has its own step timeout (10 s clicks, 5 s lookups) and logs its start and end
describe('the Cheapest flow in timed steps (ruling of 2026-10-18)', () => {
  const POP = 'Cheapest from £443 Close dialogue Looking for the lowest fares?';
  const tree = (o: { popup?: boolean; hangClick?: boolean } = {}) => {
    const t = resultsTree({ tab: POP });
    for (const c of descendants([t]))
      if (c.role === 'tab' && c.name === POP) {
        c.children = o.popup === false ? [] : [n('button', 'Close dialogue')];
        if (o.hangClick === true) c.clickHang = true;
      }
    return t;
  };
  const steps = (lines: ReturnType<typeof memoryLog>) =>
    lines.lines
      .filter((l) => l.msg === 'cheapest step')
      .map((l) => `${String(Reflect.get(l.o, 'step'))}:${String(Reflect.get(l.o, 'phase'))}`);
  it('the step lines appear in order, each with its elapsed ms', async () => {
    const page = new FakePage(null);
    page.setUrl(RESULTS_URL);
    page.setTrees([tree()]);
    const timers = fakeTimers();
    const lines = memoryLog();
    const clicked = await createDriver(page, guard()).clickCheapest(timers.deadline(90_000), {
      timers,
      log: lines,
      startedAt: timers.now(),
    });
    expect(clicked).toEqual(['button:Close dialogue', 'tab:Cheapest']);
    expect(steps(lines)).toEqual([
      'find-popup:start',
      'find-popup:end',
      'close-popup:start',
      'close-popup:end',
      'find-tab:start',
      'find-tab:end',
      'click-tab:start',
      'click-tab:end',
      'confirm-selected:start',
      'confirm-selected:end',
    ]);
    expect(
      lines.lines
        .filter((l) => l.msg === 'cheapest step')
        .every((l) => typeof Reflect.get(l.o, 'elapsedMs') === 'number'),
    ).toBe(true);
  });
  it('a lookup that never resolves times out at 5 s with its step name logged', async () => {
    const page = new FakePage(null);
    page.setUrl(RESULTS_URL);
    page.setTrees([tree()]);
    page.hangAll = true;
    const timers = fakeTimers();
    const lines = memoryLog();
    const run = createDriver(page, guard()).clickCheapest(timers.deadline(90_000), {
      timers,
      log: lines,
      startedAt: timers.now(),
    });
    for (let i = 0; i < 5; i++) await flush();
    timers.runOut();
    await expect(run).rejects.toMatchObject({ name: 'StepFailed', step: 'find-popup' });
    expect(lines.lines.filter((l) => l.msg === 'cheapest step timed out').map((l) => l.o)).toEqual([
      { step: 'find-popup', elapsedMs: 5000, timeoutMs: 5000 },
    ]);
  });
  it('a click that never resolves times out at 10 s as its own step', async () => {
    const page = new FakePage(null);
    page.setUrl(RESULTS_URL);
    page.setTrees([tree({ popup: false, hangClick: true })]);
    const timers = fakeTimers();
    const lines = memoryLog();
    const run = createDriver(page, guard()).clickCheapest(timers.deadline(90_000), {
      timers,
      log: lines,
      startedAt: timers.now(),
    });
    for (let i = 0; i < 5; i++) await flush();
    timers.runOut();
    await expect(run).rejects.toMatchObject({ name: 'StepFailed', step: 'click-tab' });
    expect(
      lines.lines
        .filter((l) => l.msg === 'cheapest step timed out')
        .map((l) => Reflect.get(l.o, 'timeoutMs')),
    ).toEqual([10_000]);
  });
  it('a tab that is not selected after its click fails the confirm step', async () => {
    const page = new FakePage(null);
    page.setUrl(RESULTS_URL);
    page.setTrees([tree({ popup: false })]);
    page.onClick = (x) => {
      x.selected = false;
    };
    const timers = fakeTimers();
    await expect(
      createDriver(page, guard()).clickCheapest(timers.deadline(90_000), {
        timers,
        log: memoryLog(),
        startedAt: timers.now(),
      }),
    ).rejects.toMatchObject({ name: 'StepFailed', step: 'confirm-selected' });
  });
});

// why: ruling of 2026-10-18 (the rerun on 59115d9): a poll is about fifteen lookups, so each Cheapest-view poll has its
// own 20 s bound, and each single lookup inside it keeps 5 s
describe('Cheapest poll and lookup bounds', () => {
  const view = () => {
    const t = resultsTree({ tab: 'Cheapest from £443' });
    for (const c of descendants([t]))
      if (c.role === 'tab' && c.name === 'Cheapest from £443') c.selected = true;
    t.children = (t.children ?? []).filter((c) => !/results returned/.test(c.name ?? ''));
    return t;
  };
  /** A driver whose every poll takes `ms` of fake time before it answers. */
  const slow = (ms: number) => {
    const page = new FakePage(null);
    page.setUrl(RESULTS_URL);
    page.setTrees([view()]);
    const timers = fakeTimers();
    const real = createDriver(page, guard());
    const driver = {
      readFacts: async (
        d: Parameters<typeof real.readFacts>[0],
        o?: Parameters<typeof real.readFacts>[1],
      ) => {
        await timers.sleep(ms, d.signal);
        return real.readFacts(d, o);
      },
    };
    return { driver, timers };
  };
  it('a Cheapest poll that takes 8 s completes (and the settle line names its duration)', async () => {
    const { driver, timers } = slow(8000);
    const lines = memoryLog();
    const s = await pollUntilSettled(driver, timers.deadline(90_000), timers, 2000, SELECTORS, {
      view: 'cheapest',
      log: lines,
      startedAt: timers.now(),
    });
    expect(s.kind).toEqual({ kind: 'results' });
    expect(
      lines.lines.filter((l) => l.msg === 'settle poll').map((l) => Reflect.get(l.o, 'pollDurationMs')),
    ).toEqual([8000, 8000]);
  });
  it('a Cheapest poll that takes 25 s times out at 20 s with its step name, each time until the reserve', async () => {
    const { driver, timers } = slow(25_000);
    const lines = memoryLog();
    await expect(
      pollUntilSettled(driver, timers.deadline(90_000), timers, 2000, SELECTORS, {
        view: 'cheapest',
        log: lines,
        startedAt: timers.now(),
      }),
    ).rejects.toMatchObject({ name: 'StepFailed', step: 'cheapest-poll', reason: 'timed-out' });
    // why: the fake sleep advances the clock in one jump, so the 20 s bound is seen at the 25 s mark here
    // why: ruling of 2026-10-18: an overrun poll is unsettled, polled again until only the fallback's reserve is left
    const timedOut = lines.lines.filter((l) => l.msg === 'cheapest step timed out').map((l) => l.o);
    expect(timedOut.length).toBeGreaterThan(1);
    expect(timedOut[0]).toMatchObject({ step: 'cheapest-poll', timeoutMs: POLL_TIMEOUT_MS });
  });
  it('a single lookup inside a bounded poll still times out at 5 s', async () => {
    const page = new FakePage(null);
    page.setUrl(RESULTS_URL);
    page.setTrees([view()]);
    page.hangAll = true;
    const timers = fakeTimers();
    const run = createDriver(page, guard()).readFacts(timers.deadline(90_000), {
      timers,
      lookupMs: LOOKUP_TIMEOUT_MS,
    });
    for (let i = 0; i < 5; i++) await flush();
    timers.runOut();
    await expect(run).rejects.toMatchObject({ name: 'LookupTimedOut' });
    expect(timers.now() - Date.parse('2026-10-18T05:00:00.000Z')).toBe(5000);
  });
});

// why: ruling of 2026-10-18: the no-flights text counts only when a visitor would see it (a hidden status line on a
// results page never does)
describe('no-flights text is visible-only', () => {
  it('a hidden "No results returned" line is not noFlights; a visible one is', async () => {
    const hidden = resultsTree({ extra: [{ ...text('No results returned for this search'), hidden: true }] });
    expect((await setup([hidden]).driver.readFacts(setup([hidden]).d)).page.text.noFlights).toBe(false);
    const shown = n('document', '', [text('No results returned for this search')]);
    const t = setup([shown]);
    expect((await t.driver.readFacts(t.d)).page.text.noFlights).toBe(true);
  });
  it('readFacts reports the Cheapest tab’s own selected state', async () => {
    const tree = resultsTree({ tab: 'Cheapest from £443' });
    for (const c of descendants([tree]))
      if (c.role === 'tab' && c.name === 'Cheapest from £443') c.selected = true;
    const t = setup([tree]);
    expect((await t.driver.readFacts(t.d)).page.cheapestTabs).toEqual([
      { name: 'Cheapest from £443', inTablist: true, selected: true },
    ]);
  });
});

// why: ruling of 2026-10-18 (the rerun on 51c2992): the selected state is read through the role query, a lookup that
// overruns names itself, and a Cheapest poll that overruns is "not settled yet", never a failure
describe('the Cheapest poll that overruns (ruling of 2026-10-18)', () => {
  const view = (o: { hang?: boolean } = {}) => {
    const t = resultsTree({ tab: 'Cheapest from £443' });
    for (const c of descendants([t]))
      if (c.role === 'tab' && c.name === 'Cheapest from £443') {
        c.selected = true;
        if (o.hang === true) c.selectedQueryHang = true;
      }
    t.children = (t.children ?? []).filter((c) => !/results returned/.test(c.name ?? ''));
    return t;
  };
  it('the selected state is read through the role query, never the attribute', async () => {
    const t = view();
    for (const c of descendants([t]))
      if (c.role === 'tab' && c.name === 'Cheapest from £443') c.ariaSelectedAttr = 'false';
    const s = setup([t]);
    const read = await s.driver.readFacts(s.d);
    expect(read.page.cheapestTabs[0]?.selected).toBe(true);
    expect(read.settle.cheapestSelected).toBe(true);
  });
  it('a poll whose lookup overruns names the lookup, and the next poll settles', async () => {
    const page = new FakePage(null);
    page.setUrl(RESULTS_URL);
    page.setTrees([view({ hang: true }), view()]);
    const timers = fakeTimers();
    const lines = memoryLog();
    const run = pollUntilSettled(
      createDriver(page, guard()),
      timers.deadline(90_000),
      timers,
      2000,
      SELECTORS,
      {
        view: 'cheapest',
        log: lines,
        startedAt: timers.now(),
      },
    );
    let done = false;
    void run.finally(() => {
      done = true;
    });
    for (let i = 0; i < 20 && !done; i++) {
      for (let j = 0; j < 5; j++) await flush();
      if (!done) timers.runOut();
    }
    const s = await run;
    expect(s.kind).toEqual({ kind: 'results' });
    expect(lines.lines.filter((l) => l.msg === 'cheapest step failed').map((l) => l.o)).toMatchObject([
      { step: 'cheapest-poll', error: 'LookupTimedOut', lookup: 'cheapest-tab-selected', lookupMs: 5000 },
    ]);
  });
  it('repeated overruns end only when the budget is nearly spent, as a failed step the caller falls back from', async () => {
    const page = new FakePage(null);
    page.setUrl(RESULTS_URL);
    page.setTrees([view({ hang: true })]);
    const timers = fakeTimers();
    const run = pollUntilSettled(
      createDriver(page, guard()),
      timers.deadline(90_000),
      timers,
      2000,
      SELECTORS,
      {
        view: 'cheapest',
        startedAt: timers.now(),
      },
    );
    let settledWith: unknown = null;
    void run.catch((e: unknown) => {
      settledWith = e;
    });
    for (let i = 0; i < 60 && settledWith === null; i++) {
      for (let j = 0; j < 5; j++) await flush();
      if (settledWith === null) timers.runOut();
    }
    expect(settledWith).toMatchObject({
      name: 'StepFailed',
      step: 'cheapest-poll',
      reason: 'timed-out',
    });
    // polling went on until the reserve the fallback needs was all that was left
    expect(timers.now() - Date.parse('2026-10-18T05:00:00.000Z')).toBeGreaterThanOrEqual(
      90_000 - 20_000 - 7000,
    );
  });
});

// why: WP21 Task 21.0: the literal below was captured from the driver before the return view's lookups were added,
// over the same tree, so the served path's facts are shown unchanged field by field; only outboundLinks and the
// return heading are new
describe('readFacts on the served path is unchanged (WP21 Task 21.0)', () => {
  it('every existing field equals the literal captured from the unmodified code, plus the two new facts', async () => {
    const { driver, d } = setup();
    const r = await driver.readFacts(d);
    expect(r).toEqual({
      page: {
        url: 'https://www.google.com/travel/flights/search?tfs=x',
        hops: ['https://www.google.com/travel/flights?q=x'],
        frameUrls: ['https://www.google.com/travel/flights/search?tfs=x'],
        text: {
          unusualTraffic: false,
          consentHeading: false,
          signInHeading: false,
          challenge: false,
          noFlights: false,
          landingHeading: false,
          returnHeading: false,
        },
        accountControl: false,
        cheapestTabs: [{ name: 'Cheapest from 451 British pounds', inTablist: true, selected: false }],
        dateGridButtons: 1,
        resultLinks: 2,
        outboundLinks: 2,
      },
      settle: {
        resultsReturned: true,
        fetching: false,
        cheapestPriced: true,
        cheapestSelected: false,
        returnHeading: false,
        linkSignature: 'c5ca95a9719e7c24',
      },
      names: [optionName(478), optionName(451)],
    });
    expect(await driver.listFacts(d)).toEqual({
      names: [optionName(478), optionName(451)],
      cheapestTabName: 'Cheapest from 451 British pounds',
      resultsStated: 2,
      currencyName: 'Currency GBP',
      locationName: 'Location·United Kingdom',
      viewMore: true,
    });
  });
});

/** A return view in the hypothesis form: a returning-flights heading, return links, the outbound list gone. */
const returnTree = (o: { heading?: string; links?: FakeNode[]; extra?: FakeNode[]; more?: boolean } = {}) =>
  n('document', 'Google Flights', [
    n('tablist', '', [n('tab', 'Best'), n('tab', 'Cheapest from 451 British pounds')]),
    n('main', '', [
      n('heading', o.heading ?? 'Returning flights'),
      n(
        'list',
        '',
        o.links ?? [
          n('listitem', '', [n('link', returnOptionName({ pounds: 451 }))]),
          n('listitem', '', [n('link', returnOptionName({ pounds: 470, carrier: 'QQ Air' }))]),
          n('listitem', '', [n('link', returnOptionName({ pounds: 512, priceForm: 'from' }))]),
        ],
      ),
      ...(o.extra ?? []),
    ]),
    ...(o.more === false ? [] : [viewMore()]),
    n('button', 'Currency GBP'),
  ]);

describe('the return view’s facts (WP21 Task 21.0)', () => {
  it('readFacts(d, o, "returns") counts the links, names and signature by the return pattern; outboundLinks by the outbound one', async () => {
    const selected = n('listitem', '', [n('link', optionName(451))]);
    const { driver, d, timers } = setup([returnTree({ extra: [selected] })]);
    const r = await driver.readFacts(d, { timers, lookupMs: LOOKUP_TIMEOUT_MS }, 'returns');
    // why: the hypothesis reads both price forms, so the one outbound link left on the page matches it too
    expect(r.page.resultLinks).toBe(4);
    expect(r.page.outboundLinks).toBe(2);
    expect(r.names).toHaveLength(4);
    expect(r.names[0]).toBe(returnOptionName({ pounds: 451 }));
    const best = await driver.readFacts(d);
    expect(best.page.resultLinks).toBe(2);
    expect(best.page.outboundLinks).toBe(2);
    expect(best.settle.linkSignature).not.toBe(r.settle.linkSignature);
  });
  it('the return heading is true exactly when a heading matches the hypothesis', async () => {
    for (const [heading, want] of [
      ['Returning flights', true],
      ['Top returning flights', true],
      ['Other returning flights', true],
      ['Top departing flights', false],
      ['Returning flights later', false],
    ] as const) {
      const { driver, d } = setup([returnTree({ heading })]);
      const r = await driver.readFacts(d, undefined, 'returns');
      expect(r.page.text.returnHeading, heading).toBe(want);
      expect(r.settle.returnHeading, heading).toBe(want);
    }
  });
  it('listFacts(d, "returns") reads the return view’s links; viewMore is true exactly when the button exists', async () => {
    const { driver, d, page } = setup([returnTree()]);
    const l = await driver.listFacts(d, 'returns');
    expect(l.names).toEqual([
      returnOptionName({ pounds: 451 }),
      returnOptionName({ pounds: 470, carrier: 'QQ Air' }),
      returnOptionName({ pounds: 512, priceForm: 'from' }),
    ]);
    expect(l.viewMore).toBe(true);
    // why: the outbound pattern reads only the "From" form
    expect((await driver.listFacts(d)).names).toEqual([returnOptionName({ pounds: 512, priceForm: 'from' })]);
    page.setTrees([returnTree({ more: false })]);
    expect((await driver.listFacts(d, 'returns')).viewMore).toBe(false);
    page.setTrees([resultsTree({ viewMore: false })]);
    expect((await driver.listFacts(d)).viewMore).toBe(false);
    page.setTrees([resultsTree()]);
    expect((await driver.listFacts(d)).viewMore).toBe(true);
  });
});

describe('clickOutbound (WP21 Task 21.0)', () => {
  const NAME = optionName(451);
  const tree = (links: FakeNode[], outside: FakeNode[] = []) =>
    n('document', '', [...outside, n('main', '', [n('list', '', links)])]);
  const run = (t: FakeNode, name = NAME) => {
    const page = new FakePage(null);
    page.setUrl(RESULTS_URL);
    page.setTrees([t]);
    const timers = fakeTimers();
    const lines = memoryLog();
    const d = timers.deadline(90_000);
    const r = createDriver(page, guard()).clickOutbound(name, d, {
      timers,
      log: lines,
      flow: 'select-outbound',
    });
    return { page, r, lines };
  };
  // why: the controller's ruling after recording 2 (the pointer click was intercepted by a covering element): the
  // verified link is activated from the keyboard, focused then Enter, never a pointer click
  it('focuses the one link in main of that exact name, presses Enter on it, and returns what it activated', async () => {
    const { page, r, lines } = run(tree([n('link', NAME), n('link', optionName(478))]));
    expect(await r).toEqual([`link:${NAME}`]);
    expect(page.calls.clicks).toEqual([]);
    expect(page.calls.focuses).toEqual([`link:${NAME}`]);
    expect(page.calls.presses).toEqual([`Enter:link:${NAME}`]);
    expect(page.calls.timeouts.filter((x) => x === CLICK_TIMEOUT_MS - CLICK_LOG_MARGIN_MS)).toHaveLength(2);
    expect(
      lines.lines.filter((l) => l.msg === 'select-outbound step').map((l) => Reflect.get(l.o, 'step')),
    ).toEqual([
      'find-outbound',
      'find-outbound',
      'focus-outbound',
      'focus-outbound',
      'press-outbound',
      'press-outbound',
    ]);
  });
  it('the Enter goes to the element it focused, after the focus', async () => {
    const { page, r } = run(tree([n('link', NAME)]));
    await r;
    expect([page.calls.focuses, page.calls.presses]).toEqual([[`link:${NAME}`], [`Enter:link:${NAME}`]]);
  });
  it('none of that name is not-found, and nothing is clicked', async () => {
    const { page, r } = run(tree([n('link', optionName(478))]));
    await expect(r).rejects.toMatchObject({
      name: 'StepFailed',
      step: 'find-outbound',
      reason: 'not-found',
      flow: 'select-outbound',
    });
    expect(page.calls.clicks).toEqual([]);
  });
  it('two of that name are ambiguous, and nothing is clicked', async () => {
    const { page, r } = run(tree([n('link', NAME), n('link', NAME)]));
    await expect(r).rejects.toMatchObject({
      step: 'find-outbound',
      reason: 'ambiguous',
      flow: 'select-outbound',
    });
    expect(page.calls.clicks).toEqual([]);
  });
  it('a link of that name outside main is not found', async () => {
    const { page, r } = run(tree([], [n('link', NAME)]));
    await expect(r).rejects.toMatchObject({ step: 'find-outbound', reason: 'not-found' });
    expect(page.calls.clicks).toEqual([]);
  });
  // why: preflight D6: defence in depth, only a result-shaped name is ever clicked (the selectors module's pattern)
  it('a name the result-link pattern does not match is refused as not-found before any lookup', async () => {
    const { page, r } = run(tree([n('link', 'Sign in')]), 'Sign in');
    await expect(r).rejects.toMatchObject({ step: 'find-outbound', reason: 'not-found' });
    expect(page.calls.clicks).toEqual([]);
  });
  it('an Enter that never answers times out at CLICK_TIMEOUT_MS as its own step, within the deadline', async () => {
    const page = new FakePage(null);
    page.setUrl(RESULTS_URL);
    page.setTrees([tree([n('link', NAME, [], { pressHang: true })])]);
    const timers = fakeTimers();
    const run = createDriver(page, guard()).clickOutbound(NAME, timers.deadline(90_000), {
      timers,
      flow: 'select-outbound',
    });
    let err: unknown = null;
    void run.catch((e: unknown) => {
      err = e;
    });
    for (let i = 0; i < 5 && err === null; i++) {
      await flush();
      if (err === null) timers.runOut();
    }
    expect(err).toMatchObject({ step: 'press-outbound', reason: 'timed-out', flow: 'select-outbound' });
    expect(timers.now() - Date.parse('2026-10-18T05:00:00.000Z')).toBe(CLICK_TIMEOUT_MS);
  });
});

describe('StepFailed and runStep (WP21 Task 21.0: one step error for every flow)', () => {
  it('an overrun names its flow: the options’ flow, the Cheapest flow’s by default', async () => {
    const timers = fakeTimers();
    const d = timers.deadline(90_000);
    const never = () => new Promise<never>(() => undefined);
    const a = runStep('x', 1000, d, { timers, flow: 'grid' }, never);
    const b = runStep('y', 1000, d, { timers }, never);
    let ea: unknown = null;
    let eb: unknown = null;
    void a.catch((e: unknown) => {
      ea = e;
    });
    void b.catch((e: unknown) => {
      eb = e;
    });
    for (let i = 0; i < 5 && (ea === null || eb === null); i++) {
      await flush();
      timers.runOut();
    }
    expect(ea).toBeInstanceOf(StepFailed);
    expect(ea).toMatchObject({ step: 'x', reason: 'timed-out', flow: 'grid' });
    expect(eb).toMatchObject({ step: 'y', reason: 'timed-out', flow: 'cheapest' });
    expect(new StepFailed('find-tab', 'not-found').flow).toBe('cheapest');
    expect(new StepFailed('find-tab', 'not-found').message).toBe(
      "the cheapest flow's find-tab step not-found",
    );
  });
});

describe('probePage and classifyAfterFailedStep (WP21 Task 21.0)', () => {
  it('the probe page has the read methods and no click of any kind', () => {
    expectTypeOf<ProbePage>().not.toHaveProperty('click');
    expectTypeOf<ProbePage>().not.toHaveProperty('clickCheapest');
    expectTypeOf<ProbePage>().not.toHaveProperty('clickOutbound');
    expectTypeOf<ProbePage>().toHaveProperty('listFacts');
    // why: the research reads live in their own module (researchNames.ts), never on the served driver
    expectTypeOf<Driver>().not.toHaveProperty('linkNames');
    const page = new FakePage(null);
    const p = probePage(createDriver(page, guard()));
    expect('clickOutbound' in p).toBe(false);
    expect('click' in p).toBe(false);
    expect('clickCheapest' in p).toBe(false);
    expect(Object.keys(p).sort()).toEqual(
      ['formFacts', 'goto', 'headingNames', 'listFacts', 'readFacts', 'resultNames'].sort(),
    );
  });
  const classifyOn = async (t: FakeNode, d?: (timers: ReturnType<typeof fakeTimers>) => void) => {
    const page = new FakePage(null);
    page.setUrl(RESULTS_URL);
    page.setTrees([t]);
    const timers = fakeTimers();
    const driver: Driver = createDriver(page, guard());
    const cur = timers.deadline(90_000);
    const run = classifyAfterFailedStep(driver, cur, { timers }, SELECTORS, 'cheapest');
    d?.(timers);
    return run;
  };
  it('a challenge page is its blocked kind, with the rule and the facts', async () => {
    const r = await classifyOn(n('document', '', [text('Please confirm you are not a robot')]));
    expect(r).toMatchObject({
      page: 'captcha',
      rule: 'challenge-text',
      facts: { page: { text: { challenge: true } } },
    });
  });
  it('a results page, or an unrecognised one, is null', async () => {
    expect(await classifyOn(resultsTree())).toBeNull();
    expect(await classifyOn(n('document', ''))).toBeNull();
  });
  it('a lookup that overruns its bound is null (the step ends plainly)', async () => {
    const t = resultsTree();
    for (const c of descendants([t])) if (c.role === 'link') c.countHang = true;
    const page = new FakePage(null);
    page.setUrl(RESULTS_URL);
    page.setTrees([t]);
    const timers = fakeTimers();
    const run = classifyAfterFailedStep(
      createDriver(page, guard()),
      timers.deadline(90_000),
      { timers },
      SELECTORS,
      'cheapest',
    );
    let out: unknown = 'pending';
    void run.then((v) => {
      out = v;
    });
    for (let i = 0; i < 10 && out === 'pending'; i++) {
      await flush();
      if (out === 'pending') timers.runOut();
    }
    expect(out).toBeNull();
  });
});

// why: the first live select-outbound recording (2026-11-01) timed out on the outbound's click; Playwright's own error
// names why an action could not land in its call log, so the click runs a margin inside its step and the reason is kept
// as one word (never the message, which can quote the page)
describe('clickOutbound’s failure word (WP21 Task 21.0, after recording 1)', () => {
  const log = (line: string) =>
    Object.assign(
      new Error(
        `locator.click: Timeout 9000ms exceeded.\nCall log:\n  - waiting for locator\n  - ${line}\n  - retrying click action`,
      ),
      {
        name: 'TimeoutError',
      },
    );
  it.each([
    ['element is not visible', 'not-visible'],
    ['<div class="x">…</div> intercepts pointer events', 'intercepted'],
    ['element is not stable', 'not-stable'],
    ['element is outside of the viewport', 'outside-viewport'],
    ['element was detached from the DOM, retrying', 'detached'],
    ['element is not enabled', 'not-enabled'],
    ['waiting for element to be visible, enabled and stable', 'other'],
  ])('%s → %s', (line, word) => {
    expect(clickFailureOf(log(line))).toBe(word);
  });
  it('the last reason in the call log wins; a non-error is other', () => {
    const e = log('element is not visible\n  - retrying click action\n  - <span> intercepts pointer events');
    expect(clickFailureOf(e)).toBe('intercepted');
    expect(clickFailureOf('x')).toBe('other');
  });
  it('a click that fails carries the word on StepFailed, and runs a margin inside its step', async () => {
    const NAME = optionName(451);
    const page = new FakePage(null);
    page.setUrl(RESULTS_URL);
    page.setTrees([n('document', '', [n('main', '', [n('link', NAME)])])]);
    page.onClick = () => {
      throw log('<div jsname="x">…</div> intercepts pointer events');
    };
    const timers = fakeTimers();
    await expect(
      createDriver(page, guard()).clickOutbound(NAME, timers.deadline(90_000), {
        timers,
        flow: 'select-outbound',
      }),
    ).rejects.toMatchObject({
      name: 'StepFailed',
      step: 'press-outbound',
      reason: 'failed',
      detail: 'intercepted',
    });
    expect(CLICK_LOG_MARGIN_MS).toBe(1000);
    expect(page.calls.timeouts).toContain(CLICK_TIMEOUT_MS - CLICK_LOG_MARGIN_MS);
    expect(page.calls.timeouts).not.toContain(CLICK_TIMEOUT_MS);
  });
});
