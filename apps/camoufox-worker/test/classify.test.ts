import { describe, expect, it } from 'vitest';
import {
  cheapestTabPriceMinor,
  classifyLanding,
  classifyPage,
  classifyPageWithRule,
  type PageFacts,
} from '../src/classify.js';
import { SELECTORS } from '../src/selectors.js';

const RESULTS = 'https://www.google.com/travel/flights/search?tfs=x';
const facts = (o: Partial<PageFacts> = {}): PageFacts => ({
  url: RESULTS,
  hops: [],
  frameUrls: [],
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
  cheapestTabs: [{ name: 'Cheapest from 451 British pounds', inTablist: true }],
  dateGridButtons: 1,
  resultLinks: 3,
  outboundLinks: 3,
  ...o,
});
const t = (o: Partial<PageFacts['text']>) => ({ ...facts().text, ...o });

describe('classifyPage (spec §2, brief §9; blocked kinds first, total)', () => {
  it.each([
    [
      'a reCAPTCHA frame URL alone',
      facts({ frameUrls: ['https://www.google.com/recaptcha/api2/anchor?k=x'] }),
      'captcha',
    ],
    ['challenge text alone', facts({ text: t({ challenge: true }) }), 'captcha'],
    ['the /sorry/ URL', facts({ url: 'https://www.google.com/sorry/index?continue=x' }), 'unusual-traffic'],
    [
      'a /sorry/ hop before a results URL',
      facts({ hops: ['https://www.google.com/sorry/index'] }),
      'unusual-traffic',
    ],
    ['unusual-traffic text', facts({ text: t({ unusualTraffic: true }) }), 'unusual-traffic'],
    ['a signed-in control on a full results page', facts({ accountControl: true }), 'signed-in'],
    ['a consent URL', facts({ url: 'https://consent.google.com/ml?continue=x' }), 'consent-unhandled'],
    [
      'a consent hop (302) ending on results',
      facts({ hops: ['https://consent.google.com/ml'] }),
      'consent-unhandled',
    ],
    ['a consent heading', facts({ text: t({ consentHeading: true }) }), 'consent-unhandled'],
    ['an accounts.google.com hop', facts({ hops: ['https://accounts.google.com/ServiceLogin'] }), 'sign-in'],
    ['a sign-in heading', facts({ text: t({ signInHeading: true }) }), 'sign-in'],
    [
      'www.google.com outside /travel/flights',
      facts({ url: 'https://www.google.com/search?q=x' }),
      'off-allowlist',
    ],
    ['/travel/flightsevil', facts({ url: 'https://www.google.com/travel/flightsevil' }), 'off-allowlist'],
    ['an off-allowlist hop', facts({ hops: ['https://www.example.test/x'] }), 'off-allowlist'],
    ['plain http', facts({ url: 'http://www.google.com/travel/flights' }), 'off-allowlist'],
    ['an unparsable URL', facts({ url: 'not a url' }), 'off-allowlist'],
    ['no Date grid button', facts({ dateGridButtons: 0 }), 'unrecognised'],
    [
      'two Cheapest tabs',
      facts({
        cheapestTabs: [
          { name: 'Cheapest from 1 British pounds', inTablist: true },
          { name: 'Cheapest from 2 British pounds', inTablist: true },
        ],
      }),
      'unrecognised',
    ],
    [
      'the only Cheapest tab outside a tablist',
      facts({ cheapestTabs: [{ name: 'Cheapest from 451 British pounds', inTablist: false }] }),
      'unrecognised',
    ],
    ['no result links', facts({ resultLinks: 0 }), 'unrecognised'],
  ])('%s → blocked:%s', (_n, f, page) => {
    expect(classifyPage(f)).toEqual({ kind: 'blocked', page });
  });
  it('the feasibility-shaped results page is results', () => {
    expect(classifyPage(facts())).toEqual({ kind: 'results' });
  });
  it('the bare /travel/flights path is on the allowlist', () => {
    expect(classifyPage(facts({ url: 'https://www.google.com/travel/flights?q=x' }))).toEqual({
      kind: 'results',
    });
  });
  it('a reCAPTCHA-shaped path on another host is not a captcha (it is off the allowlist only if navigated)', () => {
    expect(classifyPage(facts({ frameUrls: ['https://www.example.test/recaptcha/x', 'not a url'] }))).toEqual(
      {
        kind: 'results',
      },
    );
  });
  it('a frame on the results host outside /recaptcha/ is no captcha', () => {
    expect(classifyPage(facts({ frameUrls: ['https://www.google.com/travel/flights/x'] }))).toEqual({
      kind: 'results',
    });
  });
  it('a consent heading beside a sign-in heading is consent-unhandled (row 4 before row 5)', () => {
    expect(classifyPage(facts({ text: t({ consentHeading: true, signInHeading: true }) }))).toEqual({
      kind: 'blocked',
      page: 'consent-unhandled',
    });
  });
  it('a signed-in control beats a consent page (row 3 before row 4)', () => {
    expect(classifyPage(facts({ accountControl: true, text: t({ consentHeading: true }) }))).toEqual({
      kind: 'blocked',
      page: 'signed-in',
    });
  });
  it('no-flights text is no-flights only when the flag is set (injected selectors)', () => {
    const f = facts({ text: t({ noFlights: true }), resultLinks: 0 });
    expect(classifyPage(f, { ...SELECTORS, NO_FLIGHTS_VERIFIED: false })).toEqual({
      kind: 'blocked',
      page: 'unrecognised',
    });
    expect(classifyPage(f, { ...SELECTORS, NO_FLIGHTS_VERIFIED: true })).toEqual({ kind: 'no-flights' });
  });
  it('a blocked kind beats no-flights even with the flag set', () => {
    expect(
      classifyPage(facts({ text: t({ noFlights: true, challenge: true }) }), {
        ...SELECTORS,
        NO_FLIGHTS_VERIFIED: true,
      }),
    ).toEqual({ kind: 'blocked', page: 'captcha' });
  });
  // why: fix round 1 (TS I1, sec M2): the host, the port and the user are each part of the rule
  it.each([
    [
      'a landing URL on another host with the results path',
      facts({ url: 'https://www.example.test/travel/flights/search' }),
    ],
    [
      'a hop on another host with the results path',
      facts({ hops: ['https://www.example.test/travel/flights'] }),
    ],
    ['google.com without www', facts({ url: 'https://google.com/travel/flights' })],
    ['a look-alike host', facts({ url: 'https://www.google.com.evil.test/travel/flights' })],
    ['an explicit port', facts({ url: 'https://www.google.com:8443/travel/flights' })],
    ['a user in the URL', facts({ url: 'https://user@www.google.com/travel/flights' })],
    ['a user and password in a hop', facts({ hops: ['https://u:p@www.google.com/travel/flights'] })],
  ])('%s → off-allowlist', (_n, f) => {
    expect(classifyPage(f)).toEqual({ kind: 'blocked', page: 'off-allowlist' });
  });
  // why: fix round 1 (TS I2): the table's order, pinned pairwise (brief §9)
  it('row 1 before row 2: a captcha frame on a /sorry/ page is captcha', () => {
    expect(
      classifyPage(
        facts({
          url: 'https://www.google.com/sorry/index',
          frameUrls: ['https://www.google.com/recaptcha/api2/anchor'],
        }),
      ),
    ).toEqual({ kind: 'blocked', page: 'captcha' });
    expect(classifyPage(facts({ text: t({ challenge: true, unusualTraffic: true }) }))).toEqual({
      kind: 'blocked',
      page: 'captcha',
    });
  });
  it('row 2 before row 3: unusual-traffic text beside an account control is unusual-traffic', () => {
    expect(classifyPage(facts({ accountControl: true, text: t({ unusualTraffic: true }) }))).toEqual({
      kind: 'blocked',
      page: 'unusual-traffic',
    });
  });
  it('row 5 before row 6: a sign-in heading on an off-allowlist URL is sign-in', () => {
    expect(
      classifyPage(facts({ url: 'https://www.google.com/search?q=x', text: t({ signInHeading: true }) })),
    ).toEqual({ kind: 'blocked', page: 'sign-in' });
  });
  // why: fix round 1 (TS M4): exactly one Date grid button
  it('two Date grid buttons → unrecognised', () => {
    expect(classifyPage(facts({ dateGridButtons: 2 }))).toEqual({ kind: 'blocked', page: 'unrecognised' });
  });
});

