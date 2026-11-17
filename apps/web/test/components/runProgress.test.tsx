import { asIsoDateTime, type ExecutionStatus, NO_STOP_CAUSE_TEXT } from '@gmt/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  RunProgress,
  type RunProgressProps,
  type RunProgressRun,
  runProgressOf,
} from '../../src/components/RunProgress.js';
import { COPY } from '../../src/copy.js';
import { NowContext } from '../../src/now.js';
import { latestRun, searchCard } from '../fixtures.searches.js';
import { NOW } from '../render.js';

// Design 2026-11-08 Ruling 11: one RunProgress for a card's latest run and the Search page's run. It carries what the
// old status bar's run part did (progress, Cancel with its confirmation, a stopped run's sentence and Resume, the
// child-run line), in the new words, and none of the run's calls, cost or per-source windows.

const RESUME_STOP = {
  sentence: "Stopped at 1 Nov 2026 00:00: SearchApi's monthly limit was reached.",
  fix: { text: 'Raise the limit in Edit, then Resume', command: null, resume: true as const },
};

const run = (over: Partial<RunProgressRun> = {}): RunProgressRun => ({
  id: 'exec-0001',
  status: 'running',
  done: 1203,
  total: 2184,
  estimatedFinishAt: asIsoDateTime('2026-10-14T15:14:00.000Z'),
  flightsRead: null,
  checking: null,
  stop: null,
  resumeAfter: null,
  childRun: null,
  ...over,
});

// why: concern 3 of the CodeRabbit round: a run whose whole-search counts aren't known reads the calendar uncounted
describe('a run with no whole-search count', () => {
  it('says "Reading the calendar" with its time left and no count, and its bar has no value', () => {
    show({ run: run({ done: null, total: null }) });
    const line = screen.getByTestId('run-line');
    expect(line.textContent).toBe('Reading the calendar · about 14 min left');
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('value');
  });
});

function show(props: RunProgressProps) {
  const user = userEvent.setup();
  const result = render(
    <NowContext.Provider value={() => NOW}>
      <RunProgress {...props} />
    </NowContext.Provider>,
  );
  return { user, ...result };
}

