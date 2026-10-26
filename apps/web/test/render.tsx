import { asIsoDateTime, type IsoDateTime, type Provenance } from '@gmt/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { vi } from 'vitest';
import { NowContext } from '../src/now.js';

/** The fixed "now" of every web test; fixtures are dated relative to it. */
export const NOW: IsoDateTime = asIsoDateTime('2026-10-14T15:00:00.000Z');

/**
 * Renders with a fresh QueryClient (no retries), a fixed clock and the given search string. With
 * `fakeTimers`, user-event advances Vitest's fake clock, so a debounce is stepped explicitly.
 */
export function renderWithProviders(ui: ReactElement, opts: { search?: string; fakeTimers?: boolean } = {}) {
  window.history.replaceState(null, '', `/${opts.search ?? ''}`);
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  });
  const user =
    opts.fakeTimers === true ? userEvent.setup({ advanceTimers: vi.advanceTimersByTime }) : userEvent.setup();
  const result = render(
    <QueryClientProvider client={client}>
      <NowContext.Provider value={() => NOW}>{ui}</NowContext.Provider>
    </QueryClientProvider>,
  );
  return { ...result, user, client };
}

/**
 * Waits until no query or mutation is in flight, then one more macrotask, so a negative request-count
 * assertion runs after any request the last event could have caused (review tsr2-002).
 */
export async function settled(client: QueryClient): Promise<void> {
  await waitFor(() => {
    if (client.isFetching() + client.isMutating() > 0) throw new Error('requests in flight');
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * A provenance in wire form (plain strings). core types `provenanceSchema` as `z.ZodType<Provenance>`,
 * whose input is unknown, so the shape is spelled out here; the schema still validates every use.
 */
export type ProvenanceInput = Omit<Provenance, 'fetchedAt' | 'providerObservedAt' | 'fx'> & {
  fetchedAt: string;
  providerObservedAt?: string;
  fx: { converted: false } | { converted: true; rateNano: number; rateDate: string; source: string };
};

/**
 * The Recharts surface (the chart's `svg[role="application"]`) inside `figure`, once it has drawn `selector` (the surface
 * itself by default). why: ResponsiveContainer draws nothing until an effect has measured its box, and the chart's
 * axes and lines come in later renders, so a figure found by role may not hold its chart yet (a History test read the
 * surface before it existed under load). waitFor re-checks on every DOM mutation, so this returns as soon as the chart
 * has drawn it, with no fixed sleep.
 */
export async function drawn(figure: Element, selector = 'svg[role="application"]'): Promise<Element> {
  return waitFor(() => {
    const el = figure.querySelector(selector);
    if (el === null) throw new Error(`the chart has not drawn ${selector} yet`);
    return el;
  });
}

/** The text of the chart surface inside `figure` once it has drawn every one of `texts` (its axis titles, ticks). */
export async function drawnText(figure: Element, ...texts: string[]): Promise<string> {
  return waitFor(() => {
    const text = figure.querySelector('svg[role="application"]')?.textContent ?? '';
    for (const t of texts) if (!text.includes(t)) throw new Error(`the chart has not drawn "${t}" yet`);
    return text;
  });
}
