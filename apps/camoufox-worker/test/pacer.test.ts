import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { asIsoDateTime, fixedClock } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { Pacer } from '../src/pacer.js';
import { tmpDir } from './support/tmp.js';

const T0 = asIsoDateTime('2026-10-18T05:00:00.000Z');
beforeEach(() => {
  expect.hasAssertions();
});
describe('Pacer (spec §2: start to start, 2 s tolerance, persisted, never randomised)', () => {
  it('arrivals every 30 s ± 50 ms produce no refusal', () => {
    const clock = fixedClock(T0);
    const p = new Pacer({ dir: tmpDir(), minSpacingSeconds: 30, clock });
    let refused = 0;
    for (let i = 0; i < 20; i++) {
      if (!p.claim().ok) refused++;
      p.release();
      clock.advance(i % 2 === 0 ? 29_950 : 30_050);
    }
    expect(refused).toBe(0);
  });
  it('an arrival more than 2 s early is refused', () => {
    const clock = fixedClock(T0);
    const p = new Pacer({ dir: tmpDir(), minSpacingSeconds: 30, clock });
    p.claim();
    p.release();
    clock.advance(27_900);
    expect(p.claim()).toEqual({ ok: false, retryAfterSeconds: 1 });
  });
  it('an arrival exactly 2 s early passes (the tolerance boundary)', () => {
    const clock = fixedClock(T0);
    const p = new Pacer({ dir: tmpDir(), minSpacingSeconds: 30, clock });
    p.claim();
    p.release();
    clock.advance(28_000);
    expect(p.claim()).toEqual({ ok: true });
  });
  it('spacing 120: 120 s arrivals pass, 60 s arrivals are refused every other time', () => {
    const clock = fixedClock(T0);
    const p = new Pacer({ dir: tmpDir(), minSpacingSeconds: 120, clock });
    const results: boolean[] = [];
    for (let i = 0; i < 6; i++) {
      const c = p.claim();
      results.push(c.ok);
      if (c.ok) p.release();
      clock.advance(60_000);
    }
    expect(results).toEqual([true, false, true, false, true, false]);
  });
  it('a restart inside the spacing keeps it', () => {
    const dir = tmpDir();
    const clock = fixedClock(T0);
    const p = new Pacer({ dir, minSpacingSeconds: 30, clock });
    p.claim();
    p.release();
    clock.advance(10_000);
    expect(new Pacer({ dir, minSpacingSeconds: 30, clock }).claim()).toEqual({
      ok: false,
      retryAfterSeconds: 18,
    });
  });
  it('a second claim while busy is refused for the whole spacing', () => {
    const clock = fixedClock(T0);
    const p = new Pacer({ dir: tmpDir(), minSpacingSeconds: 30, clock });
    p.claim();
    expect(p.isBusy()).toBe(true);
    clock.advance(60_000);
    expect(p.claim()).toEqual({ ok: false, retryAfterSeconds: 30 });
    p.release();
    expect(p.claim()).toEqual({ ok: true });
  });
  it.each([
    ['not JSON', '{not json'],
    ['no lastPageAt', '{}'],
    ['a malformed instant', JSON.stringify({ lastPageAt: '2026-10-18 05:00' })],
    ['not an object', 'null'],
  ])('a corrupt record (%s) treats the last page as now', (_n, content) => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'pacer.json'), content);
    expect(new Pacer({ dir, minSpacingSeconds: 30, clock: fixedClock(T0) }).claim()).toEqual({
      ok: false,
      retryAfterSeconds: 28,
    });
  });
  it('reports the persisted last start, null before any page', () => {
    const dir = tmpDir();
    const p = new Pacer({ dir, minSpacingSeconds: 30, clock: fixedClock(T0) });
    expect(p.lastPageAt()).toBeNull();
    p.claim();
    expect(p.lastPageAt()).toBe(T0);
  });
  it('a read error other than a missing file is thrown', () => {
    const dir = tmpDir();
    const { mkdirSync } = process.getBuiltinModule('node:fs');
    mkdirSync(join(dir, 'pacer.json'));
    expect(() => new Pacer({ dir, minSpacingSeconds: 30, clock: fixedClock(T0) }).lastPageAt()).toThrow(
      /EISDIR/,
    );
  });
  it.each([29, 601, 30.5])('refuses a spacing of %s', (s) => {
    expect(() => new Pacer({ dir: tmpDir(), minSpacingSeconds: s, clock: fixedClock(T0) })).toThrow(
      /CAMOUFOX_MIN_SPACING_SECONDS/,
    );
  });
});

// why: fix round 1 (TS M5): both bounds are inclusive
describe('Pacer bounds', () => {
  it('accepts 30 and 600 seconds and refuses 29 and 601', () => {
    for (const ok of [30, 600])
      expect(
        () => new Pacer({ dir: tmpDir(), minSpacingSeconds: ok, clock: fixedClock(T0) }),
        String(ok),
      ).not.toThrow();
    for (const bad of [29, 601])
      expect(
        () => new Pacer({ dir: tmpDir(), minSpacingSeconds: bad, clock: fixedClock(T0) }),
        String(bad),
      ).toThrow(/from 30 to 600/);
  });
});
