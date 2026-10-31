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

/** The airports of the worked examples (Birmingham → Frankfurt), served for `GET /api/airports?q=<code>` by code. */
export const BHX_FRA = apiContract.airportsResponseSchema.parse([
  {
    iata: 'BHX',
    name: 'Birmingham Airport',
    city: 'Birmingham',
    country: 'GB',
    tz: 'Europe/London',
    metro: null,
  },
  {
    iata: 'FRA',
    name: 'Frankfurt Airport',
    city: 'Frankfurt',
    country: 'DE',
    tz: 'Europe/Berlin',
    metro: null,
  },
]);

/** Answers an airports lookup with the rows whose code is the query. */
export function airportRows(rows = BHX_FRA) {
  return http.get(`${API}/airports`, ({ request }) => {
    const q = new URL(request.url).searchParams.get('q');
    return HttpResponse.json(rows.filter((a) => a.iata === q));
  });
}
