import { describe, expect, it } from 'vitest';
import { createDriver, PollStopped, pollUntilSettled } from '../src/driver.js';
import type { GuardState } from '../src/guard.js';
import { isSettled, STABLE_MS, stableAcross } from '../src/ready.js';
import { SELECTORS } from '../src/selectors.js';
import { DeadlineExceeded } from '../src/timers.js';
import {
  type FakeNode,
  FakePage,
  n,
  option,
  RESULTS_URL,
  resultsTree,
  returnOptionName,
  text,
} from './support/fakePage.js';
import { fakeTimers } from './support/timers.js';

const settled = { resultsReturned: true, fetching: false, cheapestPriced: true, cheapestSelected: false };
describe('isSettled (spec §2; brief §9)', () => {
  it('a settled results page', () => {
    expect(isSettled({ resultLinks: 3 }, settled)).toBe(true);
  });
  it.each([
    ['without the results-returned line', { ...settled, resultsReturned: false }, 3],
    ['still fetching', { ...settled, fetching: true }, 3],
    ['a tab name without a price', { ...settled, cheapestPriced: false }, 3],
    ['zero result links', settled, 0],
  ])('%s is not', (_n, s, links) => {
    expect(isSettled({ resultLinks: links }, s)).toBe(false);
  });
});

// why: ruling of 2026-10-18: settled means the same links across two polls at least 2 s apart
describe('stableAcross', () => {
  const at = (signature: string, links: number, ms: number) => ({ signature, links, at: ms });
  it('needs a previous poll', () => {
    expect(stableAcross(null, at('a', 2, 2000))).toBe(false);
  });
  it('the same links 2 s apart are stable; 1,999 ms apart are not', () => {
    expect(stableAcross(at('a', 2, 0), at('a', 2, STABLE_MS))).toBe(true);
    expect(stableAcross(at('a', 2, 0), at('a', 2, STABLE_MS - 1))).toBe(false);
  });
  it('other names or another count are not stable', () => {
    expect(stableAcross(at('a', 2, 0), at('b', 2, 5000))).toBe(false);
    expect(stableAcross(at('a', 2, 0), at('a', 3, 5000))).toBe(false);
  });
  it('STABLE_MS is 2 s', () => {
    expect(STABLE_MS).toBe(2000);
  });
});

// why: ruling of 2026-10-18 (the Cheapest flow): the Cheapest view shows no "N results returned." line; it settles on
// its tab being selected instead, and the Best view still needs the line
describe('isSettled by view', () => {
  const base = { resultsReturned: false, fetching: false, cheapestPriced: true, cheapestSelected: true };
  it('the Cheapest view settles without the results line when its tab is selected', () => {
    expect(isSettled({ resultLinks: 21 }, base, 'cheapest')).toBe(true);
    expect(isSettled({ resultLinks: 21 }, { ...base, cheapestSelected: false }, 'cheapest')).toBe(false);
    expect(isSettled({ resultLinks: 21 }, { ...base, fetching: true }, 'cheapest')).toBe(false);
    expect(isSettled({ resultLinks: 21 }, { ...base, cheapestPriced: false }, 'cheapest')).toBe(false);
    expect(isSettled({ resultLinks: 0 }, base, 'cheapest')).toBe(false);
  });
  it('the Best view still requires the results line, whatever the tab says', () => {
    expect(isSettled({ resultLinks: 21 }, base, 'best')).toBe(false);
    expect(isSettled({ resultLinks: 21 }, { ...base, resultsReturned: true }, 'best')).toBe(true);
    expect(isSettled({ resultLinks: 21 }, { ...base, resultsReturned: true })).toBe(true);
  });
});

// why: WP21 Task 21.0 (R-settle): the view after an outbound's selection settles only once it has changed from the
// view the click was made on, then holds still; it never needs the results line, the selected tab or the heading
describe('isSettled on the return view', () => {
  const s = { resultsReturned: false, fetching: false, cheapestPriced: false, cheapestSelected: false };
  const facts = (o: { links?: number; outbound?: number; noFlights?: boolean } = {}) => ({
    resultLinks: o.links ?? 0,
    outboundLinks: o.outbound ?? 0,
    text: { noFlights: o.noFlights ?? false },
  });
  it('is false while the view has not changed, whatever the facts', () => {
    for (const f of [facts({ links: 3 }), facts({ outbound: 2 }), facts({ noFlights: true })])
      expect(isSettled(f, { ...s, resultsReturned: true, cheapestSelected: true }, 'returns', false)).toBe(
        false,
      );
  });
  // why: WP21 Task 21.3 (the 21.0 note and the 21.1 ruling): the Cheapest view's status line that matches the
  // no-flights pattern shows on three of four recorded return views, so it never settles a view on its own; a changed
  // view with no link settles only through its deadline (the phase's not-settled)
  it('once changed, needs no fetching and a link by either pattern; the no-flights line alone never settles it', () => {
    expect(isSettled(facts({ links: 3 }), s, 'returns', true)).toBe(true);
    expect(isSettled(facts({ outbound: 1 }), s, 'returns', true)).toBe(true);
    expect(isSettled(facts({ noFlights: true }), s, 'returns', true)).toBe(false);
    expect(isSettled(facts({ links: 2, noFlights: true }), s, 'returns', true)).toBe(true);
    expect(isSettled(facts(), s, 'returns', true)).toBe(false);
    expect(isSettled(facts({ links: 3 }), { ...s, fetching: true }, 'returns', true)).toBe(false);
  });
  it('facts without the outbound count or the text read as none of either', () => {
    expect(isSettled({ resultLinks: 0 }, s, 'returns', true)).toBe(false);
    expect(isSettled({ resultLinks: 2 }, s, 'returns', true)).toBe(true);
  });
  it('the Best and Cheapest views ignore the changed flag', () => {
    const best = { resultsReturned: true, fetching: false, cheapestPriced: true, cheapestSelected: false };
    expect(isSettled({ resultLinks: 3 }, best, 'best', false)).toBe(true);
    expect(isSettled({ resultLinks: 3 }, { ...best, cheapestSelected: true }, 'cheapest', false)).toBe(true);
  });
});

