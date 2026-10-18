import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDriver } from '../src/driver.js';
import type { GuardState } from '../src/guard.js';
import { SELECTORS } from '../src/selectors.js';
import { bounded } from '../src/timers.js';
import { FakePage, n, option, RESULTS_URL, resultsTree, text } from './support/fakePage.js';
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
      settle: { resultsReturned: true, fetching: false, cheapestPriced: true },
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
  it('a Cheapest tab outside a tablist is reported as such; a loading tab is fetching', async () => {
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
    expect(r.settle).toEqual({ resultsReturned: false, fetching: true, cheapestPriced: false });
  });
  it('each poll sees the next scripted tree', async () => {
    const { driver, d } = setup([n('document', '', [text('Fetching results')]), resultsTree()]);
    expect((await driver.readFacts(d)).settle.fetching).toBe(true);
    expect((await driver.readFacts(d)).settle.fetching).toBe(false);
  });
});

describe('createDriver.resultNames (PIE-R2-10)', () => {
  it('one entry per result link: aria-label, else text; nameless is empty; too long is null', async () => {
    const long = 'x'.repeat(SELECTORS.maxNameLength + 1);
    const { driver, d } = setup([
      resultsTree({
        top: [
          option(478),
          n('listitem', '', [n('link', 'from text', [], { ariaLabel: null, text: 'from text' })]),
        ],
        other: [
          n('listitem', '', [n('link', '', [], { ariaLabel: null, text: null })]),
          n('listitem', '', [n('link', long)]),
        ],
      }),
    ]);
    const names = await driver.resultNames(d);
    expect(names).toHaveLength(4);
    expect(names.slice(1)).toEqual(['from text', null, null]);
    expect(names[0]).toMatch(/^From 478 British pounds/);
  });
});

// why: fix round 1 (prov-int M4): a real result link's text is the visible card, not the option sentence
describe('createDriver.resultNames reads aria-label before the text', () => {
  it('a link whose label and text differ yields the label', async () => {
    const { driver, d } = setup([
      resultsTree({
        top: [
          n('listitem', '', [n('link', 'the label', [], { ariaLabel: 'the label', text: 'the card text' })]),
        ],
        other: [],
      }),
    ]);
    expect(await driver.resultNames(d)).toEqual(['the label']);
  });
  it('a name of exactly the length bound is kept; one more character is null', async () => {
    const at = 'x'.repeat(SELECTORS.maxNameLength);
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
