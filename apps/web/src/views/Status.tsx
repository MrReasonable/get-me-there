import { apiContract } from '@gmt/core';
import { failureOf, useStatus } from '../api/statusQuery.js';
import { Loading } from '../components/LoadState.js';
import { cardName, StatusCard } from '../components/StatusCard.js';
import { COPY } from '../copy.js';
import { Flaps } from '../flaps/Flaps.js';
import { useCheckedWords } from '../hooks/useCheckedWords.js';
import './status.css';

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
        <div className="status-view space-y-4 pt-5">
          <h2 className="h-view">{COPY.statusView.heading}</h2>
          <div role="alert" className="plate notice flex flex-wrap items-center gap-3 font-semibold">
            <span aria-hidden="true" className="tag tag-bad">
              ✕
            </span>
            <span>
              {
                {
                  'not-answering': COPY.statusView.notAnswering,
                  'sign-in-refused': COPY.statusView.signInRefused,
                  'report-failed': COPY.statusView.reportFailed,
                }[failureOf(q.error)]
              }
            </span>
            <button type="button" className="btn btn-sm min-h-11" onClick={() => void q.refetch()}>
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
    <div className="status-view space-y-4 pt-5">
      <div className="space-y-1">
        <h2 className="h-view">{COPY.statusView.heading}</h2>
        {/* why: V11 (ui-b1-001): the ticking age is plain text; only a change of state (stale or not) is announced */}
        <p className="lede">{q.isRefetchError ? null : checked}</p>
        <p role="status" className="warn-text">
          {q.isRefetchError && checked !== null ? COPY.statusView.stale(checked) : null}
        </p>
      </div>
      <div className="status-layout">
        <StationBoard checks={groups.flatMap((g) => g.cards)} />
        <div className="status-notices space-y-5">
          {groups.map((g) => (
            <div key={g.area} className="space-y-3">
              <h3 className="h-section">{COPY.statusView.areaName[g.area]}</h3>
              {g.cards.map((c) => (
                <StatusCard key={c.id} check={c} />
              ))}
            </div>
          ))}
          {lines.length === 0 ? null : (
            <ul className="plate plate-pad status-off space-y-1">
              {lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/** Each state's lamp on the station board; the word beside it is the state's own (COPY.statusView.state). */
const LAMP: Readonly<Record<Check['state'], string>> = {
  ok: 'white',
  warn: 'amber',
  fail: 'red',
  off: 'hollow',
};

/** The longest name the board's flaps print; a longer one is cut there (the card below names it in full). */
const BOARD_NAME_CELLS = 16;

/**
 * The station information board: the shown checks, worst first, each a lamp, its area (or its search's or provider's
 * name) and its state on split-flap cells. A summary for the eye only, hidden from assistive technology: the cards
 * beside it carry the same states in words, each a labelled region, so nothing is said twice to a screen reader and
 * nothing the board shows is missing from them.
 */
function StationBoard({ checks }: { checks: readonly Check[] }) {
  if (checks.length === 0) return null;
  const rows = checks.map((c) => ({
    id: c.id,
    state: c.state,
    name: (c.area === 'data'
      ? (cardName(c) ?? COPY.statusView.areaName[c.area])
      : c.area === 'provider'
        ? `${COPY.statusView.areaName[c.area]} ${c.providerId === null ? '' : COPY.providerShort[c.providerId]}`
        : COPY.statusView.areaName[c.area]
    ).slice(0, BOARD_NAME_CELLS),
    word: COPY.statusView.state[c.state],
  }));
  const nameCells = Math.max(...rows.map((r) => r.name.length));
  const wordCells = Math.max(...rows.map((r) => r.word.length));
  return (
    <div aria-hidden="true" className="frame status-board">
      <ol className="status-board-rows">
        {rows.map((r) => (
          <li key={r.id} data-state={r.state} className="status-board-row">
            <span className="lamp-dot" data-lamp={LAMP[r.state]} />
            <Flaps text={r.name} cells={nameCells} />
            <Flaps text={r.word} cells={wordCells} className="status-board-word" />
          </li>
        ))}
      </ol>
    </div>
  );
}
