import { BANNED_WORD_ALLOWLIST, findBannedWords } from '@gmt/core';
import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { App } from '../../../src/App.js';
import type { ResultsResponse } from '../../../src/api/types.js';
import { COPY } from '../../../src/copy.js';
import { API, partialRow, resultsResponse, verifiedRow } from '../../fixtures.js';
import { server } from '../../msw/server.js';
import { renderWithProviders } from '../../render.js';

// Spec §11 URLs (WP19 Task 19.7): a `?view=results` URL without a valid date pair but with `row=` (an alert email sent
// before revision 48) opens the detail of that row's date pair when the row is among the definition's results (the
// whole-space `/results` read), else Dates with a line saying why.

const RESULTS = `${API}/definitions/:id/results`;

/** Answers the whole-space read with `whole` and a date-pair-scoped read with the default page, recording each. */
function serve(whole: ResultsResponse) {
  const requests: URL[] = [];
  server.use(
    http.get(RESULTS, ({ request }) => {
      const url = new URL(request.url);
      requests.push(url);
      return HttpResponse.json(url.searchParams.has('departureDate') ? resultsResponse() : whole);
    }),
  );
  return requests;
}

const lookups = (requests: URL[]) => requests.filter((u) => !u.searchParams.has('departureDate'));

describe('the row lookup of an old alert link (spec §11 URLs)', () => {
  it("a row found opens its date pair's detail with row= kept, rewriting the URL with replace", async () => {
    const requests = serve(resultsResponse({ rows: [verifiedRow(), partialRow()] }));
    const before = window.history.length;
    renderWithProviders(<App />, { search: '?view=results&def=def-0001&basis=verified&row=hash-partial-1' });
    await waitFor(() =>
      expect(window.location.search).toBe(
        '?view=results&def=def-0001&basis=verified&row=hash-partial-1&depart=2027-03-15&return=2027-03-27',
      ),
    );
    expect(window.history.length).toBe(before);
    expect(await screen.findByRole('table', { name: 'Round trips found' })).toBeInTheDocument();
    // the lookup read the whole space on the link's basis
    expect(lookups(requests).map((u) => u.searchParams.get('basis'))).toContain('verified');
    expect(
      requests.some(
        (u) =>
          u.searchParams.get('departureDate') === '2027-03-15' &&
          u.searchParams.get('returnDate') === '2027-03-27',
      ),
    ).toBe(true);
  });

  it("a row not found in an untruncated read opens Dates with the line saying it is no longer in this search's results", async () => {
    serve(resultsResponse({ rows: [verifiedRow()] }));
    renderWithProviders(<App />, { search: '?view=results&def=def-0001&basis=verified&row=hash-gone' });
    expect(await screen.findByText("That result is no longer in this search's results.")).toBeInTheDocument();
    expect(window.location.search).toBe('?view=dates&def=def-0001');
    expect(await screen.findByRole('table', { name: /^Best dates/ })).toBeInTheDocument();
  });

  it('a row not found in a truncated read says it is not among the first rows read', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) =>
      verifiedRow({ itineraryHash: `hash-${i}`, observationId: 1000 + i }),
    );
    serve(resultsResponse({ rows, total: 4210, truncated: true }));
    renderWithProviders(<App />, { search: '?view=results&def=def-0001&row=hash-gone' });
    expect(
      await screen.findByText('That result is not among the first 1000 results read for this search.'),
    ).toBeInTheDocument();
    expect(window.location.search).toBe('?view=dates&def=def-0001');
  });

  it('the line goes once the operator changes the URL', async () => {
    serve(resultsResponse({ rows: [verifiedRow()] }));
    const { user } = renderWithProviders(<App />, { search: '?view=results&def=def-0001&row=hash-gone' });
    await screen.findByText("That result is no longer in this search's results.");
    await user.click(screen.getByRole('link', { name: 'History' }));
    expect(screen.queryByText("That result is no longer in this search's results.")).toBeNull();
  });

  it('neither line holds a banned word', () => {
    for (const line of [COPY.landing.rowGone, COPY.landing.rowNotRead(1000)])
      expect(findBannedWords(line, BANNED_WORD_ALLOWLIST)).toEqual([]);
  });
});
