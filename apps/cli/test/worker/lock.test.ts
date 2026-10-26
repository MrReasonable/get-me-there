import { describe, expect, it } from 'vitest';
import { liveHolder, stillHeld } from '../../src/worker/lock.js';

// why: U5: the CLI reads the worker's lock by the worker's own rule (lockHeld), so a restart waits exactly as long as
// the worker's start check would refuse as `locked`
describe('the worker’s lock as the CLI reads it', () => {
  it('a live positive whole pid holds it; no file, no pid, a malformed or dead one does not', () => {
    const alive = (pid: number) => pid === 4242;
    expect(liveHolder('4242', alive)).toBe(4242);
    expect(liveHolder(' 4242\n', alive)).toBe(4242);
    for (const text of [null, '', '  ', '0', '-4242', '4242.5', '42x', 'abc'])
      expect(liveHolder(text, alive)).toBeNull();
    expect(liveHolder('77', alive)).toBeNull();
    const asked: number[] = [];
    expect(
      liveHolder('0', (pid) => {
        asked.push(pid);
        return true;
      }),
    ).toBeNull();
    expect(asked).toEqual([]);
  });
  it('a wait that ran out names the holder, its pid, the file and the bound', () => {
    expect(
      stillHeld(
        { kind: 'waitUnlocked', path: '/d/worker.lock', holder: 'the worker', timeoutSeconds: 285 },
        9,
      ),
    ).toBe('the worker (pid 9) is still running and holds /d/worker.lock after 285 s');
  });
});
