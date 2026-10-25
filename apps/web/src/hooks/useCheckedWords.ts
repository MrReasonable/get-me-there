import { useEffect, useState } from 'react';
import { COPY } from '../copy.js';
import { useNow } from '../now.js';

/** How often the "checked N s ago" words are redrawn between refreshes. */
const TICK_MS = 10_000;

/** Whole seconds since the report was generated, never negative. */
export function checkedSeconds(generatedAt: string, now: string): number {
  return Math.max(0, Math.floor((Date.parse(now) - Date.parse(generatedAt)) / 1000));
}

/** The "checked N s ago" words of a report, redrawn on a timer so they never freeze between refreshes. */
export function useCheckedWords(generatedAt: string | null): string | null {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => clearInterval(id);
  }, []);
  const now = useNow();
  return generatedAt === null ? null : COPY.statusView.checkedAgo(checkedSeconds(generatedAt, now));
}