// why: the recording-run diagnostics of 2026-10-18: every decision names the rule that fired
describe('classifyPageWithRule', () => {
  it.each([
    ['captcha-frame', facts({ frameUrls: ['https://www.google.com/recaptcha/api2/anchor'] }), 'captcha'],
    ['challenge-text', facts({ text: t({ challenge: true }) }), 'captcha'],
    ['sorry-path', facts({ url: 'https://www.google.com/sorry/index' }), 'unusual-traffic'],
    ['unusual-traffic-text', facts({ text: t({ unusualTraffic: true }) }), 'unusual-traffic'],
    ['account-control', facts({ accountControl: true }), 'signed-in'],
    ['consent-host', facts({ hops: ['https://consent.google.com/ml'] }), 'consent-unhandled'],
    ['consent-heading', facts({ text: t({ consentHeading: true }) }), 'consent-unhandled'],
    ['sign-in-host', facts({ hops: ['https://accounts.google.com/x'] }), 'sign-in'],
    ['sign-in-heading', facts({ text: t({ signInHeading: true }) }), 'sign-in'],
    ['off-allowlist', facts({ url: 'https://www.google.com/search?q=x' }), 'off-allowlist'],
    ['cheapest-tab-count', facts({ cheapestTabs: [] }), 'unrecognised'],
    [
      'cheapest-tab-outside-tablist',
      facts({ cheapestTabs: [{ name: 'Cheapest from 1 British pounds', inTablist: false }] }),
      'unrecognised',
    ],
    ['date-grid-buttons', facts({ dateGridButtons: 0 }), 'unrecognised'],
    ['no-result-links', facts({ resultLinks: 0 }), 'unrecognised'],
  ])('%s → blocked:%s', (rule, f, page) => {
    expect(classifyPageWithRule(f)).toEqual({ kind: { kind: 'blocked', page }, rule });
  });
  it('results and no-flights name their rules too', () => {
    expect(classifyPageWithRule(facts())).toEqual({ kind: { kind: 'results' }, rule: 'results' });
    expect(
      classifyPageWithRule(facts({ text: t({ noFlights: true }), resultLinks: 0 }), {
        ...SELECTORS,
        NO_FLIGHTS_VERIFIED: true,
      }),
    ).toEqual({ kind: { kind: 'no-flights' }, rule: 'no-flights-line' });
  });
  it('classifyPage is the same decision without the rule', () => {
    for (const f of [facts(), facts({ resultLinks: 0 }), facts({ accountControl: true })])
      expect(classifyPage(f)).toEqual(classifyPageWithRule(f).kind);
  });
});

