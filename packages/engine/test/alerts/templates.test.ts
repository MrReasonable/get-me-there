import {
  asIsoDate,
  asIsoDateTime,
  BANNED_WORD_ALLOWLIST,
  CONSTRAINT_LABELS,
  findBannedWords,
  type Segment,
} from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { appRowLink, MAX_PROVIDER_TEXT, renderBody, renderSubject } from '../../src/alerts/templates.js';
import { calendarItem, digestOf, HASH, NOW, RULE, renderInput, verifiedItem } from './builders.js';

/** The worked example's outbound segment with a hostile carrier string. */
function hostileSegment(marketingCarrier: string): Segment {
  const { cell } = verifiedItem();
  return {
    marketingCarrier,
    flightNumber: 117,
    from: cell.origin,
    to: cell.destination,
    departLocal: '2027-03-14T08:25',
    arriveLocal: '2027-03-14T11:20',
  };
}

// why: WP19 Task 19.3 (spec §8.3): a POST booking opens the row's date pair detail; the query is core's detailLinkQuery
const ROW = `/?view=results&def=def-1&depart=2027-03-14&return=2027-03-28&basis=verified&row=${HASH}`;
/** The literal core's detailLink.test.ts and the web landing test also hold (WP19 Task 19.1). */
const LITERAL_HASH = '9f3c2a7b41d0e6f85a1c3b2d4e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7a8b9';
const LITERAL = `view=results&def=def-1&depart=2027-03-14&return=2027-03-28&basis=verified&row=${LITERAL_HASH}`;
const TRIP = { departureDate: asIsoDate('2027-03-14'), returnDate: asIsoDate('2027-03-28') };
const VERIFIED_SUBJECT =
  "[get-me-there] £412 LHR→JFK 14 Mar–28 Mar (14n) · Google Flights via SearchApi · fetched 5h ago · vendor's cache age unknown · 1 constraint unverified";

describe('subject formats (spec §8.3)', () => {
  it("itinerary-search basis: a SearchApi itinerary price's vendor age is unknown (spec rev 15; decision 55 wording)", () => {
    expect(renderSubject(verifiedItem(), NOW)).toBe(VERIFIED_SUBJECT);
  });
  it('calendar basis: the spec §8.3 example, provider age bound and "constraints not checked"', () => {
    expect(renderSubject(calendarItem(), NOW)).toBe(
      '[get-me-there] £389 LHR→JFK 14 Mar–28 Mar (14n) · Aviasales cache · fetched 2h ago · provider age unknown (≤7d before that) · constraints not checked',
    );
  });
  it('class verified, plural unverified, an unconfirmed price, ≈ for FX-converted prices', () => {
    expect(renderSubject(verifiedItem({ verdictClass: 'verified', unverified: [] }), NOW)).toMatch(
      / · class verified$/,
    );
    expect(
      renderSubject(verifiedItem({ unverified: ['checkedBagRequired', 'noSelfTransfer'] }), NOW),
    ).toMatch(/ · 2 constraints unverified$/);
    expect(
      renderSubject(verifiedItem({ unverified: ['priceConfirmed', 'checkedBagRequired'] }), NOW),
    ).toMatch(/ · price not confirmed by the final step$/);
    const fx = verifiedItem({
      provenance: {
        ...verifiedItem().provenance,
        fx: { converted: true, rateNano: 790_000_000, rateDate: asIsoDate('2026-10-13'), source: 'ecb' },
      },
    });
    expect(renderSubject(fx, NOW)).toContain('≈£412 LHR→JFK');
  });
  it('hostile provider strings never reach the subject: it is exactly the plain one (review TS-9, TS-14)', () => {
    const hostile = verifiedItem({
      seller: 'Cheap\r\nBcc: victim@example.org\u202E',
      firingReason: 'x\r\nSubject: y',
      booking: {
        kind: 'get',
        url: 'https://www.google.com/travel/clk?tfs=abc',
        host: 'www.google.com\r\nX: 1',
      },
      outbound: [hostileSegment('B\u0000A\u200B')],
    });
    expect(renderSubject(hostile, NOW)).toBe(VERIFIED_SUBJECT);
  });
});

