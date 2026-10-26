import { describe, expect, it } from 'vitest';
import { classifyLanding, classifyPage, classifyPageWithRule, type PageFacts } from '../src/classify.js';
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
  },
  accountControl: false,
  cheapestTabs: [{ name: 'Cheapest from 451 British pounds', inTablist: true }],
  dateGridButtons: 1,
  resultLinks: 3,
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