describe('RunProgress while a run is going', () => {
  it('the calendar phase: a bar of the dates read, then "Reading the calendar, 1,203 of 2,184 dates · about 14 min left"', () => {
    show({ run: run() });
    const bar = screen.getByRole('progressbar', { name: COPY.runProgress.barLabel });
    expect(bar).toHaveAttribute('value', '1203');
    expect(bar).toHaveAttribute('max', '2184');
    expect(
      screen.getByText('Reading the calendar, 1,203 of 2,184 dates · about 14 min left'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Reading flights/)).toBeNull();
  });

  it('leaves the "left" clause out without an estimate, and says "date" for a single one', () => {
    show({ run: run({ done: 0, total: 1, estimatedFinishAt: null }) });
    expect(screen.getByText('Reading the calendar, 0 of 1 date')).toBeInTheDocument();
  });

  it('the flights phase: "Reading flights for the cheapest dates, 9 read so far", the bar with no value', () => {
    show({ run: run({ flightsRead: 9 }) });
    expect(screen.getByText('Reading flights for the cheapest dates, 9 read so far')).toBeInTheDocument();
    expect(screen.queryByText(/Reading the calendar/)).toBeNull();
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('value');
  });

  // final review M1: while the run checks fares the line says so, never "Reading the calendar" over a finished calendar
  it('the checking phase: "Checking fares, 3 of 10 done · about 14 min left", the bar of the fares checked', () => {
    show({ run: run({ done: 2184, total: 2184, flightsRead: 4, checking: { done: 3, total: 10 } }) });
    expect(screen.getByText('Checking fares, 3 of 10 done · about 14 min left')).toBeInTheDocument();
    expect(screen.queryByText(/Reading the calendar|Reading flights/)).toBeNull();
    const bar = screen.getByRole('progressbar', { name: COPY.runProgress.checkingBarLabel });
    expect(bar).toHaveAttribute('value', '3');
    expect(bar).toHaveAttribute('max', '10');
  });

  it('the checking phase without its counts: "Checking fares", the time left when the run has it, a bar with no value', () => {
    show({ run: run({ checking: { done: 0, total: 0 } }) });
    expect(screen.getByText('Checking fares · about 14 min left')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('value');
    const { container } = show({ run: run({ checking: { done: 0, total: 0 }, estimatedFinishAt: null }) });
    expect(container.querySelector('.run-line')).toHaveTextContent(/^Checking fares$/);
  });

  it('a pending run reads like a running one, never the stored status word', () => {
    const { container } = show({ run: run({ status: 'pending' }) });
    expect(screen.getByText(/^Reading the calendar/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\b(running|pending)\b/);
  });

  it('shows none of the run’s calls, cost or per-source windows', () => {
    const { container } = show({ run: run() });
    expect(container.textContent).not.toMatch(/£|calls|this run|this month|priced/);
  });

  it('a running run offers no Resume and no Cancel without a handler', () => {
    show({ run: run() });
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('Cancel (today’s confirmation)', () => {
  it('asks once more, and the confirmed press calls onCancel once; Keep running backs out', async () => {
    const onCancel = vi.fn();
    const { user } = show({ run: run(), onCancel });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Keep running' }));
    expect(onCancel).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Confirm: cancel this run' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('a confirmation opened for one run is abandoned when another run replaces it, and does not come back', async () => {
    const onCancel = vi.fn();
    function Harness() {
      const [id, setId] = useState('exec-0001');
      return (
        <NowContext.Provider value={() => NOW}>
          <button type="button" onClick={() => setId((c) => (c === 'exec-0001' ? 'exec-0002' : 'exec-0001'))}>
            swap
          </button>
          <RunProgress run={run({ id })} onCancel={onCancel} />
        </NowContext.Provider>
      );
    }
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Confirm: cancel this run' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'swap' }));
    expect(screen.queryByRole('button', { name: 'Confirm: cancel this run' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'swap' }));
    expect(screen.queryByRole('button', { name: 'Confirm: cancel this run' })).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('a pending cancel disables the confirm button and marks it busy', async () => {
    const { user } = show({ run: run(), onCancel: vi.fn(), pending: 'cancel' });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    const confirm = screen.getByRole('button', { name: 'Confirm: cancel this run' });
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute('aria-busy', 'true');
  });

  it('a failed action is announced', () => {
    show({ run: run(), onCancel: vi.fn(), failure: 'execution already finished' });
    expect(screen.getByRole('alert')).toHaveTextContent('That did not work: execution already finished');
  });
});

describe('RunProgress for a stopped run', () => {
  it("the stop's sentence as-is, its fix, when it resumes, and Resume (the fix names it) calls onResume", async () => {
    const onResume = vi.fn();
    const { user } = show({
      run: run({
        status: 'paused_budget',
        stop: RESUME_STOP,
        resumeAfter: asIsoDateTime('2026-11-01T00:00:00.000Z'),
      }),
      onResume,
    });
    expect(screen.getByText(RESUME_STOP.sentence)).toBeInTheDocument();
    expect(screen.getByText(RESUME_STOP.fix.text)).toBeInTheDocument();
    expect(screen.getByText(/resumes 1 Nov 2026 00:00 Europe\/London/)).toBeInTheDocument();
    // why: no prefix of ours: the sentence is whole (spec rev 55 §8.1); and no bar for a run that is not going
    expect(screen.queryByText(/^Paused:/)).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Resume' }));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('an interrupted run offers Resume as well as Cancel (derived from core)', () => {
    show({ run: run({ status: 'interrupted', stop: RESUME_STOP }), onResume: vi.fn(), onCancel: vi.fn() });
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('a pending resume says "Working…" and is disabled', () => {
    show({ run: run({ status: 'paused_error', stop: RESUME_STOP }), onResume: vi.fn(), pending: 'resume' });
    const button = screen.getByRole('button', { name: 'Working…' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('a browser page limit’s fix is a fresh search: the structured flag, not the words, hides Resume (finding 10)', () => {
    show({
      run: run({
        status: 'paused_budget',
        stop: {
          sentence: "Stopped: the browser worker's monthly page limit was reached.",
          // why: the words even mention Resume; only the missing flag decides
          fix: { text: 'Search again to carry on (not Resume)', command: null },
        },
      }),
      onResume: vi.fn(),
      onCancel: vi.fn(),
    });
    expect(screen.getByText(/monthly page limit/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('a stopped run with no stored cause says core’s "no cause" sentence, never a status word', () => {
    show({ run: run({ status: 'paused_error', stop: null }) });
    // why: CodeRabbit CR17: exactly core's sentence, so a fallback word ("unknown", the status) fails
    expect(screen.getByTestId('stop-sentence').textContent?.trim()).toBe(NO_STOP_CAUSE_TEXT.sentence);
  });

  it('a native fix command shows as code', () => {
    show({
      run: run({
        status: 'paused_error',
        stop: {
          sentence: 'The browser worker is not running.',
          fix: { text: 'Start it, then Search again', command: 'pnpm gmt start' },
        },
      }),
    });
    expect(screen.getByText('pnpm gmt start').tagName).toBe('CODE');
  });

  it('a cancelled run says its stop and offers neither Cancel nor Resume', () => {
    show({
      run: run({
        status: 'cancelled',
        stop: { sentence: 'You cancelled this search.', fix: null },
      }),
      onResume: vi.fn(),
      onCancel: vi.fn(),
    });
    expect(screen.getByText('You cancelled this search.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('RunProgress, the rest', () => {
  it('the child-run line speaks in main-path words, even for a stopped child (finding 4)', () => {
    const { container } = show({ run: run({ childRun: 'paused_error' }) });
    expect(screen.getByText('Reading flights for one more date: stopped')).toBeInTheDocument();
    expect(container.textContent).not.toContain('paused: error');
    expect(container.textContent).not.toMatch(/itinerary|cell|date pair/);
  });

  it.each<ExecutionStatus>(['completed', 'skipped_budget'])(
    'a %s run with nothing more to say draws nothing, or only its skip sentence',
    (status) => {
      const { container } = show({ run: run({ status, stop: null }) });
      if (status === 'completed') expect(container).toBeEmptyDOMElement();
      else expect(container).not.toBeEmptyDOMElement();
    },
  );

  it('a failed action on a finished run still shows its alert', () => {
    show({ run: run({ status: 'completed' }), failure: 'nope' });
    expect(screen.getByRole('alert')).toHaveTextContent('nope');
  });
});

/** A card's latest run as the contract parses it (the fixture's own is the wire's input shape). */
function parsedRun(over: Parameters<typeof latestRun>[0]) {
  const run = searchCard({ latestRun: latestRun(over) }).latestRun;
  if (run === null) throw new Error('the card has no run');
  return run;
}

describe('runProgressOf, a card’s latest run', () => {
  it('is the calendar phase while the run reads dates, with its searched dates and estimate', () => {
    const r = runProgressOf(
      parsedRun({
        status: 'running',
        datePairs: 2184,
        datePairsSearched: 1203,
        estimatedFinishAt: '2026-10-14T15:14:00.000Z',
        flights: null,
      }),
    );
    expect(r).toMatchObject({
      status: 'running',
      done: 1203,
      total: 2184,
      flightsRead: null,
      childRun: null,
    });
    expect(r.estimatedFinishAt).toBe('2026-10-14T15:14:00.000Z');
  });

  it('is the flights phase once the run is reading them, with the lists in hand', () => {
    const r = runProgressOf(
      parsedRun({
        status: 'running',
        flights: {
          planned: 20,
          read: 7,
          reused: 2,
          failed: 0,
          ended: null,
          confirm: null,
          stopCause: null,
        },
      }),
    );
    expect(r.flightsRead).toBe(9);
  });

  // final review M1: the card's run names its stage, so a run checking fares says so as the page does
  it('is the checking phase while the run checks fares, with no counts (the card carries none)', () => {
    const r = runProgressOf(parsedRun({ status: 'running', stage: 'verification' }));
    expect(r.checking).toEqual({ done: 0, total: 0 });
    for (const over of [
      { status: 'running' as const, stage: 'discovery' as const },
      { status: 'pending' as const, stage: 'verification' as const },
      { status: 'completed' as const, stage: 'verification' as const },
    ])
      expect(runProgressOf(parsedRun(over)).checking, JSON.stringify(over)).toBeNull();
  });

  it('keeps a stopped run’s sentence and never reads flights for a run that is not running', () => {
    const r = runProgressOf(parsedRun({ status: 'paused_budget', stop: RESUME_STOP, flights: null }));
    expect(r.stop).toEqual(RESUME_STOP);
    expect(r.flightsRead).toBeNull();
    const pending = runProgressOf(
      parsedRun({
        status: 'pending',
        flights: { planned: 3, read: 1, reused: 0, failed: 0, ended: null, confirm: null, stopCause: null },
      }),
    );
    expect(pending.flightsRead).toBeNull();
  });
});
