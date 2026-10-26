import type { DecodedDatePairs, IsoDateTime } from '@gmt/core';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../api/client.js';
import { DATES_DRAWN_MARK, useDatePairs, useExecutionWatch } from '../../api/queries.js';
import type { DefinitionResponse, ExecutionResponse } from '../../api/types.js';
import { LoadError } from '../../components/LoadState.js';
import { SyntheticBanner } from '../../components/SyntheticBanner.js';
import { COPY } from '../../copy.js';
import { coverageLineText } from '../../lib/coverageLine.js';
import { useNow } from '../../now.js';
import { type DatesUiState, filtersActive, parseDatesState, scopeQuery } from '../../state/datesState.js';
import { useSearchParams } from '../../state/urlState.js';
import { BoardTable } from './BoardTable.js';
import { type BoardModel, boardModel, isSyntheticRead, PAGE_SIZE } from './board.js';
import { CoverageSection } from './CoverageSection.js';
import { DatesHeader } from './DatesHeader.js';
import { Filters } from './Filters.js';
import { type Animate, browserAnimate } from './flip.js';
import { Overview } from './OverviewGrid.js';
import { changeCount, IDLE, onProgress, onTerminal, onTimer, type Reread, readDecision } from './refresh.js';
import { NeverRun, NoPriceInFilters, NoSearch, Paused, TooManyCells } from './States.js';
import { countsOf } from './stayScope.js';
import { UpdateBoard } from './UpdateBoard.js';

const D = COPY.datesView;
const RUNNING: ReadonlySet<string> = new Set(['pending', 'running']);
const PAUSED: ReadonlySet<string> = new Set(['paused_budget', 'paused_error']);
const RESUMABLE: ReadonlySet<string> = new Set(['paused_budget', 'paused_error', 'interrupted']);

/** A clock and a timer the run re-reads go through; tests inject both (WP19 §0: no fixed waits, injected clocks). */
export interface RereadClock {
  now: () => number;
  setTimer: (fn: () => void, ms: number) => () => void;
}
const browserClock: RereadClock = {
  now: () => Date.now(),
  setTimer: (fn, ms) => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  },
};

export interface DatesViewProps {
  definition: DefinitionResponse | null;
  /** The transition's Web Animations call (WP19 §6: injected so jsdom tests can spy on it). */
  animate?: Animate;
  clock?: RereadClock;
}

/**
 * Spec §11 Dates (`?view=dates`, the default view): which dates to fly. It reads `GET /definitions/:id/date-pairs`
 * through core's decoder, applies the stay range, ranks with core's `rankDatePairs`, applies the week switch, and
 * renders the header line, the filters and the board (Task 19.4), then the overview and the coverage section.
 */
export function DatesView({ definition, animate = browserAnimate, clock = browserClock }: DatesViewProps) {
  if (definition === null) return <NoSearch />;
  // why: a new search starts with its own reads, rings and shown rows
  return <DatesOf key={definition.id} definition={definition} animate={animate} clock={clock} />;
}

interface Read {
  data: DecodedDatePairs;
  /** The scope the read answered (the route's query), so a filter change never shows another scope's figures. */
  scope: string;
  /** The instant the read was shown at: ranks and shading use one instant per read, so they never drift. */
  now: IsoDateTime;
}
interface Track {
  seen: DecodedDatePairs | undefined;
  shown: Read | null;
  pending: Read | null;
  changes: number;
  token: number;
  message: string;
}