describe('itinerary-search item body (spec §8.3)', () => {
  it('a whole one-item digest, exactly (review TS-13)', () => {
    expect(renderBody(renderInput({ digest: digestOf([verifiedItem()], { restCount: 2 }) }))).toBe(
      [
        'get-me-there alert for "London to New York (worked example)"',
        '',
        '1. £412 LHR→JFK 14 Mar–28 Mar (14n)',
        '   Why: £412 is at or below the £450 threshold',
        '   Seller: British Airways',
        '   Outbound: BA 117 LHR 08:25 → JFK 11:20 (14 Mar)',
        '   Inbound: BA 112 JFK 18:30 → LHR 06:35 (28 Mar)',
        `   Verdicts: class partially-verified; unverified: ${CONSTRAINT_LABELS.checkedBagRequired}`,
        "   Provenance: Google Flights via SearchApi · UK market · fetched 5h ago · vendor's cache age unknown",
        '   Link: https://www.google.com/travel/clk?tfs=abc (host www.google.com, expires in 3h)',
        '',
        'and 2 more',
        '',
        'Coverage: itinerary-searched 3 of 10 cells, 2 outbounds each',
        'Rule: alert when the price is £450 or less · itinerary-search basis, class verified or partially-verified · cooldown 336h',
      ].join('\n'),
    );
  });
  it("POST booking: links to the row's date pair detail with the item's cell dates (relative, absolute, under a path prefix), never the vendor form", () => {
    const post = verifiedItem({
      booking: {
        kind: 'post',
        url: 'https://www.google.com/travel/clk/f',
        postData: 'u=formdata',
        host: 'www.google.com',
      },
    });
    const relative = renderBody(renderInput({ digest: digestOf([post]) }));
    expect(relative).toContain(`get-me-there: ${ROW}`);
    expect(relative).not.toContain('u=formdata');
    expect(relative).not.toContain('https://www.google.com/travel/clk/f');
    expect(appRowLink(null, 'def-1', 'verified', LITERAL_HASH, TRIP)).toBe(`/?${LITERAL}`);
    expect(appRowLink(null, 'def-1', 'verified', HASH, TRIP)).toBe(ROW);
    expect(appRowLink(null, 'def 1', 'calendar', 'calendar:5', TRIP)).toBe(
      '/?view=results&def=def+1&depart=2027-03-14&return=2027-03-28&basis=calendar&row=calendar%3A5',
    );
    expect(appRowLink('https://gmt.example.ts.net', 'def-1', 'verified', HASH, TRIP)).toBe(
      `https://gmt.example.ts.net${ROW}`,
    );
    expect(appRowLink('https://gmt.example.ts.net/', 'def-1', 'verified', HASH, TRIP)).toBe(
      `https://gmt.example.ts.net${ROW}`,
    );
    expect(appRowLink('https://example.org/gmt/', 'def-1', 'verified', HASH, TRIP)).toBe(
      `https://example.org/gmt${ROW}`,
    );
    const absolute = renderBody(
      renderInput({ digest: digestOf([post]), appBaseUrl: 'https://gmt.example.ts.net/' }),
    );
    expect(absolute).toContain(`https://gmt.example.ts.net${ROW}`);
  });
  it('expiry states; no booking → labelled search link; a booking or search link that fails re-validation → no link', () => {
    const at = (over: Parameters<typeof verifiedItem>[0]) =>
      renderBody(renderInput({ digest: digestOf([verifiedItem(over)]) }));
    expect(at({ bookingExpiresAt: asIsoDateTime('2026-10-14T13:00:00.000Z') })).toContain('expired 2h ago');
    expect(at({ bookingExpiresAt: asIsoDateTime('2026-10-14T14:30:00.000Z') })).toContain('expired just now');
    expect(at({ bookingExpiresAt: asIsoDateTime('2026-10-14T15:30:00.000Z') })).toContain(
      'expires within the hour',
    );
    expect(at({ bookingExpiresAt: null })).toContain('expiry not stated');
    expect(at({ booking: { kind: 'none' } })).toContain(
      'Link: https://www.google.com/travel/flights?q=LHR+JFK+2027-03-14+2027-03-28 (host www.google.com, search link, not a fare link)',
    );
    for (const booking of [
      { kind: 'get', url: 'http://www.google.com/x', host: 'www.google.com' },
      { kind: 'get', url: 'https://www.google.com.evil.example/x', host: 'www.google.com.evil.example' },
      { kind: 'get', url: 'https://www.google.com/x', host: 'www.aviasales.com' },
    ] as const) {
      const bad = at({ booking });
      expect(bad).not.toContain(booking.url);
      expect(bad).toContain('Link: none (the stored link failed validation)');
    }
    for (const searchLink of [
      { url: 'https://evil.example/flights', host: 'evil.example', label: 'search link, not a fare link' },
      {
        url: 'http://www.google.com/travel/flights',
        host: 'www.google.com',
        label: 'search link, not a fare link',
      },
    ]) {
      const bad = at({ booking: { kind: 'none' }, searchLink });
      expect(bad).not.toContain(searchLink.url);
      expect(bad).toContain('Link: none (the search link failed validation)');
    }
  });
  it('class verified says every constraint passed; an unconfirmed price is labelled in its verdicts and notes', () => {
    expect(
      renderBody(
        renderInput({ digest: digestOf([verifiedItem({ verdictClass: 'verified', unverified: [] })]) }),
      ),
    ).toContain('   Verdicts: class verified; every constraint passed');
    const body = renderBody(
      renderInput({ digest: digestOf([verifiedItem({ unverified: ['priceConfirmed'] })]) }),
    );
    expect(body).toContain(
      '   Verdicts: class partially-verified; unverified: price not confirmed by the final step',
    );
    expect(body).toContain('   Notes: price not confirmed by the final step');
  });
});

