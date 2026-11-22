import { apiContract } from '@gmt/core';
import { HttpResponse, http } from 'msw';
import type { ReactElement, ReactNode } from 'react';
import { useProviders } from '../../../src/api/queries.js';
import { API } from '../../fixtures.js';
import { renderWithProviders } from '../../render.js';

/** Stands in for the shell, which owns the one active /providers read the views only watch (see useProvidersWatch). */
function Shell({ children }: { children: ReactNode }) {
  useProviders();
  return children;
}

/** Renders a Searches-view element inside the shell's /providers read. */
export function renderInShell(ui: ReactElement, opts: { search?: string; fakeTimers?: boolean } = {}) {
  return renderWithProviders(<Shell>{ui}</Shell>, opts);
}

/** The London → New York example's airports (Heathrow → JFK), served for `GET /api/airports?q=<code>` by code. */
export const LHR_JFK = apiContract.airportsResponseSchema.parse([
  {
    iata: 'LHR',
    name: 'Heathrow',
    city: 'London',
    country: 'GB',
    tz: 'Europe/London',
    metro: 'LON',
  },
  {
    iata: 'JFK',
    name: 'John F. Kennedy International Airport',
    city: 'New York',
    country: 'US',
    tz: 'America/New_York',
    metro: 'NYC',
  },
]);

/** Answers an airports lookup with the rows whose code is the query. */
export function airportRows(rows = LHR_JFK) {
  return http.get(`${API}/airports`, ({ request }) => {
    const q = new URL(request.url).searchParams.get('q');
    return HttpResponse.json(rows.filter((a) => a.iata === q));
  });
}