function DatesOf({
  definition,
  animate,
  clock,
}: {
  definition: DefinitionResponse;
  animate: Animate;
  clock: RereadClock;
}) {
  const params = useSearchParams();
  const state = useMemo(() => parseDatesState(params, definition), [params, definition]);
  const scope = scopeQuery(state);
  const scopeKey = JSON.stringify(scope);
  const query = useDatePairs(definition.id, scope);
  const now = useNow();
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [lit, setLit] = useState<number | null>(null);
  const held = useRef(false);
  const captionRef = useRef<HTMLElement>(null);
  const [track, setTrack] = useState<Track>({
    seen: undefined,
    shown: null,
    pending: null,
    changes: 0,
    token: 0,
    message: '',
  });
  // why: the board model is memoised on the options' values, so one object per distinct set of them
  const options = useMemo(
    () => ({ nights: state.nights, bestPerWeek: state.bestPerWeek, sort: state.sort }),
    [state.nights, state.bestPerWeek, state.sort],
  );

  const executionId = (track.shown ?? track.pending)?.data.executionId ?? null;
  const watch = useExecutionWatch(executionId);
  const run: ExecutionResponse | undefined = watch.data?.id === executionId ? watch.data : undefined;
  const latest = track.shown?.data.executions.find((e) => !e.isChild);
  const status = run?.status ?? latest?.status;
  const runActive = status !== undefined && RUNNING.has(status);

  // why: a new read is placed while rendering (React's "adjust state when a prop changes"), so a filtered read is
  // never drawn for one frame under the previous scope, and a held read never touches the board
  if (query.data !== track.seen) {
    const data = query.data;
    let next: Track = { ...track, seen: data };
    if (data !== undefined) {
      const read: Read = { data, scope: scopeKey, now };
      if (track.shown === null || track.shown.scope !== scopeKey) {
        next = { ...next, shown: read, pending: null, changes: 0 };
      } else {
        const changes = changeCount(
          boardModel(track.shown.data.pairs, options, track.shown.now),
          boardModel(data.pairs, options, now),
          visible,
        );
        next =
          readDecision({ runActive, held: held.current, sameScope: true, changes }) === 'hold'
            ? { ...next, pending: read, changes, message: D.pendingChanges(changes) }
            : { ...next, shown: read, pending: null, changes: 0, token: track.token + 1, message: D.updated };
      }
    }
    setTrack(next);
  }
  const applyPending = () =>
    setTrack((t) =>
      t.pending === null
        ? t
        : { ...t, shown: t.pending, pending: null, changes: 0, token: t.token + 1, message: D.updated },
    );
  const onHold = (h: boolean) => {
    held.current = h;
    // why: revision 50: once the pointer and the focus have left the board, a pending read applies in place
    if (!h) applyPending();
  };

  useRunRereads(run, () => void query.refetch(), clock);

  const shown = track.shown !== null && track.shown.scope === scopeKey ? track.shown : null;
  const model: BoardModel | null = useMemo(
    () => (shown === null ? null : boardModel(shown.data.pairs, options, shown.now)),
    [shown, options],
  );
  useEffect(() => {
    // why: WP19 §6: the performance test measures from the response mark to this one, after the view commits
    if (model !== null) performance.mark(DATES_DRAWN_MARK);
  }, [model]);

  const data = shown?.data ?? null;
  // why: spec §11 Rings: the board's shown rows are ringed on the overview
  const ringed = useMemo(
    () => new Set((model?.rows ?? []).slice(0, visible).map((p) => p.index)),
    [model, visible],
  );
  return (
    <div className="space-y-4">
      {data !== null && isSyntheticRead(data, run) ? <SyntheticBanner /> : null}
      <DatesHeader definition={definition} data={data} model={model} state={state} run={run} now={now} />
      <Filters definition={definition} state={state} />
      <p role="status" className="sr-only">
        {track.message}
      </p>
      <Body
        definition={definition}
        query={query}
        data={data}
        model={model}
        state={state}
        run={run}
        runActive={runActive}
        board={(m, d) => (
          <BoardTable
            definition={definition}
            data={d}
            model={m}
            state={state}
            runActive={runActive}
            visible={visible}
            onShowMore={() => setVisible((v) => v + PAGE_SIZE)}
            lit={lit}
            onLight={setLit}
            token={track.token}
            animate={animate}
            captionRef={captionRef}
            onHold={onHold}
            update={
              track.pending !== null && track.pending.scope === scopeKey ? (
                <UpdateBoard changes={track.changes} onApply={applyPending} />
              ) : null
            }
          />
        )}
      />
      {data !== null && model !== null ? (
        <Overview
          definition={definition}
          data={data}
          model={model}
          state={state}
          ringed={ringed}
          lit={lit}
          onLight={setLit}
        />
      ) : null}
      <CoverageSection definition={definition} open={state.coverageOpen} />
    </div>
  );
}