describe('calendar items (spec §6.8, §8.3)', () => {
  it('a whole calendar digest with a drop and a new cell whose previous price is outside the window, exactly (review TS-13, PA-9)', () => {
    const drop = calendarItem({
      previousPricePence: 43000,
      fetchGapHours: 72,
      firingReason: 'down £41 (9%) from £430 fetched 3d (72h) earlier',
    });
    const outOfWindow = calendarItem({
      isNew: true,
      rowKey: 'calendar:6',
      previousPricePence: 50000,
      fetchGapHours: 169,
    });
    const body = renderBody(
      renderInput({
        digest: digestOf([drop], {
          basis: 'calendar',
          coverageCaveat: null,
          newItems: [outOfWindow, calendarItem({ isNew: true, rowKey: 'calendar:7', pricePence: 39900 })],
          newRestCount: 4,
          rule: {
            ...RULE,
            type: 'dropAbs',
            thresholdPence: 2000,
            basis: 'calendar',
            requireAllVerified: null,
          },
        }),
      }),
    );
    expect(body).toBe(
      [
        'get-me-there alert for "London to New York (worked example)"',
        '',
        '1. £389 LHR→JFK 14 Mar–28 Mar (14n)',
        '   Why: down £41 (9%) from £430 fetched 3d (72h) earlier',
        '   calendar price, no itinerary; constraints not checked',
        '   Previous: £430, fetched 3d before this price',
        '   Provenance: Aviasales cache · market not stated · fetched 2h ago · provider age unknown (≤7d before that)',
        '   Link: https://www.aviasales.com/search/LON1403NYC28031 (host www.aviasales.com, search link, not a fare link)',
        '',
        'New since the last check (no earlier price within the comparison window; not a drop):',
        '- £389 LHR→JFK 14 Mar–28 Mar (14n) · Aviasales cache · fetched 2h ago · provider age unknown (≤7d before that) · previous £500, fetched 7d before this price',
        '- £399 LHR→JFK 14 Mar–28 Mar (14n) · Aviasales cache · fetched 2h ago · provider age unknown (≤7d before that)',
        'and 4 more new cells',
        '',
        'Coverage: itinerary-searched 0 cells (no verification provider configured)',
        'Rule: alert when the price drops by £20 or more · calendar basis, constraints not checked · cooldown 336h',
      ].join('\n'),
    );
  });
  it('a gap under an hour reads "under an hour", never "just now"', () => {
    const body = renderBody(
      renderInput({
        digest: digestOf([calendarItem({ previousPricePence: 43000, fetchGapHours: 0 })], {
          coverageCaveat: null,
        }),
      }),
    );
    expect(body).toContain('   Previous: £430, fetched under an hour before this price');
  });
});