describe('pollUntilSettled with changedFrom (the return view)', () => {
  const outbound = () => resultsTree({ top: [option(451), option(478)], other: [] });
  const ret = () =>
    n('document', '', [
      n('main', '', [
        n('heading', 'Returning flights'),
        n('list', '', [
          n('listitem', '', [n('link', returnOptionName({ pounds: 451, priceForm: 'from' }))]),
          n('listitem', '', [n('link', returnOptionName({ pounds: 470, priceForm: 'from' }))]),
        ]),
      ]),
    ]);
  const S = { ...SELECTORS, RETURN_SELECT_VERIFIED: true };
  const start = async (
    trees: FakeNode[],
    loads: () => number = () => 1,
    extra: { stopWhen?: () => boolean; track?: { changed: boolean } } = {},
  ) => {
    const page = new FakePage(null);
    page.setUrl(RESULTS_URL);
    page.setTrees([outbound()]);
    const g: GuardState = {
      hops: [],
      frameUrls: [],
      refused: null,
      documentLoads: 1,
      documentStarts: 0,
      activationGate: false,
      gateRefusals: 0,
      reservation: null,
      held: null,
    };
    const driver = createDriver(page, g, S);
    const timers = fakeTimers();
    const d = timers.deadline(90_000);
    const pre = await driver.readFacts(d, undefined, 'returns');
    page.setTrees(trees);
    const run = pollUntilSettled(driver, d, timers, 2000, S, {
      view: 'returns',
      changedFrom: { signature: pre.settle.linkSignature, documentLoads: 1 },
      loads,
      ...extra,
    });
    return { run, timers, d, page };
  };
  it('stays unsettled while the outbound view holds, then settles once the return view holds still', async () => {
    const { run } = await start([outbound(), outbound(), outbound(), ret()]);
    const r = await run;
    expect(r).toMatchObject({ kind: { kind: 'results' }, rule: 'returns' });
    // why: three unchanged polls, the swap on the fourth, and the fifth confirms it held still
    expect(r.polls).toBe(5);
  });
  it('a view that never changes ends at the deadline (DeadlineExceeded), never settled', async () => {
    const { run } = await start([outbound()]);
    await expect(run).rejects.toBeInstanceOf(DeadlineExceeded);
  });
  // why: WP21 Task 21.3 (R-refused): the guard's refusal is read before classifying on every poll, so a navigation the
  // gate held is the phase's transient end, never a hop the classifier reads as a block with a cool-down
  it('stopWhen true before a poll ends it with PollStopped, before any classification', async () => {
    let refused = false;
    const { run } = await start([outbound(), outbound(), ret()], () => 1, { stopWhen: () => refused });
    refused = true;
    await expect(run).rejects.toBeInstanceOf(PollStopped);
  });
  it('track records whether any poll saw the view changed (a deadline then tells no-activation from not-settled)', async () => {
    const unchanged = { changed: false };
    await expect((await start([outbound()], () => 1, { track: unchanged })).run).rejects.toBeInstanceOf(
      DeadlineExceeded,
    );
    expect(unchanged.changed).toBe(false);
    // a changed view that never settles (no link: Google's line alone)
    const lineOnly = n('document', '', [
      n('main', '', [n('heading', 'Returning flights'), text('No results returned')]),
    ]);
    const changed = { changed: false };
    await expect((await start([lineOnly], () => 1, { track: changed })).run).rejects.toBeInstanceOf(
      DeadlineExceeded,
    );
    expect(changed.changed).toBe(true);
  });
  it('a document load counts as changed, even with the same names', async () => {
    let loads = 1;
    const { run } = await start([outbound()], () => loads);
    loads = 2;
    // why: with the flag on, an outbound view after a load is changed and settled, and classified as no return view
    expect(await run).toMatchObject({
      kind: { kind: 'blocked', page: 'unrecognised' },
      rule: 'not-return-view',
    });
  });
});

// why: Ian's ruling of 2026-11-01: the booking view settles once it has changed from the return view the return was
// selected on and holds still; nothing about its content is required (its structure is what the research records)
describe('isSettled on the booking view', () => {
  const s = { resultsReturned: false, fetching: false, cheapestPriced: false, cheapestSelected: false };
  // why: tightened from select-return/2026-11-01/1 and 2: every booking view showed offers, so one is required
  it('needs the change, no fetching and at least one offer', () => {
    expect(isSettled({ resultLinks: 1 }, s, 'booking', true)).toBe(true);
    expect(isSettled({ resultLinks: 0 }, s, 'booking', true)).toBe(false);
    expect(isSettled({ resultLinks: 3 }, s, 'booking', false)).toBe(false);
    expect(isSettled({ resultLinks: 3 }, { ...s, fetching: true }, 'booking', true)).toBe(false);
  });
});
