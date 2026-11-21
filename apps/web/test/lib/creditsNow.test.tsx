import { asIsoDateTime, isoDateTimeOfEpochMs, type SearchApiAccount } from '@gmt/core';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { accountCreditsLine, useCreditsNow } from '../../src/lib/searchApiCreditsLine.js';
import { NowContext } from '../../src/now.js';

// Settings plan ruling 10 (CodeRabbit, PR #64): a balance read older than ten minutes always shows its read time. A
// refresh that fails is answered with the same read, so no new data redraws the line: the hook redraws it once the read
// turns ten minutes old, on the page's clock.

const READ_AT = '2026-11-19T14:05:00.000Z';
const readAt = Date.parse(READ_AT);
const account: SearchApiAccount = {
  remaining: 38,
  monthlyAllowance: 0,
  periodEnd: null,
  fetchedAt: asIsoDateTime(READ_AT),
};

function Line() {
  const nowMs = useCreditsNow(account);
  return <p>{accountCreditsLine(account, nowMs).line}</p>;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('useCreditsNow', () => {
  it('redraws the line when the read turns ten minutes old, adding its read time', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let nowMs = readAt + 540_000; // nine minutes after the read
    render(
      <NowContext.Provider value={() => isoDateTimeOfEpochMs(nowMs)}>
        <Line />
      </NowContext.Provider>,
    );
    expect(screen.getByText('SearchApi: 38 credits left')).toBeInTheDocument();
    nowMs = readAt + 600_001;
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('SearchApi: 38 credits left')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText('SearchApi: 38 credits left · as of 14:05')).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sets no timer for a read already older than ten minutes', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    render(
      <NowContext.Provider value={() => isoDateTimeOfEpochMs(readAt + 600_001)}>
        <Line />
      </NowContext.Provider>,
    );
    expect(screen.getByText('SearchApi: 38 credits left · as of 14:05')).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });
});
