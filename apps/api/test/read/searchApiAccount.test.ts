// The api's cache of SearchApi's own balance (settings plan ruling 10): ten minutes on the injected clock, refreshed
// after a run that called SearchApi, null without a key. The fetch is a double: no request leaves the process.
import { asIsoDate, asIsoDateTime, fixedClock, type SearchApiAccount } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_FAILURE_TTL_MS,
  ACCOUNT_STALE_MAX_MS,
  ACCOUNT_TTL_MS,
  createSearchApiAccount,
} from '../../src/read/searchApiAccount.js';

const T0 = asIsoDateTime('2026-11-19T14:00:00.000Z');
const account = (remaining: number, at: string): SearchApiAccount => ({
  remaining,
  monthlyAllowance: 0,
  periodEnd: asIsoDate('2026-12-01'),
  fetchedAt: asIsoDateTime(at),
});

function rig(answers: Array<SearchApiAccount | null | 'throws'>) {
  const clock = fixedClock(T0);
  let calls = 0;
  let ledgered = 0;
  let n = 0;
  const port = createSearchApiAccount({
    fetch: () => {
      calls += 1;
      const a = answers[Math.min(n++, answers.length - 1)];
      return a === 'throws' ? Promise.reject(new Error('boom')) : Promise.resolve(a ?? null);
    },
    clock,
    callsMade: () => ledgered,
  });
  return {
    clock,
    port,
    asked: () => calls,
    ledger: (v: number) => {
      ledgered = v;
    },
  };
}

describe('createSearchApiAccount', () => {
  it('asks once, then serves the cached balance for ten minutes', async () => {
    const r = rig([account(38, T0), account(30, T0)]);
    expect((await r.port.read())?.remaining).toBe(38);
    r.clock.advance(ACCOUNT_TTL_MS - 1);
    expect((await r.port.read())?.remaining).toBe(38);
    expect(r.asked()).toBe(1);
    r.clock.advance(1);
    expect((await r.port.read())?.remaining).toBe(30);
    expect(r.asked()).toBe(2);
  });

  it('shares one question between reads made while it is out', async () => {
    const r = rig([account(38, T0)]);
    const [a, b] = await Promise.all([r.port.read(), r.port.read()]);
    expect(a).toEqual(b);
    expect(r.asked()).toBe(1);
  });

  it('a run that called SearchApi ends: the next read asks again', async () => {
    const r = rig([account(38, T0), account(35, T0)]);
    await r.port.read();
    r.ledger(3); // the run's calls reached the ledger
    r.port.runEnded();
    expect((await r.port.read())?.remaining).toBe(35);
    expect(r.asked()).toBe(2);
  });

  it('a run that made no SearchApi call leaves the cache alone', async () => {
    const r = rig([account(38, T0), account(35, T0)]);
    r.ledger(3);
    await r.port.read();
    r.port.runEnded();
    expect((await r.port.read())?.remaining).toBe(38);
    expect(r.asked()).toBe(1);
  });

  it('a failure gives null and is not asked again for a minute, then is', async () => {
    const r = rig([null, 'throws', account(38, T0)]);
    expect(await r.port.read()).toBeNull();
    r.clock.advance(ACCOUNT_FAILURE_TTL_MS - 1);
    expect(await r.port.read()).toBeNull();
    expect(r.asked()).toBe(1);
    r.clock.advance(1);
    expect(await r.port.read()).toBeNull(); // a throw is a failure too
    r.clock.advance(ACCOUNT_FAILURE_TTL_MS);
    expect((await r.port.read())?.remaining).toBe(38);
  });

  it('a refresh that fails after a good read serves that read, with its own fetchedAt, for 24 hours', async () => {
    const r = rig([account(38, T0), null, 'throws']);
    expect((await r.port.read())?.remaining).toBe(38);
    r.clock.advance(ACCOUNT_TTL_MS);
    // the refresh fails: the last good read, still stamped with when it was read
    expect(await r.port.read()).toEqual(account(38, T0));
    r.clock.advance(ACCOUNT_FAILURE_TTL_MS);
    expect(await r.port.read()).toEqual(account(38, T0)); // a throw falls back alike
    expect(r.asked()).toBe(3);
  });

  it('a failed refresh serves a read made 24 hours ago, not one made longer ago', async () => {
    const r = rig([account(38, T0), null, null]);
    await r.port.read();
    r.clock.advance(ACCOUNT_STALE_MAX_MS); // exactly 24 h after fetchedAt
    expect(await r.port.read()).toEqual(account(38, T0));
    r.clock.advance(ACCOUNT_FAILURE_TTL_MS); // now past 24 h
    expect(await r.port.read()).toBeNull();
  });

  it('a run end drops the cache but not the last good read a failed refresh falls back on', async () => {
    const r = rig([account(38, T0), null]);
    await r.port.read();
    r.ledger(2);
    r.port.runEnded();
    expect(await r.port.read()).toEqual(account(38, T0));
  });

  it('a later good read replaces the one kept', async () => {
    const r = rig([account(38, T0), account(30, '2026-11-19T14:20:00.000Z'), null]);
    await r.port.read();
    r.clock.advance(ACCOUNT_TTL_MS);
    await r.port.read();
    r.clock.advance(ACCOUNT_TTL_MS);
    expect((await r.port.read())?.remaining).toBe(30);
  });

  it('without a key it answers null and asks nothing', async () => {
    const port = createSearchApiAccount({ fetch: null, clock: fixedClock(T0), callsMade: () => 0 });
    expect(await port.read()).toBeNull();
    port.runEnded();
  });

  it('close ends a question in flight and answers null after it', async () => {
    let seen: AbortSignal | undefined;
    const port = createSearchApiAccount({
      fetch: (signal) => {
        seen = signal;
        return new Promise(() => undefined);
      },
      clock: fixedClock(T0),
      callsMade: () => 0,
    });
    void port.read();
    port.close();
    expect(seen?.aborted).toBe(true);
    expect(await port.read()).toBeNull();
  });
});