// why: ruling of 2026-10-18 (the Cheapest run on 052976e): the Cheapest view has no Date grid button; it is recognised
// by its selected, priced tab, and the "no flights" line counts only on a page with no result links
describe('classify by view (ruling of 2026-10-18)', () => {
  const tab = (o: { selected?: boolean; name?: string } = {}) => [
    { name: o.name ?? 'Cheapest from £443', inTablist: true, selected: o.selected ?? true },
  ];
  it('the Cheapest view: one selected, priced tab in the tablist and result links → results, without a Date grid', () => {
    expect(
      classifyPageWithRule(
        facts({ cheapestTabs: tab(), dateGridButtons: 0, resultLinks: 21 }),
        SELECTORS,
        'cheapest',
      ),
    ).toEqual({
      kind: { kind: 'results' },
      rule: 'results',
    });
  });
  it.each([
    ['cheapest-tab-not-selected', facts({ cheapestTabs: tab({ selected: false }), dateGridButtons: 0 })],
    ['cheapest-tab-unpriced', facts({ cheapestTabs: tab({ name: 'Cheapest' }), dateGridButtons: 0 })],
    ['no-result-links', facts({ cheapestTabs: tab(), dateGridButtons: 0, resultLinks: 0 })],
    ['cheapest-tab-count', facts({ cheapestTabs: [], dateGridButtons: 0 })],
  ])('the Cheapest view without its signs is unrecognised by %s', (rule, f) => {
    expect(classifyPageWithRule(f, SELECTORS, 'cheapest')).toEqual({
      kind: { kind: 'blocked', page: 'unrecognised' },
      rule,
    });
  });
  it('a Best page with no Date grid button is still unrecognised', () => {
    expect(
      classifyPageWithRule(facts({ cheapestTabs: tab(), dateGridButtons: 0 }), SELECTORS, 'best').rule,
    ).toBe('date-grid-buttons');
  });
  it('the no-flights line on a page with result links is never no-flights, even with the flag on', () => {
    const on = { ...SELECTORS, NO_FLIGHTS_VERIFIED: true };
    const evidence = facts({
      text: t({ noFlights: true }),
      cheapestTabs: tab(),
      dateGridButtons: 0,
      resultLinks: 21,
    });
    expect(classifyPageWithRule(evidence, on, 'cheapest').kind).toEqual({ kind: 'results' });
    expect(classifyPage(facts({ text: t({ noFlights: true }), resultLinks: 21 }), on).kind).toBe('results');
    expect(classifyPage(facts({ text: t({ noFlights: true }), resultLinks: 0 }), on)).toEqual({
      kind: 'no-flights',
    });
  });
  // why: the stop record of 2026-10-18 15:02 UTC (fixtures/recorded/stopped), its shape as the classifier received it,
  // URLs back to https with no query; the tab name keeps its recorded form
  it('the Cheapest page from the stop record classifies as results', () => {
    const record: PageFacts = {
      url: 'https://www.google.com/travel/flights/search',
      hops: ['https://www.google.com/travel/flights', 'https://www.google.com/travel/flights/search'],
      frameUrls: [
        'https://www.google.com/travel/flights/search',
        'https://www.google.com/_/FlightsFrontendUi/bscframe',
        'about:blank',
      ],
      text: {
        unusualTraffic: false,
        consentHeading: false,
        signInHeading: false,
        challenge: false,
        noFlights: true,
        landingHeading: false,
        returnHeading: false,
      },
      accountControl: false,
      cheapestTabs: [
        {
          name: 'Cheapestfrom  £443Close dialogueLooking for the lowest fares? These additional budget picks help you save but may involve trade-offs, such as flying back to a different airport in the same city that you departed from, self-transferring luggage or booking via a third-party site. Learn more',
          inTablist: true,
          selected: true,
        },
      ],
      dateGridButtons: 0,
      resultLinks: 21,
      outboundLinks: 21,
    };
    expect(classifyPageWithRule(record, SELECTORS, 'cheapest')).toEqual({
      kind: { kind: 'results' },
      rule: 'results',
    });
    expect(
      classifyPageWithRule(record, { ...SELECTORS, NO_FLIGHTS_VERIFIED: true }, 'cheapest').kind,
    ).toEqual({ kind: 'results' });
    // the same facts on the Best view are not a Best page (no Date grid)
    expect(classifyPageWithRule(record, SELECTORS, 'best').rule).toBe('date-grid-buttons');
  });
});

