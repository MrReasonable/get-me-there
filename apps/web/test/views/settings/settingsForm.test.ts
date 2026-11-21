// The Settings page's form logic (settings plan rulings 8, 14): which section saves which owned name, a source list as
// stored, what a name holds before any edit, and the restart's watch on a clock the test steps.
import { OWNED_NAMES } from '@gmt/core';
import { describe, expect, it, vi } from 'vitest';
import { SETTINGS_SECTIONS } from '../../../src/state/view.js';
import {
  originalOf,
  parseSourceList,
  RESTART_LIMIT_MS,
  RESTART_POLL_MS,
  SECTION_NAMES,
  sourceListValue,
  watchRestart,
} from '../../../src/views/Settings/useSettingsForm.js';
import { settingsView } from '../../fixtures.js';
import { manualClock } from './manualClock.js';

describe('the sections own the names', () => {
  it('every owned name is saved by exactly one section, and System saves none', () => {
    const all = SETTINGS_SECTIONS.flatMap((s) => [...SECTION_NAMES[s]]);
    expect([...all].sort()).toEqual([...OWNED_NAMES].sort());
    expect(new Set(all).size).toBe(all.length);
    expect(SECTION_NAMES.system).toEqual([]);
  });
});

describe('a source list as the app stores it', () => {
  it('core’s order, comma-separated; an empty list is none', () => {
    expect(sourceListValue(['searchapi', 'travelpayouts'])).toBe('travelpayouts,searchapi');
    expect(sourceListValue([])).toBe('none');
    expect(parseSourceList('travelpayouts,searchapi')).toEqual(['travelpayouts', 'searchapi']);
    expect(parseSourceList('none')).toEqual([]);
    expect(parseSourceList(null)).toEqual([]);
    expect(parseSourceList('travelpayouts, nonsense')).toEqual(['travelpayouts']);
  });
});

describe('what a name holds before any edit', () => {
  it('a list is the effective one the api gives; a plain name its stored value; a secret nothing', () => {
    const view = settingsView({
      values: { ...settingsView().values, FLIGHT_READ_PATIENCE: '20', NEW_SEARCH_DISCOVERY: null },
      newSearchSources: { discovery: ['camoufox', 'travelpayouts'], verification: [] },
    });
    expect(originalOf(view, 'NEW_SEARCH_DISCOVERY')).toBe('travelpayouts,camoufox');
    expect(originalOf(view, 'NEW_SEARCH_VERIFICATION')).toBe('none');
    expect(originalOf(view, 'FLIGHT_READ_PATIENCE')).toBe('20');
    expect(originalOf(view, 'SEARCHAPI_PLAN')).toBeNull();
    expect(originalOf(view, 'SEARCHAPI_KEY')).toBeNull();
  });
});

describe('the restart’s watch (ruling 14)', () => {
  /** A read the test answers by hand, one promise per call. */
  function reads() {
    const pending: Array<{ resolve: (id: string | null) => void; reject: (e: Error) => void }> = [];
    const read = () =>
      new Promise<string | null>((resolve, reject) => {
        pending.push({ resolve, reject });
      });
    return { read, pending };
  }

  it('asks every poll until a new boot id answers; an old id or no answer is asked again', async () => {
    const m = manualClock();
    const { read, pending } = reads();
    let back: (outcome: string) => void = () => undefined;
    const outcome = new Promise<string>((resolve) => {
      back = resolve;
    });
    const done = vi.fn((o: string) => back(o));
    watchRestart('boot-1', read, done, m.clock);
    expect(pending).toHaveLength(0);
    m.advance(RESTART_POLL_MS);
    expect(pending).toHaveLength(1);
    pending[0]?.resolve('boot-1');
    // the next poll is set once the read has settled
    await m.scheduled(3);
    m.advance(RESTART_POLL_MS);
    expect(pending).toHaveLength(2);
    pending[1]?.reject(new Error('no answer'));
    await m.scheduled(4);
    m.advance(RESTART_POLL_MS);
    expect(pending).toHaveLength(3);
    expect(done).not.toHaveBeenCalled();
    pending[2]?.resolve('boot-2');
    expect(await outcome).toBe('back');
    expect(done).toHaveBeenCalledOnce();
    expect(m.pending()).toBe(0);
    m.advance(RESTART_LIMIT_MS);
    expect(pending).toHaveLength(3);
    expect(done).toHaveBeenCalledOnce();
  });

  it('a read still in flight is not asked again over it', () => {
    const m = manualClock();
    const { read, pending } = reads();
    watchRestart('boot-1', read, vi.fn(), m.clock);
    m.advance(RESTART_POLL_MS * 5);
    expect(pending).toHaveLength(1);
  });

  it('gives up after the limit, once, and a read in flight that answers later sets no new poll', async () => {
    const m = manualClock();
    const { read, pending } = reads();
    const done = vi.fn();
    watchRestart('boot-1', read, done, m.clock);
    m.advance(RESTART_LIMIT_MS - 1);
    expect(done).not.toHaveBeenCalled();
    m.advance(1);
    expect(done).toHaveBeenCalledExactlyOnceWith('not-back');
    expect(m.pending()).toBe(0);
    const sets = m.sets();
    pending[0]?.resolve('boot-2');
    // why: the read's then and finally are microtasks; one macrotask turn runs them all
    await new Promise<void>((resolve) => setImmediate(resolve));
    m.advance(RESTART_POLL_MS * 3);
    expect(done).toHaveBeenCalledOnce();
    expect(m.sets()).toBe(sets);
    expect(pending).toHaveLength(1);
  });

  it('the cancel stops it: no read, no outcome', () => {
    const m = manualClock();
    const { read, pending } = reads();
    const done = vi.fn();
    const cancel = watchRestart('boot-1', read, done, m.clock);
    cancel();
    expect(m.pending()).toBe(0);
    m.advance(RESTART_LIMIT_MS * 2);
    expect(pending).toHaveLength(0);
    expect(done).not.toHaveBeenCalled();
  });
});
