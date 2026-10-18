import { describe, expect, it } from 'vitest';
import { classifyPage, type PageFacts } from '../src/classify.js';
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
    expect(classifyPage(f)).toEqual({ kind: 'blocked', page: 'unrecognised' });
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
});