// why: WP17 Task 17.4: the consent command's first view is the landing page, recognised positively or not at all
describe('classifyLanding (the consent command’s first view)', () => {
  const LANDING = 'https://www.google.com/travel/flights?hl=en-GB&gl=GB';
  const on = { ...SELECTORS, LANDING_VERIFIED: true };
  const landing = (o: Partial<PageFacts> = {}): PageFacts =>
    facts({
      url: LANDING,
      hops: [LANDING],
      text: t({ landingHeading: true }),
      cheapestTabs: [],
      dateGridButtons: 0,
      resultLinks: 0,
      ...o,
    });
  it('without LANDING_VERIFIED nothing reads as landing (every entry but darwin-arm64 until its recordings)', () => {
    expect(classifyLanding(landing(), { ...SELECTORS, LANDING_VERIFIED: false })).toEqual({
      kind: { kind: 'blocked', page: 'unrecognised' },
      rule: 'not-landing',
    });
  });
  it('with the flag, the bare landing URL, its heading and no results structure is landing', () => {
    expect(classifyLanding(landing(), on)).toEqual({ kind: { kind: 'landing' }, rule: 'landing' });
  });
  it.each([
    ['a query', { url: `${LANDING}&q=Flights`, hops: [`${LANDING}&q=Flights`] }],
    ['a tfs search', { url: `${LANDING}&tfs=x`, hops: [`${LANDING}&tfs=x`] }],
    ['another path', { url: 'https://www.google.com/travel/flights/search', hops: [] }],
    ['an unparsable URL', { url: 'not a url', hops: [] }],
    ['no heading', { text: t({ landingHeading: false }) }],
    ['result links', { resultLinks: 1 }],
    ['a Cheapest tab', { cheapestTabs: [{ name: 'Cheapest', inTablist: true }] }],
    ['a Date grid button', { dateGridButtons: 1 }],
  ])('with %s it is not landing', (_w, o) => {
    expect(classifyLanding(landing(o), on).rule).not.toBe('landing');
  });
  it('the blocked kinds come first: a consent host, a challenge, a signed-in control', () => {
    expect(
      classifyLanding(landing({ hops: [LANDING, 'https://consent.google.com/ml?continue=x'] }), on).kind,
    ).toEqual({ kind: 'blocked', page: 'consent-unhandled' });
    expect(classifyLanding(landing({ text: t({ landingHeading: true, challenge: true }) }), on).kind).toEqual(
      {
        kind: 'blocked',
        page: 'captcha',
      },
    );
    expect(classifyLanding(landing({ accountControl: true }), on).kind).toEqual({
      kind: 'blocked',
      page: 'signed-in',
    });
  });
});