describe('provider strings are CRLF/control-stripped and bounded (spec §8.3; review TS-14, sec-007)', () => {
  it('a seller, carrier, definition name or reason cannot inject headers or lines, reorder text or flood the body', () => {
    const item = verifiedItem({
      seller: 'Cheap Seats\r\nBcc: victim@example.org\u0007\u202E',
      firingReason: '£412 is at or below the £450 threshold\rX-Injected: 1',
      outbound: [hostileSegment('B\u0085A\u200B')],
    });
    const body = renderBody(
      renderInput({ digest: digestOf([item]), definitionName: 'Trip\r\nX-Injected: 1\u2028Y\u2066' }),
    );
    const hostile = [0x0d, 0x07, 0x85, 0x2028, 0x202e, 0x2066, 0x200b];
    expect([...body].filter((ch) => hostile.includes(ch.codePointAt(0) ?? 0))).toEqual([]);
    expect(body.split('\n').filter((l) => /^(Bcc|X-Injected|Y)\b/.test(l))).toEqual([]);
    expect(body).toContain('get-me-there alert for "Trip X-Injected: 1 Y"');
    expect(body).toContain('   Seller: Cheap Seats Bcc: victim@example.org');
    expect(body).toContain('   Why: £412 is at or below the £450 threshold X-Injected: 1');
    expect(body).toContain('   Outbound: B A 117 LHR 08:25 → JFK 11:20 (14 Mar)');
    const long = renderBody(renderInput({ digest: digestOf([verifiedItem({ seller: 'S'.repeat(500) })]) }));
    expect(long).toContain(`   Seller: ${'S'.repeat(MAX_PROVIDER_TEXT - 1)}…\n`);
  });
});

describe('banned words over rendered output (spec §8.3, §11)', () => {
  it('no banned word in any rendered subject or body', () => {
    const outputs = [
      renderSubject(verifiedItem(), NOW),
      renderSubject(calendarItem(), NOW),
      renderSubject(verifiedItem({ unverified: ['priceConfirmed'] }), NOW),
      renderBody(
        renderInput({
          digest: digestOf([verifiedItem()], { restCount: 40, newItems: [calendarItem({ isNew: true })] }),
        }),
      ),
      renderBody(
        renderInput({
          digest: digestOf([calendarItem({ previousPricePence: 43000, fetchGapHours: 0 })], {
            coverageCaveat: null,
          }),
        }),
      ),
      renderBody(
        renderInput({
          digest: digestOf([
            verifiedItem({
              booking: {
                kind: 'post',
                url: 'https://www.google.com/f',
                postData: 'x',
                host: 'www.google.com',
              },
            }),
          ]),
        }),
      ),
    ];
    for (const text of outputs) expect(findBannedWords(text, BANNED_WORD_ALLOWLIST)).toEqual([]);
  });
});
