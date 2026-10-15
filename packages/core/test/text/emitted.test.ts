import { describe, expect, it } from 'vitest';
import { isSuppressed } from '../../src/alerts/dedup.js';
import { buildDigest } from '../../src/alerts/digest.js';
import { evaluateAlertRules } from '../../src/alerts/evaluate.js';
import { CONSTRAINT_LABELS } from '../../src/constraints/labels.js';
import { normaliseOffer } from '../../src/normalise/itinerary.js';
import { searchLinkFor } from '../../src/results/searchLink.js';
import { BANNED_WORD_ALLOWLIST, findBannedWords } from '../../src/text/bannedWords.js';
import { asIata, asIsoDate } from '../../src/types/ids.js';
import { CTX, calendar, cell, hoursAgo, prior, rule, verified } from '../helpers/alerts.js';
import { cellOf, deps, offer, seg } from '../helpers/offers.js';
import { key } from '../helpers/space.js';

/** Every user-facing string WP2 emits, gathered from real calls (spec §11 banned words). */
function emitted(): string[] {
  const out: string[] = [...Object.values(CONSTRAINT_LABELS)];
  const rules = [
    rule(),
    rule({ id: 'r2', requireAllVerified: false, type: 'dropAbs', thresholdPence: 1_000 }),
    rule({ id: 'r3', type: 'dropPct', thresholdPence: null, pct: 5, requireAllVerified: false }),
    rule({ id: 'r4', basis: 'calendar', requireAllVerified: null }),
    rule({ id: 'r5', basis: 'calendar', type: 'dropAbs', thresholdPence: 1_000, requireAllVerified: null }),
  ];
  const candidates = [
    verified({
      observation: { pricePence: 30_000 },
      previous: { pricePence: 40_000, fetchedAt: hoursAgo(30) },
    }),
    calendar({ pricePence: 30_000, previous: { pricePence: 40_000, fetchedAt: hoursAgo(30) } }),
    calendar({ cell: cell(20), previous: null }),
    calendar({ cell: cell(22), previous: { pricePence: 40_000, fetchedAt: hoursAgo(900) } }),
  ];
  const firings = evaluateAlertRules(rules, candidates, [], CTX);
  for (const f of firings) {
    out.push(f.reason);
    const s1 = isSuppressed(
      f,
      [prior({ identityKey: f.identityKey, dedupKey: f.dedupKey })],
      336,
      CTX.now,
    ).reason;
    const s2 = isSuppressed(
      f,
      [prior({ identityKey: f.identityKey, dedupKey: 'x', pricePence: 30_100 })],
      336,
      CTX.now,
    ).reason;
    if (s1 !== null) out.push(s1);
    if (s2 !== null) out.push(s2);
  }
  for (const r of rules) {
    const d = buildDigest(r, firings, { executionId: 'ex-2', definitionId: 'd1', coverageCaveat: null });
    for (const i of [...(d?.items ?? []), ...(d?.newItems ?? [])])
      out.push(i.firingReason, i.searchLink?.label ?? '');
  }
  const c = key('LHR', 'JFK', '2027-03-14', '2027-03-28');
  for (const id of ['travelpayouts', 'searchapi'] as const) {
    for (const cabin of ['economy', 'premium_economy'] as const)
      out.push(searchLinkFor(id, c, cabin)?.label ?? '');
  }
  const failures = [
    offer({ inbound: [] }),
    offer({ currency: 'XAU' }),
    offer({ currency: 'USD' }),
    offer({
      outbound: [
        seg({
          marketingCarrier: 'VIR',
          from: asIata('LHR'),
          to: asIata('JFK'),
          depart: '2027-03-14T10:05',
          arrive: '2027-03-14T13:05',
        }),
      ],
    }),
    offer({
      outbound: [
        seg({
          from: asIata('LHR'),
          to: asIata('ZZZ'),
          depart: '2027-03-14T10:05',
          arrive: '2027-03-14T13:05',
        }),
      ],
    }),
    offer({
      outbound: [
        seg({
          from: asIata('LHR'),
          to: asIata('JFK'),
          depart: '14/03/2027 10:05',
          arrive: '2027-03-14T13:05',
        }),
      ],
    }),
  ];
  for (const raw of failures) {
    // why: one fixed cell, so a malformed vendor time reaches normaliseOffer instead of the helper.
    const r = normaliseOffer(raw, c, deps());
    if (!r.ok) out.push(r.error.message);
  }
  const wrongCell = normaliseOffer(
    offer(),
    { ...cellOf(offer()), returnDate: asIsoDate('2027-03-27') },
    deps(),
  );
  if (!wrongCell.ok) out.push(wrongCell.error.message);
  return out.filter((s) => s !== '');
}

describe('banned words (spec §11) in every string core emits', () => {
  it('none of them contains a banned word (with the shared allowlist)', () => {
    const strings = emitted();
    expect(strings.length).toBeGreaterThan(40);
    for (const s of strings) expect(findBannedWords(s, BANNED_WORD_ALLOWLIST), s).toEqual([]);
  });
});