/** The board's place: the state the read is in (spec §11 States), or the board itself. */
function Body({
  definition,
  query,
  data,
  model,
  state,
  run,
  runActive,
  board,
}: {
  definition: DefinitionResponse;
  query: ReturnType<typeof useDatePairs>;
  data: DecodedDatePairs | null;
  model: BoardModel | null;
  state: DatesUiState;
  run: ExecutionResponse | undefined;
  runActive: boolean;
  board: (m: BoardModel, d: DecodedDatePairs) => ReactNode;
}) {
  if (data === null || model === null) {
    const e = query.error;
    if (e instanceof ApiError && e.code === 'too_many_cells') {
      const cells = e.detailNumber('cells');
      const bound = e.detailNumber('bound');
      if (cells !== null && bound !== null) return <TooManyCells cells={cells} bound={bound} />;
    }
    if (e !== null) return <LoadError error={e} retry={() => void query.refetch()} />;
    return (
      <p role="status" className="rounded border border-slate-300 p-2">
        {D.loadingFiltered}
      </p>
    );
  }
  if (data.executions.length === 0) return <NeverRun definition={definition} />;
  const latest = data.executions.find((e) => !e.isChild);
  const status = run?.status ?? latest?.status;
  const counts = countsOf(model.inView);
  const onDemand = data.executions.filter((e) => e.isChild).length;
  return (
    <>
      {query.error !== null ? <LoadError error={query.error} retry={() => void query.refetch()} /> : null}
      {data.executionId === null ? <p className="font-semibold">{D.onDemandOnly(onDemand)}</p> : null}
      {latest !== undefined && status !== undefined && PAUSED.has(status) ? (
        <Paused
          executionId={latest.id}
          reason={run?.reason ?? COPY.statusName[status]}
          notSearched={counts.buckets.not_run}
          canResume={RESUMABLE.has(status)}
        />
      ) : null}
      {model.ranked.length > 0 ? (
        board(model, data)
      ) : filtersActive(state) ? (
        <NoPriceInFilters
          coverageLine={coverageLineText(counts, data.verificationProviderConfigured, latest)}
        />
      ) : (
        <p className="font-semibold">{runActive ? D.partial : D.noPricesInRun}</p>
      )}
    </>
  );
}

/**
 * Spec §11 Run landing: while the latest parent run is pending or running, a progress change from the status bar's
 * execution poll re-reads the route at most once every 30 s (a trailing read keeps the last change), and the run
 * leaving pending or running is read at once. The state machine is refresh.ts; this hook feeds it and keeps its timer.
 */
function useRunRereads(run: ExecutionResponse | undefined, reread: () => void, clock: RereadClock): void {
  const machine = useRef<Reread>(IDLE);
  const seen = useRef<{ signature: string; active: boolean } | null>(null);
  const timer = useRef<(() => void) | null>(null);
  const latestReread = useRef(reread);
  latestReread.current = reread;
  const signature = run === undefined ? null : `${run.id}|${run.status}|${JSON.stringify(run.progress)}`;
  const active = run !== undefined && RUNNING.has(run.status);
  useEffect(() => {
    if (signature === null) return;
    const before = seen.current;
    seen.current = { signature, active };
    // why: the first answer is the run as the view's own read saw it; the throttle counts from there
    if (before === null) {
      machine.current = { lastReadAt: clock.now(), trailingAt: null };
      return;
    }
    if (before.signature === signature) return;
    const at = clock.now();
    const step =
      before.active && !active
        ? onTerminal(machine.current, at)
        : active
          ? onProgress(machine.current, at)
          : null;
    if (step === null) return;
    machine.current = step.state;
    if (step.read) latestReread.current();
    const due = step.state.trailingAt;
    if (due !== null && timer.current === null) {
      timer.current = clock.setTimer(() => {
        timer.current = null;
        const fired = onTimer(machine.current, clock.now());
        machine.current = fired.state;
        if (fired.read) latestReread.current();
      }, due - at);
    }
  }, [signature, active, clock]);
  useEffect(
    () => () => {
      timer.current?.();
    },
    [],
  );
}
