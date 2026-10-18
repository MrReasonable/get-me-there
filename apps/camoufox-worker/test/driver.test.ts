import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLICK_TIMEOUT_MS, createDriver, pollUntilSettled } from '../src/driver.js';
import type { GuardState } from '../src/guard.js';
import { SELECTORS } from '../src/selectors.js';
import { bounded, DeadlineExceeded } from '../src/timers.js';
import { descendants, FakePage, n, option, RESULTS_URL, resultsTree, text } from './support/fakePage.js';
import { memoryLog } from './support/log.js';
import { fakeTimers, flush } from './support/timers.js';

const guard = (o: Partial<GuardState> = {}): GuardState => ({ hops: [], frameUrls: [], refused: null, ...o });
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
        },
        accountControl: false,
        cheapestTabs: [{ name: 'Cheapest from 451 British pounds', inTablist: true }],
        dateGridButtons: 1,
        resultLinks: 2,
      },
      settle: {
        resultsReturned: true,
        fetching: false,
        cheapestPriced: true,
        linkSignature: expect.stringMatching(/^[0-9a-f]{16}$/),
      },
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
      ]),
    ]);
    const { page } = await driver.readFacts(d);
    expect(page.text).toEqual({
      unusualTraffic: true,
      consentHeading: true,
      signInHeading: true,
      challenge: true,
      noFlights: true,
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
      { name: 'Cheapest from Fetching results 451 British pounds', inTablist: true },
      { name: '', inTablist: false },
    ]);
    // why: ruling of 2026-10-18: a loading word in the tab's own name is not the page loading
    expect(r.settle).toEqual({
      resultsReturned: false,
      fetching: false,
      cheapestPriced: false,
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
    expect((await driver.readFacts(d)).page.cheapestTabs).toEqual([{ name: '', inTablist: true }]);
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
    const run = pollUntilSettled(driver, d, timers, 2000, SELECTORS, lines);
    return { run, timers, lines };
  };
  it('a tab named exactly like the evidence settles once its links are stable across two polls', async () => {
    const { run, lines } = await poll([tree()]);
    const s = await run;
    expect(s.kind).toEqual({ kind: 'results' });
    expect(s.polls).toBe(2);
    expect(lines.lines.filter((l) => l.level === 'debug').map((l) => l.o)).toEqual([
      { resultsReturned: true, fetching: false, cheapestPriced: true, stable: false, resultLinks: 2 },
      { resultsReturned: true, fetching: false, cheapestPriced: true, stable: true, resultLinks: 2 },
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
    const clicked = await driver.clickCheapest(d, lines);
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
    expect(page.calls.timeouts.slice(-2)).toEqual([CLICK_TIMEOUT_MS, CLICK_TIMEOUT_MS]);
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
    await expect(createDriver(page, guard()).clickCheapest(timers.deadline(90_000), lines)).rejects.toThrow();
    expect(lines.lines.filter((l) => l.level === 'debug').map((l) => l.o)).toEqual([
      { error: 'TimeoutError', target: 'tab:Cheapest' },
    ]);
    expect(JSON.stringify(lines.lines)).not.toContain('https://');
  });
});
