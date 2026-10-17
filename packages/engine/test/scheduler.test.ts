import { asIsoDateTime, type SearchDefinition } from '@gmt/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScheduler } from '../src/scheduler/scheduler.js';
import { baseDefinition, capturingLogger, type LogLine, T0 } from './support/harness.js';

const def = (patch: Partial<SearchDefinition> = {}): SearchDefinition => ({
  ...baseDefinition(),
  id: 'def-1',
  confirmedCostPence: null,
  confirmedCalls: null,
  createdAt: T0,
  updatedAt: T0,
  deletedAt: null,
  scheduleCron: '0 5 * * 1',
  ...patch,
});

/**
 * why: croner wakes at most every 30 s to re-check its next run, so advancing fake time by 16–18 hours runs thousands
 * of timer callbacks. Every timer here is fake (no wall-clock wait), but those callbacks take real CPU time, which a
 * cold coverage run under full parallel load stretches past Vitest's 5 s default (test-strategy review, Important 1).
 * The tests that advance by hours get an explicit, generous budget instead of depending on machine load.
 */
const HOURS_OF_FAKE_TIME = { timeout: 30_000 };

let lines: LogLine[];
const hooks = {
  onTick: vi.fn(async () => undefined),
  onResumeDue: vi.fn(async () => undefined),
  onSystem: vi.fn(async () => undefined),
};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2027-03-28T12:00:00.000Z')); // Sunday, the day of the UK spring change
  lines = [];
  for (const f of Object.values(hooks)) f.mockClear();
});
afterEach(() => vi.useRealTimers());

// why: ruling 11: cases drive croner through hours of fake time (up to about 2.3 s unloaded); the slowest set their
// own HOURS_OF_FAKE_TIME, and the rest share this 30 s so a loaded runner is a slow pass.
describe('scheduler (spec §8.2: croner with timezone; re-registered on create, PUT, disable, enable and delete)', {
  timeout: 30_000,
}, () => {
  it('registers with the definition tz and fires at the next local firing', HOURS_OF_FAKE_TIME, async () => {
    const s = createScheduler(hooks, capturingLogger(lines));
    s.register(def());
    expect(s.jobs()).toEqual([
      {
        id: 'definition:def-1',
        kind: 'definition',
        definitionId: 'def-1',
        executionId: null,
        cron: '0 5 * * 1',
        tz: 'Europe/London',
        nextRun: '2027-03-29T04:00:00.000Z',
      },
    ]);
    await vi.advanceTimersByTimeAsync(16 * 3_600_000 - 1000);
    expect(hooks.onTick).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(hooks.onTick).toHaveBeenCalledExactlyOnceWith('def-1');
    s.stopAll();
  });

  it('re-registers on edit, removes on disable and delete, restores on enable', () => {
    const s = createScheduler(hooks, capturingLogger(lines));
    s.register(def());
    s.register(def({ scheduleCron: '0 6 * * 1' })); // PUT
    expect(s.jobs().map((j) => j.nextRun)).toEqual(['2027-03-29T05:00:00.000Z']);
    s.register(def({ enabled: false })); // disable
    expect(s.jobs()).toEqual([]);
    s.register(def()); // enable
    expect(s.definitionJobCount()).toBe(1);
    s.register(def({ deletedAt: asIsoDateTime('2027-03-28T12:00:00.000Z') })); // soft delete
    expect(s.jobs()).toEqual([]);
    s.register(def());
    s.unregister('def-1'); // DELETE
    expect(s.jobs()).toEqual([]);
  });

  it('never registers an invalid schedule and says why', () => {
    const s = createScheduler(hooks, capturingLogger(lines));
    s.register(def({ scheduleCron: '*/10 * * * *' }));
    expect(s.jobs()).toEqual([]);
    expect(
      lines.some(
        (l) =>
          l.msg === 'scheduler: invalid schedule not registered' &&
          String(l.fields.reason).includes('at most once an hour'),
      ),
    ).toBe(true);
  });

  it(
    'one-shot resume jobs fire once at resume_after and can be cancelled (spec §8.1 limiter-timeout row)',
    HOURS_OF_FAKE_TIME,
    async () => {
      const s = createScheduler(hooks, capturingLogger(lines));
      s.registerResume('exec-1', 'def-1', asIsoDateTime('2027-03-28T13:00:00.000Z'));
      s.registerResume('exec-2', 'def-1', asIsoDateTime('2027-03-28T13:00:00.000Z'));
      expect(s.jobs()).toEqual([
        {
          id: 'resume:exec-1',
          kind: 'resume',
          definitionId: 'def-1',
          executionId: 'exec-1',
          cron: null,
          tz: 'UTC',
          nextRun: '2027-03-28T13:00:00.000Z',
        },
        {
          id: 'resume:exec-2',
          kind: 'resume',
          definitionId: 'def-1',
          executionId: 'exec-2',
          cron: null,
          tz: 'UTC',
          nextRun: '2027-03-28T13:00:00.000Z',
        },
      ]);
      s.cancelResume('exec-2');
      await vi.advanceTimersByTimeAsync(3_600_000 + 1000);
      expect(hooks.onResumeDue).toHaveBeenCalledExactlyOnceWith('exec-1');
      expect(s.jobs()).toEqual([]);
    },
  );

  it('a resume_after already in the past fires on the next turn of the event loop', async () => {
    const s = createScheduler(hooks, capturingLogger(lines));
    s.registerResume('exec-3', 'def-1', asIsoDateTime('2027-03-28T11:00:00.000Z'));
    await vi.advanceTimersByTimeAsync(1);
    expect(hooks.onResumeDue).toHaveBeenCalledExactlyOnceWith('exec-3');
  });

  it(
    'system jobs run but are not listed (SchedulerJob kinds are definition and resume); stopAll stops everything',
    HOURS_OF_FAKE_TIME,
    async () => {
      const s = createScheduler(hooks, capturingLogger(lines));
      s.register(def());
      s.registerSystem('fx-refresh', '0 6 * * *', 'Europe/London');
      s.runSystemSoon('maintenance', 60_000);
      expect(s.jobs().map((j) => j.kind)).toEqual(['definition']);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(hooks.onSystem).toHaveBeenCalledWith('maintenance');
      await vi.advanceTimersByTimeAsync(18 * 3_600_000 + 1000); // past 06:00 BST Monday
      expect(hooks.onSystem).toHaveBeenCalledWith('fx-refresh');
      s.runSystemSoon('fx-refresh', 60_000);
      s.stopAll();
      hooks.onSystem.mockClear();
      hooks.onTick.mockClear();
      await vi.advanceTimersByTimeAsync(7 * 24 * 3_600_000);
      expect(hooks.onTick).not.toHaveBeenCalled();
      expect(hooks.onSystem).not.toHaveBeenCalled();
      expect(s.jobs()).toEqual([]);
    },
  );

  it('a job whose hook rejects is logged and keeps its schedule', HOURS_OF_FAKE_TIME, async () => {
    hooks.onTick.mockRejectedValueOnce(new Error('tick failed at https://x.example/a?b=c'));
    const s = createScheduler(hooks, capturingLogger(lines));
    s.register(def());
    await vi.advanceTimersByTimeAsync(16 * 3_600_000 + 1000);
    expect(lines.find((l) => l.msg === 'scheduler: job failed')?.fields.err).toBe(
      'tick failed at https://x.example/a',
    );
    expect(s.jobs()[0]?.nextRun).toBe('2027-04-05T04:00:00.000Z');
    s.stopAll();
  });
});