// why: the grid runs of 2026-10-26 stopped as unrecognised, and the Cheapest tab's name was suspected: it carries the
// text of an information pop-up about budget picks. Every recording since 2026-10-18 shows that text in the name, so
// these pin what the classifier makes of it, in the worked example's shape (London → New York, £451)
describe('the Cheapest tab carrying its information pop-up', () => {
  const POPUP =
    'Close dialogueLooking for the lowest fares? These additional budget picks help you save but may involve trade-offs, such as flying back to a different airport in the same city that you departed from, self-transferring luggage or booking via a third-party site. Learn more';
  const LOADED = `Cheapestfrom Fetching results £451${POPUP}`;
  const one = (name: string, selected?: boolean) => [
    { name, inTablist: true, ...(selected === undefined ? {} : { selected }) },
  ];
  it('one tab carrying the pop-up text is a results page on the Best view and, selected, on the Cheapest view', () => {
    expect(classifyPageWithRule(facts({ cheapestTabs: one(LOADED) }))).toEqual({
      kind: { kind: 'results' },
      rule: 'results',
    });
    expect(
      classifyPageWithRule(
        facts({ cheapestTabs: one(LOADED, true), dateGridButtons: 0 }),
        SELECTORS,
        'cheapest',
      ),
    ).toEqual({ kind: { kind: 'results' }, rule: 'results' });
  });
  it('the grid flow with the Price insights dialog open: no tab, no Date grid button, no result link is unrecognised, never a stop kind', () => {
    // why: what every --grid recording's `classification` shows; the dialog's settle stops only on the other blocked
    // kinds (dialogSettle.ts), and the page's rules were applied before the Price graph click
    const r = classifyPageWithRule(facts({ cheapestTabs: [], dateGridButtons: 0, resultLinks: 0 }));
    expect(r).toEqual({ kind: { kind: 'blocked', page: 'unrecognised' }, rule: 'cheapest-tab-count' });
  });
  it.each(['best', 'cheapest'] as const)(
    'two different Cheapest tabs are still refused on the %s view (cheapest-tab-count)',
    (view) => {
      const tabs = [...one(LOADED, true), ...one('Cheapest from £389', true)];
      expect(classifyPageWithRule(facts({ cheapestTabs: tabs }), SELECTORS, view)).toEqual({
        kind: { kind: 'blocked', page: 'unrecognised' },
        rule: 'cheapest-tab-count',
      });
    },
  );
  it('a second tab outside the tablist beside the pop-up tab is refused too', () => {
    const tabs = [...one(LOADED), { name: '', inTablist: false }];
    expect(classifyPageWithRule(facts({ cheapestTabs: tabs })).rule).toBe('cheapest-tab-count');
  });
  it('no tab and no result link is refused on either view', () => {
    for (const view of ['best', 'cheapest'] as const)
      expect(classifyPageWithRule(facts({ cheapestTabs: [], resultLinks: 0 }), SELECTORS, view).kind).toEqual(
        { kind: 'blocked', page: 'unrecognised' },
      );
  });
  // why: CodeRabbit on PR #33: the tab's name now carries the pop-up's text, so a digit anywhere in it (a pop-up saying
  // "save 10%") must never read as the tab's price; the price is the one right after "Cheapest from"
  it('a digit in the pop-up text is not a tab price: the tab is unpriced', () => {
    const name = `Cheapestfrom Fetching results Close dialogueSave 10% with budget picks, from £39. Learn more`;
    expect(cheapestTabPriceMinor(name)).toBeNull();
    expect(
      classifyPageWithRule(
        facts({ cheapestTabs: one(name, true), dateGridButtons: 0 }),
        SELECTORS,
        'cheapest',
      ).rule,
    ).toBe('cheapest-tab-unpriced');
  });
  it.each([
    ['Cheapest from 451 British pounds', 45100],
    ['Cheapest from £443', 44300],
    ['Cheapest from Fetching results 451 British pounds Learn more about ranking', 45100],
    [LOADED, 45100],
    [`Cheapestfrom  £1,204${POPUP}`, 120400],
    ['Cheapest from £451Close dialogueSave 100 British pounds', 45100],
    ['Cheapestfrom Fetching results£451', 45100],
    ['Cheapest from £12,345', 1_234_500],
    ['Cheapest from £1,234,567', 123_456_700],
    ['Cheapest from 12,345 British pounds', 1_234_500],
    ['Cheapest from 1,234,567 British pounds', 123_456_700],
  ])('the tab price of %j is the one after "Cheapest from"', (name, minor) => {
    expect(cheapestTabPriceMinor(name)).toBe(minor);
  });
  it.each([
    'Cheapest',
    'Cheapest from',
    'Cheapest from Fetching results',
    'Cheapest from 451',
    'Cheapest from £',
    'Cheapest flights 2 days from £451',
    'Cheapest from £451.50',
    'Best from £451',
    'Best Cheapest from £451',
  ])('%j states no tab price', (name) => {
    expect(cheapestTabPriceMinor(name)).toBeNull();
  });
  it('the Best view never reads the tab price: its settle waits for one (an unpriced tab is not refused here)', () => {
    expect(
      classifyPageWithRule(facts({ cheapestTabs: one(`Cheapestfrom Fetching results ${POPUP}`) })).rule,
    ).toBe('results');
  });
  it('an unpriced tab carrying the pop-up text is refused on the Cheapest view (cheapest-tab-unpriced)', () => {
    expect(
      classifyPageWithRule(
        facts({ cheapestTabs: one(`Cheapestfrom Fetching results ${POPUP}`, true), dateGridButtons: 0 }),
        SELECTORS,
        'cheapest',
      ).rule,
    ).toBe('cheapest-tab-unpriced');
  });
});

