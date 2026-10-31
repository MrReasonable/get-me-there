import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ESTIMATE_DEBOUNCE_MS, qk } from '../../../src/api/queries.js';
import { PLAN_COPY } from '../../../src/copy/plan.js';
import { COPY } from '../../../src/copy.js';
import { readLastSearch } from '../../../src/state/lastSearch.js';
import { DatesView } from '../../../src/views/Dates/DatesView.js';
import { API, definition, estimate, estimateResponse } from '../../fixtures.js';
import { serveDates } from '../../msw/datesHandlers.js';
import { server } from '../../msw/server.js';
import { renderWithProviders } from '../../render.js';
import { fill, holdEstimates, renderForm, searchNow, step } from './formSupport.js';

// Spec rev 55 §11 "The press is the confirmation" (WP20 Task 20.5), design §4.4, Review Focus 1: one press of Search
// now saves the search and starts its run with exactly the figures beside the button, then opens that search's page;
// a refused start keeps the saved search and opens its page with the refusal in words (ruling A24: this task words them).

const R = COPY.refusedPage;

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A paid estimate: 300 SearchApi calls at 120p, over 300 of 405 date pairs. */
const paid = () =>
  estimateResponse({
    estimate: estimate({
      perProvider: [
        {
          providerId: 'searchapi',
          stage: 'discovery',
          calls: 300,
          planCalls: 300,
          costMicroGbp: 1_200_000,
          costPence: 120,
          seconds: 10_800,
          blocked: null,
        },
      ],
      totalCalls: 300,
      totalCostMicroGbp: 1_200_000,
      totalCostPence: 120,
      seconds: 10_800,
    }),
    datePairs: 405,
    datePairsCovered: 300,
  });

/** A recorded body's request key, read without a cast. */
const keyOf = (body: unknown): unknown =>
  typeof body === 'object' && body !== null && 'requestKey' in body ? body.requestKey : undefined;

/** Answers every create-and-start with `answer(body)`, recording each body; the default starts run exec-9 of def-0002. */
function serveCreate(
  answer: (body: unknown) => Response | Promise<Response> = () =>
    HttpResponse.json(
      { definition: definition({ id: 'def-0002' }), executionId: 'exec-9', refusal: null },
      { status: 201 },
    ),
) {
  const bodies: unknown[] = [];
  server.use(
    http.post(`${API}/definitions/create-and-start`, async ({ request }) => {
      const body = await request.json();
      bodies.push(body);
      return answer(body);
    }),
  );
  return bodies;
}

/** The form filled in with its estimate shown, ready to press. */
async function ready(estimateBody = paid()) {
  const held = holdEstimates(() => HttpResponse.json(estimateBody));
  held.release();
  const r = renderForm();
  await fill(r.user);
  await step(ESTIMATE_DEBOUNCE_MS);
  await waitFor(() => expect(searchNow()).not.toHaveAttribute('aria-disabled'));
  return r;
}

const refused = (code: string, over: Record<string, unknown> = {}) =>
  HttpResponse.json(
    {
      definition: definition({ id: 'def-0002' }),
      executionId: null,
      refusal: { code, estimatePence: null, totalCalls: null, resetsAt: null, ...over },
    },
    { status: 201 },
  );

