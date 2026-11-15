import { apiContract, budgetScopeLabel, capWarn, IN_FLIGHT_STATUSES } from '@gmt/core';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useBudget, useCards, useProviders } from '../api/queries.js';
import { failureOf, useStatus } from '../api/statusQuery.js';
import { COPY } from '../copy.js';
import { formatMicroGbp } from '../format.js';
import { useCheckedWords } from '../hooks/useCheckedWords.js';
import { searchApiCallsLeft } from '../lib/searchApiCallsLeft.js';
import { hrefWith, navigateTo } from '../state/urlState.js';

const T = COPY.topBar;
const IN_FLIGHT: ReadonlySet<string> = new Set(IN_FLIGHT_STATUSES);

/** At or above 80% of the cap, by core's one rule (a cap of 0 or no cap is never near; review V8). */
export const near = (used: number, cap: number | null): boolean => capWarn(used, cap);

type Tone = 'ok' | 'warn' | 'bad';
/** A glyph beside the words, so a state differs in more than colour. */
const GLYPH: Record<Tone, string> = { ok: '●', warn: '▲', bad: '✕' };

/** Core's `name` in words: an area slug through COPY ("data" is "searches"), a label (a search's name) as it is. */
const nameWords = (name: string): string =>
  Object.entries(COPY.statusView.offName).find(([area]) => area === name)?.[1] ?? name;

/**
 * The health line (Ruling 10): one line from the same query as the Status page and core's `barSummary`. All working
 * with a dot; one problem "<name> needs attention · fix" (amber) or "<name> failing · fix" (red); several "N things need
 * you · fix" (red when any fails); `off` checks never count. The line links to the Status page. After a failed refresh
 * it says the report is stale and how old; with no report, that the app is not answering, was refused or failed: never a
 * clean state from old data. Nothing while the first answer is awaited.
 */
export function HealthLine() {
  const q = useStatus();
  const checked = useCheckedWords(q.data?.generatedAt ?? null);
  let text: string | null = null;
  let tone: Tone = 'ok';
  let fix = false;
  if (q.data === undefined) {
    if (q.error) {
      text = {
        'not-answering': COPY.statusLink.notAnswering,
        'sign-in-refused': COPY.statusLink.signInRefused,
        'report-failed': COPY.statusLink.reportFailed,
      }[failureOf(q.error)];
      tone = 'bad';
    }
  } else if (q.isRefetchError && checked !== null) {
    text = COPY.statusLink.stale(checked);
    tone = 'warn';
  } else {
    const bar = apiContract.barSummary(q.data.checks);
    tone = bar.kind === 'clean' ? 'ok' : bar.kind === 'fail' ? 'bad' : 'warn';
    fix = bar.kind !== 'clean';
    const name = bar.name === null ? null : nameWords(bar.name);
    text =
      bar.kind === 'clean'
        ? T.allWorking
        : name === null
          ? T.severalNeedYou(bar.count)
          : bar.kind === 'fail'
            ? T.failing(name)
            : T.needsAttention(name);
  }
  if (text === null) return null;
  const words = (
    <>
      <span aria-hidden="true" className={`health-glyph health-${tone}`}>
        {GLYPH[tone]}
      </span>
      {text}
      {fix ? ` · ${T.fix}` : null}
    </>
  );
  const toneClass = tone === 'bad' ? 'health-link-bad' : tone === 'warn' ? 'health-link-warn' : '';
  return (
    // why: a status region, so a change (a new problem, "All working" again) is announced politely
    <div role="status" className="health-line">
      {tone === 'ok' && !fix ? (
        <span className="health-words">{words}</span>
      ) : (
        <a
          href={hrefWith({ view: 'status' })}
          onClick={navigateTo({ view: 'status' })}
          className={`health-words ${toneClass}`}
        >
          {words}
        </a>
      )}
    </div>
  );
}

/**
 * "Searching: <name>", linking to the page of a search whose run is pending or running; nothing when none is. When a run
 * that was going stops going (finished, stopped, cancelled), the results and coverage it produced change, so they are
 * read again: the old run line did this for the run it showed, and nothing else on the page watches every search.
 */
function SearchingNow() {
  const cards = useCards();
  const qc = useQueryClient();
  const going = (cards.data?.cards ?? []).filter(
    (c) => c.latestRun !== null && IN_FLIGHT.has(c.latestRun.status),
  );
  const card = going[0];
  // why: the ids of the runs going, so a run that ends (its id leaves the set) is the one change this reacts to
  const key = going.map((c) => c.latestRun?.id).join(',');
  const previous = useRef(key);
  useEffect(() => {
    const before = previous.current.split(',').filter((id) => id !== '');
    const now = new Set(key.split(','));
    previous.current = key;
    if (before.some((id) => !now.has(id))) {
      void qc.invalidateQueries({ queryKey: ['results'] });
      void qc.invalidateQueries({ queryKey: ['coverage'] });
    }
  }, [key, qc]);
  if (card === undefined) return null;
  return (
    <a
      href={hrefWith({ view: 'dates', def: card.id })}
      onClick={navigateTo({ view: 'dates', def: card.id })}
      className="limit-item min-h-11 font-semibold underline"
    >
      {T.searching(card.name)}
    </a>
  );
}

/**
 * The remaining limits (Ruling 10), on every view: SearchApi's calls left in the window in use (only while SearchApi is
 * enabled, from `searchApiCallsLeft`, which the new-search panel shares), and the month's spend against its cap
 * (`global-month` call cost, a fixed fee not in it; `data-cost` marks it a cost, never a fare). While a search runs,
 * "Searching: <name>" comes first.
 */
export function Limits() {
  const budget = useBudget();
  const providers = useProviders();
  const month =
    budget.data?.scopes.find((u) => u.scope === budgetScopeLabel({ kind: 'global-month' })) ?? null;
  const calls =
    budget.data === undefined || providers.data === undefined
      ? null
      : searchApiCallsLeft(budget.data, providers.data);
  return (
    <section aria-label={T.limitsLabel} className="limits">
      <SearchingNow />
      {calls === null ? null : (
        <span className="limit-item">
          {calls.window === 'trial'
            ? T.callsLeftTrial(calls.left, calls.cap)
            : T.callsLeftMonth(calls.left, calls.cap)}
        </span>
      )}
      {month === null ? null : (
        // why: data-cost marks a cost or cap figure, never a fare; the rendered sweep allows "£" only in a PriceCell or here.
        <span data-cost="" className="limit-item">
          {month.cap === null
            ? T.spentNoCap(formatMicroGbp(month.costMicroGbp))
            : T.spent(formatMicroGbp(month.costMicroGbp), formatMicroGbp(month.cap))}
          {near(month.costMicroGbp, month.cap) ? <span className="limit-near">{T.nearCap}</span> : null}
        </span>
      )}
    </section>
  );
}

/** The status row of the top bar: the health line on the left, the limits on the right (under it on a phone). */
export function TopBar() {
  return (
    <div className="topbar-status">
      <HealthLine />
      <Limits />
    </div>
  );
}