// why: WP21 Task 21.0, dated in Task 21.3 from select-outbound/2026-11-01/3 and 4: the view after an outbound's
// selection. The blocked rules come first, as on every view; then, only where RETURN_SELECT_VERIFIED is set, a return
// view is results from its recorded facts (the heading, a return link, no Cheapest tab, no Date grid button), and
// anything else is unrecognised, never a block with a cool-down (the session ends the return phase on it)
describe('classify the return view (spec rev 56 §2: the recorded conditions)', () => {
  const on = { ...SELECTORS, RETURN_SELECT_VERIFIED: true };
  const off = { ...SELECTORS, RETURN_SELECT_VERIFIED: false };
  const returnView = (o: Partial<PageFacts> = {}) =>
    facts({
      text: t({ returnHeading: true }),
      cheapestTabs: [],
      dateGridButtons: 0,
      resultLinks: 3,
      outboundLinks: 3,
      ...o,
    });
  const unrecognised = { kind: { kind: 'blocked', page: 'unrecognised' }, rule: 'not-return-view' };
  it('with the flag off is not-return-view, whatever the facts', () => {
    for (const f of [returnView(), facts(), facts({ text: t({ noFlights: true }), resultLinks: 0 })])
      expect(classifyPageWithRule(f, off, 'returns')).toEqual(unrecognised);
  });
  it('with the flag on: results with the heading, a link, no Cheapest tab and no Date grid button', () => {
    expect(classifyPageWithRule(returnView(), on, 'returns')).toEqual({
      kind: { kind: 'results' },
      rule: 'returns',
    });
    expect(classifyPage(returnView(), on, 'returns')).toEqual({ kind: 'results' });
  });
  it('outboundLinks and the link counts are not consulted (4 and 15 both pass; the outbound pattern reads every return)', () => {
    for (const [links, outbound] of [
      [4, 4],
      [15, 15],
      [4, 0],
      [1, 40],
    ] as const)
      expect(
        classifyPageWithRule(returnView({ resultLinks: links, outboundLinks: outbound }), on, 'returns').rule,
      ).toBe('returns');
  });
  it('a Cheapest tab, a Date grid button, no heading or no return link is not-return-view', () => {
    for (const f of [
      returnView({ cheapestTabs: [{ name: 'Cheapest from 451 British pounds', inTablist: true }] }),
      returnView({ dateGridButtons: 1 }),
      returnView({ text: t({ returnHeading: false }) }),
      returnView({ resultLinks: 0 }),
      facts(),
    ])
      expect(classifyPageWithRule(f, on, 'returns')).toEqual(unrecognised);
  });
  // why: the 21.1 ruling (spec rev 56 §2): the return view's own no-flights line was never recorded, so it is no status
  // of its own: such a view never settles (ready.ts) and, read after a failed step, is no return view
  it('Google’s no-flights line is no rule of its own on the return view', () => {
    for (const f of [
      returnView({ text: t({ returnHeading: true, noFlights: true }), resultLinks: 0, outboundLinks: 0 }),
      returnView({ text: t({ noFlights: true }), resultLinks: 0, outboundLinks: 0 }),
    ])
      expect(classifyPageWithRule(f, on, 'returns')).toEqual(unrecognised);
    // why: the status line beside the return links (three of four recorded return views) never changes the decision
    expect(
      classifyPageWithRule(returnView({ text: t({ returnHeading: true, noFlights: true }) }), on, 'returns')
        .rule,
    ).toBe('returns');
  });
  it.each([
    [
      'captcha',
      returnView({ frameUrls: ['https://www.google.com/recaptcha/api2/anchor?k=x'] }),
      'captcha-frame',
    ],
    ['consent-unhandled', returnView({ hops: ['https://consent.google.com/ml'] }), 'consent-host'],
    ['sign-in', returnView({ text: t({ returnHeading: true, signInHeading: true }) }), 'sign-in-heading'],
    ['signed-in', returnView({ accountControl: true }), 'account-control'],
    [
      'unusual-traffic',
      returnView({ text: t({ returnHeading: true, unusualTraffic: true }) }),
      'unusual-traffic-text',
    ],
  ] as const)('the blocked rules come first, flag on or off: %s', (page, f, rule) => {
    for (const S of [on, off])
      expect(classifyPageWithRule(f, S, 'returns')).toEqual({ kind: { kind: 'blocked', page }, rule });
  });
  it('the Best and Cheapest classifications are unchanged by the return facts; the Cheapest status line never changes them', () => {
    const cheapest = facts({
      cheapestTabs: [{ name: 'Cheapest from 451 British pounds', inTablist: true, selected: true }],
      dateGridButtons: 0,
    });
    for (const S of [on, off]) {
      expect(classifyPageWithRule(facts(), S, 'best')).toEqual({
        kind: { kind: 'results' },
        rule: 'results',
      });
      expect(classifyPageWithRule(cheapest, S, 'cheapest')).toEqual({
        kind: { kind: 'results' },
        rule: 'results',
      });
      // why: the status line matching the no-flights pattern beside the Cheapest view's links (every recording)
      expect(classifyPageWithRule({ ...cheapest, text: t({ noFlights: true }) }, S, 'cheapest').rule).toBe(
        'results',
      );
      expect(classifyPageWithRule(facts({ text: t({ returnHeading: true }) }), S).rule).toBe('results');
      expect(classifyPageWithRule(facts({ dateGridButtons: 0 }), S).rule).toBe('date-grid-buttons');
    }
  });
});