describe('Search now: the press (spec rev 55 §11)', () => {
  it('posts the form, the sentence’s figures, a fresh request key and no schedule, then opens the search’s page', async () => {
    const bodies = serveCreate();
    const { user } = await ready();
    const pushes = vi.spyOn(window.history, 'pushState');
    await user.click(screen.getByRole('button', { name: 'Search now · about £1.20' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({
      origins: ['BHX'],
      destinations: ['FRA'],
      window: { kind: 'absolute', from: '2027-01-10', to: '2027-03-31' },
      confirmCostPence: 120,
      confirmCalls: 300,
      scheduleCron: null,
      enabled: false,
    });
    const key = keyOf(bodies[0]);
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(bodies[0]).not.toHaveProperty('confirmedCostPence');
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('def')).toBe('def-0002'));
    const params = new URLSearchParams(window.location.search);
    expect(params.get('view')).toBe('dates');
    expect(params.get('refused')).toBeNull();
    expect(pushes).toHaveBeenCalled();
    expect(readLastSearch()).toBe('def-0002');
  });

  it('is disabled while the request is pending, so a double press sends one request; each press has its own key', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const bodies = serveCreate(async () => {
      await gate;
      return HttpResponse.json({ error: { code: 'internal', message: 'db is down' } }, { status: 500 });
    });
    const { user } = await ready();
    await user.click(screen.getByRole('button', { name: /^Search now/ }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    const pending = screen.getByRole('button', { name: COPY.working });
    expect(pending).toBeDisabled();
    await user.click(pending);
    release();
    expect(await screen.findByText(/Couldn't save the search/)).toBeInTheDocument();
    expect(bodies).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: /^Search now/ }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    const keys = bodies.map(keyOf);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it.each(['disabled', 'confirm', 'cap', 'window', 'shutting-down', 'failed'])(
    'a refused start (%s) keeps the saved search and opens its page with refused=<code>',
    async (code) => {
      serveCreate(() => refused(code));
      const { user } = await ready();
      await user.click(screen.getByRole('button', { name: /^Search now/ }));
      await waitFor(() => expect(new URLSearchParams(window.location.search).get('refused')).toBe(code));
      const params = new URLSearchParams(window.location.search);
      expect(params.get('view')).toBe('dates');
      expect(params.get('def')).toBe('def-0002');
    },
  );

  it('a 422 keeps the form with its field errors and opens nothing', async () => {
    serveCreate(() =>
      HttpResponse.json(
        {
          error: {
            code: 'invalid_definition',
            message: 'x',
            details: { fields: [{ field: 'maxNights', message: 'maxNights must be at least minNights' }] },
          },
        },
        { status: 422 },
      ),
    );
    const { user } = await ready();
    await user.click(screen.getByRole('button', { name: /^Search now/ }));
    expect(await screen.findByText('maxNights: maxNights must be at least minNights')).toBeInTheDocument();
    expect(screen.getByLabelText(PLAN_COPY.longest)).toHaveAttribute('aria-invalid', 'true');
    expect(new URLSearchParams(window.location.search).get('view')).toBeNull();
  });

  it('a 500 says "Couldn’t save the search" beside the button', async () => {
    serveCreate(() =>
      HttpResponse.json({ error: { code: 'internal', message: 'db is down' } }, { status: 500 }),
    );
    const { user } = await ready();
    await user.click(screen.getByRole('button', { name: /^Search now/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save the search: db is down");
  });
});

/** The search a Search now press saved: no schedule (spec rev 55 §8.2). */
const newSearch = () => definition({ id: 'def-0002', scheduleCron: null, enabled: false });

/** The refusal's block on the page, found by its words (the page may also carry the red synthetic banner). */
async function block(words: string): Promise<HTMLElement> {
  const el = (await screen.findByText(words)).closest<HTMLElement>('[role="alert"]');
  if (el === null) throw new Error(`"${words}" is not in an alert`);
  return el;
}

/** The new search's page, opened from a refused Search now: never run, its definition def-0002. */
function renderRefused(code: string) {
  server.use(serveDates({ executions: [], executionId: null }));
  return renderWithProviders(<DatesView definition={newSearch()} />, {
    search: `?view=dates&def=def-0002&refused=${code}`,
  });
}

describe('the page’s words for a refused Search now (spec rev 55 §11; Review Focus 1; ruling A24)', () => {
  it('disabled: "No price source is set up, so nothing was searched" with "Set up a price source (Providers)"', async () => {
    renderRefused('disabled');
    const fix = within(await block(R.disabled)).getByRole('link', { name: R.disabledFix });
    expect(fix.getAttribute('href')).toContain('view=providers');
  });

  it('confirm: the estimate is asked again and its sentence shown inline with "Search again · about £X", which sends its figures', async () => {
    const asked: string[] = [];
    const starts: unknown[] = [];
    server.use(
      http.post(`${API}/definitions/:id/estimate`, ({ params }) => {
        asked.push(String(params.id));
        return HttpResponse.json(paid());
      }),
      http.post(`${API}/definitions/:id/executions`, async ({ request, params }) => {
        starts.push({ id: params.id, body: await request.json() });
        return HttpResponse.json({ executionId: 'exec-9' }, { status: 202 });
      }),
      http.get(`${API}/definitions`, () => HttpResponse.json([newSearch()])),
    );
    const { user } = renderRefused('confirm');
    const again = await screen.findByRole('button', { name: 'Search again · about £1.20' });
    expect(asked).toEqual(['def-0002']);
    expect(
      screen.getByText(
        'About 3 hours · about £1.20 · asks about 300 of 405 date pairs this run, the rest when you search again',
      ),
    ).toBeInTheDocument();
    await user.click(again);
    await waitFor(() => expect(starts).toHaveLength(1));
    expect(starts[0]).toEqual({
      id: 'def-0002',
      body: { confirmCostPence: 120, confirmCalls: 300, requireCovered: true, replaceStopped: true },
    });
  });

  it('cap: "This month’s limit is used up; it resets on <date>", from the refusal the press answered', async () => {
    const { client } = renderRefused('cap');
    client.setQueryData(qk.refusal('def-0002'), {
      code: 'cap',
      estimatePence: null,
      totalCalls: null,
      resetsAt: '2026-11-01T00:00:00.000Z',
    });
    expect(await screen.findByText(R.capResets('1 Nov 2026'))).toBeInTheDocument();
  });

  it('cap with no reset known (a reload, or a limit of the search’s own) says a limit stops it, with Edit', async () => {
    renderRefused('cap');
    expect(
      within(await block(R.cap))
        .getByRole('link', { name: R.edit })
        .getAttribute('href'),
    ).toContain('edit=def-0002');
  });

  it('window: "Nothing to search: the dates have passed" with Edit', async () => {
    renderRefused('window');
    expect(
      within(await block(R.window))
        .getByRole('link', { name: R.edit })
        .getAttribute('href'),
    ).toContain('view=definitions');
  });

  it('shutting-down: "The app is restarting; try again in a moment"', async () => {
    renderRefused('shutting-down');
    expect(await block(R['shutting-down'])).toBeInTheDocument();
  });

  it('failed: "The search was saved but could not start" with Search again', async () => {
    renderRefused('failed');
    expect(
      within(await block(R.failed)).getByRole('button', { name: COPY.searchAgain.label }),
    ).toBeInTheDocument();
    // why: the never-run state's own Search now gives way to the refusal's, so one button starts the run
    expect(screen.queryByRole('button', { name: COPY.searchAgain.searchNow })).toBeNull();
  });

  it('an unknown refused= value is ignored, never an error (spec §11 URLs)', async () => {
    renderRefused('nonsense');
    expect(await screen.findByText(COPY.datesView.neverRun)).toBeInTheDocument();
    for (const words of [R.disabled, R.cap, R.window, R['shutting-down'], R.failed, R.confirm])
      expect(screen.queryByText(words)).toBeNull();
  });
});
