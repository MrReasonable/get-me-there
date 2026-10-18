import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { Refusal } from '../src/refusal.js';
import { fakeTimers } from './support/timers.js';
import { tmpDir } from './support/tmp.js';

beforeEach(() => {
  expect.hasAssertions();
});

describe('Refusal (devops-011: persisted until clear-signed-in)', () => {
  it('none, set, survives a new instance, cleared', () => {
    const dir = tmpDir();
    const { clock } = fakeTimers();
    const r = new Refusal({ dir, clock });
    expect(r.active()).toBeNull();
    r.set('a signed-in account control');
    expect(new Refusal({ dir, clock }).active()).toEqual({
      reason: 'a signed-in account control',
      since: '2026-10-18T05:00:00.000Z',
    });
    r.clear();
    r.clear();
    expect(r.active()).toBeNull();
  });
  it.each([
    ['not JSON', '{x'],
    ['no reason', '{"since":"2026-10-18T05:00:00.000Z"}'],
    ['a bad time', '{"reason":"r","since":"then"}'],
  ])('an unreadable record (%s) still refuses', (_n, content) => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'signed-in-refusal.json'), content);
    expect(new Refusal({ dir, clock: fakeTimers().clock }).active()?.reason).toBe(
      'unreadable refusal record',
    );
  });
  it('a read error other than a missing file is thrown', () => {
    const dir = tmpDir();
    mkdirSync(join(dir, 'signed-in-refusal.json'));
    expect(() => new Refusal({ dir, clock: fakeTimers().clock }).active()).toThrow(/EISDIR/);
  });
});