// why: WP21 Task 21.3, from select-return/2026-11-01/1–4 and select-return/2026-11-02/1: the booking view is recognised
// from its recorded facts only where BOOKING_SELECT_VERIFIED is set; anything else, and every view with the flag off, is
// the unrecognised not-booking-view, never a block with a cool-down. The page's price-comparison note is no fact: its
// wording follows the fare (the controller's ruling of 2026-11-02)
describe('classify the booking view (spec rev 56 §2: the recorded conditions)', () => {
  const on = { ...SELECTORS, RETURN_SELECT_VERIFIED: true, BOOKING_SELECT_VERIFIED: true };
  const BOOKING = 'https://www.google.com/travel/flights/booking?tfs=x';
  const bookingView = (o: Partial<PageFacts> = {}, text: Partial<PageFacts['text']> = {}) =>
    facts({
      url: BOOKING,
      text: t(text),
      cheapestTabs: [],
      dateGridButtons: 0,
      resultLinks: 6,
      outboundLinks: 0,
      ...o,
    });
  const notBooking = { kind: { kind: 'blocked', page: 'unrecognised' }, rule: 'not-booking-view' };
  it('with the flag on: results on the booking path, no return heading, no outbound link, no tab, no Date grid button and an offer', () => {
    expect(classifyPageWithRule(bookingView(), on, 'booking')).toEqual({
      kind: { kind: 'results' },
      rule: 'booking',
    });
    expect(classifyPageWithRule(bookingView({ resultLinks: 1 }), on, 'booking').rule).toBe('booking');
  });
  it.each([
    ['off the booking path', bookingView({ url: RESULTS })],
    [
      'under another booking-like path',
      bookingView({ url: 'https://www.google.com/travel/flights/bookingx' }),
    ],
    ['a return heading', bookingView({}, { returnHeading: true })],
    ['an outbound link', bookingView({ outboundLinks: 1 })],
    [
      'a Cheapest tab',
      bookingView({ cheapestTabs: [{ name: 'Cheapest from 451 British pounds', inTablist: true }] }),
    ],
    ['a Date grid button', bookingView({ dateGridButtons: 1 })],
    ['no offer on the booking path', bookingView({ resultLinks: 0 })],
    ['an unparsable URL', bookingView({ url: 'not a url' })],
  ])('%s is not-booking-view', (_what, f) => {
    // why: an unparsable URL is the off-allowlist block, as on every view (the blocked rules first)
    const want = f.url === 'not a url' ? 'off-allowlist' : 'not-booking-view';
    expect(classifyPageWithRule(f, on, 'booking').rule).toBe(want);
  });
  it('with the flag off: always not-booking-view', () => {
    for (const S of [
      SELECTORS,
      { ...SELECTORS, RETURN_SELECT_VERIFIED: true, BOOKING_SELECT_VERIFIED: false },
    ])
      expect(classifyPageWithRule(bookingView(), S, 'booking')).toEqual(notBooking);
  });
  it('the blocked rules first, flag on or off', () => {
    for (const S of [SELECTORS, on]) {
      expect(classifyPageWithRule(bookingView({}, { challenge: true }), S, 'booking')).toEqual({
        kind: { kind: 'blocked', page: 'captcha' },
        rule: 'challenge-text',
      });
      expect(
        classifyPageWithRule(bookingView({ url: 'https://www.example-airline.test/' }), S, 'booking').rule,
      ).toBe('off-allowlist');
      expect(classifyPageWithRule(bookingView({ accountControl: true }), S, 'booking').rule).toBe(
        'account-control',
      );
    }
  });
});
