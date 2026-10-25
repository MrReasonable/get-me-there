import { apiContract } from '@gmt/core';
import { failureOf, useStatus } from '../api/statusQuery.js';
import { Loading } from '../components/LoadState.js';
import { StatusCard } from '../components/StatusCard.js';
import { COPY } from '../copy.js';
import { useCheckedWords } from '../hooks/useCheckedWords.js';

type Check = apiContract.StatusCheck;

/** Folds the off checks into one line per reason; the container-mode backups card keeps a card of its own. */
export function offLines(checks: readonly Check[]): string[] {
  const folded = checks.filter((c) => c.state === 'off' && c.offReason !== 'not-visible');
  // why: a browser provider that is off also leaves its consent check off; naming it twice says nothing more
  const workerOff = folded.some((c) => c.area === 'worker');
  const out: string[] = [];
  for (const reason of apiContract.statusCheckSchema.shape.offReason.unwrap().options) {
    const names = folded
      .filter((c) => c.offReason === reason && !(workerOff && c.area === 'consent'))
      .map((c) =>
        c.area === 'data' && c.label !== null
          ? c.label
          : c.area === 'provider' && c.providerId !== null
            ? COPY.provider[c.providerId]
            : COPY.statusView.offName[c.area],
      );
    const unique = [...new Set(names)];
    if (reason !== 'not-visible' && unique.length > 0)
      out.push(COPY.statusView.offLine[reason](unique.join(', ')));
  }
  return out;
}

/** The cards shown in full: everything not off, plus a not-visible card, grouped by area, worst first. */
export function groupedCards(checks: readonly Check[]): Array<{ area: Check['area']; cards: Check[] }> {
  const shown = apiContract.sortChecks(
    checks.filter((c) => c.state !== 'off' || c.offReason === 'not-visible'),
  );
  const groups = new Map<Check['area'], Check[]>();
  for (const c of shown) groups.set(c.area, [...(groups.get(c.area) ?? []), c]);
  // sortChecks put the worst first, so the map's insertion order is worst first
  return [...groups.entries()].map(([area, cards]) => ({ area, cards }));
}

/**
 * Spec §11 Status: one card per check of `GET /status`, grouped by area, worst first. "checked N s ago" comes from the
 * report's own `generatedAt`; after a failed refresh the last report stays, marked stale with its age, and with no report
 * the view says the app is not answering. Refreshes on focus and every 60 s; read only apart from the email card's test.
 */
export function StatusView() {
  const q = useStatus();
  const checked = useCheckedWords(q.data?.generatedAt ?? null);
  if (q.data === undefined) {
    if (q.error)
      return (
        <div className="space-y-2 text-sm">
          <h2 className="text-xl font-semibold">{COPY.statusView.heading}</h2>
          <div role="alert" className="flex flex-wrap items-center gap-2 rounded border border-red-700 p-2">
            <span>
              {
                {
                  'not-answering': COPY.statusView.notAnswering,
                  'sign-in-refused': COPY.statusView.signInRefused,
                  'report-failed': COPY.statusView.reportFailed,
                }[failureOf(q.error)]
              }
            </span>
            <button
              type="button"
              className="min-h-11 rounded border border-slate-500 px-3"
              onClick={() => void q.refetch()}
            >
              {COPY.retryLoad}
            </button>
          </div>
        </div>
      );
    return <Loading />;
  }
  const lines = offLines(q.data.checks);
  const groups = groupedCards(q.data.checks);
  return (
    <div className="space-y-3 text-sm">
      <h2 className="text-xl font-semibold">{COPY.statusView.heading}</h2>
      {/* why: V11 (ui-b1-001): the ticking age is plain text; only a change of state (stale or not) is announced */}
      <p>{q.isRefetchError ? null : checked}</p>
      <p role="status">{q.isRefetchError && checked !== null ? COPY.statusView.stale(checked) : null}</p>
      {groups.map((g) => (
        <div key={g.area} className="space-y-2">
          <h3 className="font-semibold">{COPY.statusView.areaName[g.area]}</h3>
          {g.cards.map((c) => (
            <StatusCard key={c.id} check={c} />
          ))}
        </div>
      ))}
      {lines.length === 0 ? null : (
        <ul className="list-disc pl-5 text-slate-700">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
