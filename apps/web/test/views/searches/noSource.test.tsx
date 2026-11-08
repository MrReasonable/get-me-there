import { act, screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../../src/App.js';
import { ESTIMATE_DEBOUNCE_MS } from '../../../src/api/queries.js';
import { PLAN_COPY } from '../../../src/copy/plan.js';
import { REFUSED_COPY } from '../../../src/copy/refused.js';
import { API, definition, estimate, estimateResponse, providersResponse } from '../../fixtures.js';
import { serveDates } from '../../msw/datesHandlers.js';
import { serveCards } from '../../msw/searchesHandlers.js';
import { server } from '../../msw/server.js';
import { renderWithProviders } from '../../render.js';
import { addAirport, pickDate } from './formSupport.js';
import { airportRows } from './support.js';

// Review Focus 1 end to end (WP20 Task 20.5, fix round 1 finding 13): an install with no price source at all. The
// first screen's form is filled and Search now pressed; the search is saved and its start refused `disabled`, and the
// new search's page opens with "No price source is set up, so nothing was searched" and the fix "Set up a price source
// (Providers)", never engine text and never a blank board. Through the App and msw, on Vitest's fake clock.

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const NO_SOURCES = { discovery: [], verification: [], discoveryRefreshHours: {} };

describe('Search now with no price source set up (Review Focus 1)', () => {
  it('saves the search, is refused disabled, and the page says so with the Providers fix', async () => {
    const creates: unknown[] = [];
    const saved = definition({ id: 'def-0002', providers: NO_SOURCES, scheduleCron: null, enabled: false });
    server.use(
      airportRows(),
      http.get(`${API}/providers`, () =>
        HttpResponse.json(
          providersResponse({
            providers: [],
            presets: { ...providersResponse().presets, providers: NO_SOURCES },
          }),
        ),
      ),
      serveCards([]),
      // the estimate of a search naming no source: nothing to ask, nothing spent
      http.post(`${API}/definitions/estimate`, () =>
        HttpResponse.json(
          estimateResponse({
            estimate: estimate({
              perProvider: [],
              totalCalls: 0,
              totalPlanCalls: 0,
              totalCostMicroGbp: 0,
              totalCostPence: 0,
              seconds: 0,
            }),
            datePairs: 405,
            datePairsCovered: 0,
          }),
        ),
      ),
      http.post(`${API}/definitions/create-and-start`, async ({ request }) => {
        creates.push(await request.json());
        return HttpResponse.json(
          {
            definition: saved,
            executionId: null,
            refusal: { code: 'disabled', estimatePence: null, totalCalls: null, resetsAt: null },
          },
          { status: 201 },
        );
      }),
      // once saved, the search is listed and its page reads it, never run
      http.get(`${API}/definitions`, () => HttpResponse.json(creates.length === 0 ? [] : [saved])),
      serveDates({ executions: [], executionId: null }),
    );
    // why: fake the clear functions too, or a cleared debounce timer still fires on the real clock
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    vi.stubGlobal('jest', { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) });
    const { user } = renderWithProviders(<App />, { search: '?view=searches', fakeTimers: true });
    await vi.waitFor(() =>
      expect(screen.getByRole('combobox', { name: PLAN_COPY.from })).toBeInTheDocument(),
    );
    await addAirport(user, PLAN_COPY.from, 'BHX');
    await addAirport(user, PLAN_COPY.to, 'FRA');
    pickDate(PLAN_COPY.earliest, '2027-01-10');
    pickDate(PLAN_COPY.latest, '2027-03-31');
    await act(() => vi.advanceTimersByTimeAsync(ESTIMATE_DEBOUNCE_MS));
    const press = screen.getByRole('button', { name: /^Search now/ });
    await vi.waitFor(() => expect(press).not.toHaveAttribute('aria-disabled'));
    await user.click(press);
    await vi.waitFor(() => expect(creates).toHaveLength(1));
    // the search is saved with no source, as the presets gave it
    expect(creates[0]).toMatchObject({ providers: { discovery: [] }, scheduleCron: null, enabled: false });
    const words = await vi.waitFor(() => screen.getByText(REFUSED_COPY.disabled));
    const block = words.closest<HTMLElement>('[role="alert"]');
    if (block === null) throw new Error('the refusal is said in an alert');
    const fix = within(block).getByRole('link', { name: REFUSED_COPY.disabledFix });
    expect(fix.getAttribute('href')).toContain('view=providers');
    expect(new URLSearchParams(window.location.search).get('refused')).toBe('disabled');
    expect(document.body.textContent ?? '').not.toMatch(/no runnable|engine|undefined/i);
  });
});
