import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { COPY } from '../../../src/copy.js';
import { SearchAgainButton } from '../../../src/views/Dates/SearchAgainButton.js';
import { API, definition, estimate, estimateResponse, execution } from '../../fixtures.js';
import { server } from '../../msw/server.js';
import { renderWithProviders, settled } from '../../render.js';

// Spec rev 55 §8.1, §11 (WP20 Task 20.3, the first press): Search again posts the stored confirmation with
// `requireCovered` and `replaceStopped`. Task 20.5, the second press: when the server refuses `confirm`, the estimate
// sentence appears inline and a second press confirms that run with the shown figures, storing nothing (Ian's ruling 3).

const button = (name: string | RegExp = COPY.searchAgain.label) => screen.findByRole('button', { name });

/** Serves the definition with the given stored confirmation and records every start body. */
function serveStart(
  confirmed: { confirmedCostPence: number | null; confirmedCalls: number | null },
  answer: () => Response | Promise<Response> = () =>
    HttpResponse.json({ executionId: 'exec-2' }, { status: 202 }),
) {
  const bodies: unknown[] = [];
  server.use(
    http.get(`${API}/executions/:id`, () =>
      HttpResponse.json(execution({ id: 'exec-2', status: 'running' })),
    ),
    http.get(`${API}/definitions`, () => HttpResponse.json([definition(confirmed)])),
    http.post(`${API}/definitions/:id/executions`, async ({ request }) => {
      bodies.push(await request.json());
      return answer();
    }),
  );
  return bodies;
}

describe('SearchAgainButton, the first press (spec rev 55 §8.1)', () => {
  it('posts the stored pence and calls with requireCovered and replaceStopped; a free search starts on the first press', async () => {
    const bodies = serveStart({ confirmedCostPence: 0, confirmedCalls: 154 });
    const { user } = renderWithProviders(<SearchAgainButton definitionId="def-0001" />);
    const b = await button();
    await waitFor(() => expect(b).toBeEnabled());
    await user.click(b);
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies).toEqual([
      { confirmCostPence: 0, confirmCalls: 154, requireCovered: true, replaceStopped: true },
    ]);
    // a 202 says so, in words
    expect(await screen.findByRole('status')).toHaveTextContent(COPY.searchAgain.working);
  });

  it('a 202 invalidates the cards and the date pairs, so both are read again', async () => {
    serveStart({ confirmedCostPence: 0, confirmedCalls: 154 });
    const { user, client } = renderWithProviders(<SearchAgainButton definitionId="def-0001" />);
    client.setQueryData(['cards'], { cards: [] });
    client.setQueryData(['date-pairs', 'def-0001', '', '', ''], {});
    const b = await button();
    await waitFor(() => expect(b).toBeEnabled());
    await user.click(b);
    await screen.findByRole('status');
    expect(client.getQueryState(['cards'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['date-pairs', 'def-0001', '', '', ''])?.isInvalidated).toBe(true);
  });

  it('is disabled while the start is pending and cannot be double-tapped', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const bodies = serveStart({ confirmedCostPence: 0, confirmedCalls: 154 }, async () => {
      await gate;
      return HttpResponse.json({ executionId: 'exec-2' }, { status: 202 });
    });
    const { user, client } = renderWithProviders(<SearchAgainButton definitionId="def-0001" />);
    const b = await button();
    await waitFor(() => expect(b).toBeEnabled());
    await user.click(b);
    const working = await screen.findByRole('button', { name: COPY.searchAgain.working });
    expect(working).toBeDisabled();
    expect(working).toHaveAttribute('aria-busy', 'true');
    await user.click(working);
    release();
    await settled(client);
    expect(bodies).toHaveLength(1);
  });

  it('a 409 active reads "Already searching"', async () => {
    serveStart({ confirmedCostPence: 0, confirmedCalls: 154 }, () =>
      HttpResponse.json({ error: { code: 'active', message: 'a run is active' } }, { status: 409 }),
    );
    const { user } = renderWithProviders(<SearchAgainButton definitionId="def-0001" />);
    const b = await button();
    await waitFor(() => expect(b).toBeEnabled());
    await user.click(b);
    expect(await screen.findByRole('alert')).toHaveTextContent('Already searching');
    expect(screen.queryByText(/a run is active/)).toBeNull();
  });

  it.each<[string, string]>([
    ['cap', COPY.searchAgain.refused.cap],
    ['disabled', COPY.searchAgain.refused.disabled],
    ['window', COPY.searchAgain.refused.window],
  ])('a refusal %s is said in plain words, never the engine’s message', async (code, words) => {
    serveStart({ confirmedCostPence: 0, confirmedCalls: 154 }, () =>
      HttpResponse.json({ error: { code, message: 'engine text that must not show' } }, { status: 409 }),
    );
    const { user } = renderWithProviders(<SearchAgainButton definitionId="def-0001" />);
    const b = await button();
    await waitFor(() => expect(b).toBeEnabled());
    await user.click(b);
    expect(await screen.findByRole('alert')).toHaveTextContent(words);
    expect(screen.queryByText(/engine text that must not show/)).toBeNull();
  });

  it('an unknown failure says that it did not work, with the message', async () => {
    serveStart({ confirmedCostPence: 0, confirmedCalls: 154 }, () =>
      HttpResponse.json({ error: { code: 'internal', message: 'db is down' } }, { status: 500 }),
    );
    const { user } = renderWithProviders(<SearchAgainButton definitionId="def-0001" />);
    const b = await button();
    await waitFor(() => expect(b).toBeEnabled());
    await user.click(b);
    expect(await screen.findByRole('alert')).toHaveTextContent('That did not work: db is down');
  });

  it('with nothing stored it sends no figures, and the label can be "Search now"', async () => {
    const bodies = serveStart({ confirmedCostPence: null, confirmedCalls: null });
    const { user } = renderWithProviders(
      <SearchAgainButton definitionId="def-0001" label={COPY.searchAgain.searchNow} />,
    );
    const b = await button(COPY.searchAgain.searchNow);
    await waitFor(() => expect(b).toBeEnabled());
    await user.click(b);
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies).toEqual([{ requireCovered: true, replaceStopped: true }]);
  });

  it('is disabled until the search is known (its stored confirmation is not guessed)', async () => {
    server.use(http.get(`${API}/definitions`, () => new Promise<never>(() => undefined)));
    renderWithProviders(<SearchAgainButton definitionId="def-0001" />);
    expect(await button()).toBeDisabled();
  });

  it('"Searching…" clears once the started run is no longer pending or running', async () => {
    let status: 'running' | 'completed' = 'running';
    const bodies = serveStart({ confirmedCostPence: 0, confirmedCalls: 154 });
    server.use(
      http.get(`${API}/executions/:id`, () => HttpResponse.json(execution({ id: 'exec-2', status }))),
    );
    const { user, client } = renderWithProviders(<SearchAgainButton definitionId="def-0001" />);
    const b = await button();
    await waitFor(() => expect(b).toBeEnabled());
    await user.click(b);
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(await screen.findByRole('status')).toHaveTextContent(COPY.searchAgain.working);
    // the run ends; its next read (the run is polled while in flight, and the press invalidated it) says so
    status = 'completed';
    await client.invalidateQueries({ queryKey: ['execution'] });
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(screen.getByRole('button', { name: COPY.searchAgain.label })).toBeEnabled();
  });

  it('when the started run cannot be read, it says so with a retry instead of a permanent "Searching…"', async () => {
    let fail = true;
    const bodies = serveStart({ confirmedCostPence: 0, confirmedCalls: 154 });
    server.use(
      http.get(`${API}/executions/:id`, () =>
        fail
          ? HttpResponse.json({ error: { code: 'internal', message: 'db is down' } }, { status: 500 })
          : HttpResponse.json(execution({ id: 'exec-2', status: 'completed' })),
      ),
    );
    const { user } = renderWithProviders(<SearchAgainButton definitionId="def-0001" />);
    const b = await button();
    await waitFor(() => expect(b).toBeEnabled());
    await user.click(b);
    await waitFor(() => expect(bodies).toHaveLength(1));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The search started, but its progress could not be read: db is down');
    expect(screen.queryByRole('status')).toBeNull();
    fail = false;
    await user.click(within(alert).getByRole('button', { name: COPY.retryLoad }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.queryByRole('status')).toBeNull();
  });
});

/** A paid estimate: 300 SearchApi calls at 120p over 300 of 405 date pairs (the 409's figures below). */
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

/**
 * The second press (Task 20.5): the first start is refused `confirm` with the runnable figures, the estimate route
 * answers `paid()`, and a second start is accepted. Records every start body, every estimate asked and every PUT.
 */
function serveSecondPress(
  stored: { confirmedCostPence: number | null; confirmedCalls: number | null },
  cron: string | null = null,
) {
  const starts: unknown[] = [];
  const estimates: string[] = [];
  const estimateBodies: unknown[] = [];
  const puts: unknown[] = [];
  server.use(
    http.get(`${API}/executions/:id`, () =>
      HttpResponse.json(execution({ id: 'exec-2', status: 'running' })),
    ),
    http.get(`${API}/definitions`, () =>
      HttpResponse.json([definition({ ...stored, scheduleCron: cron, enabled: cron !== null })]),
    ),
    http.post(`${API}/definitions/:id/estimate`, async ({ params, request }) => {
      estimates.push(String(params.id));
      estimateBodies.push(await request.json());
      return HttpResponse.json(paid());
    }),
    http.put(`${API}/definitions/:id`, async ({ request }) => {
      puts.push(await request.json());
      return HttpResponse.json(definition());
    }),
    http.post(`${API}/definitions/:id/executions`, async ({ request }) => {
      starts.push(await request.json());
      return starts.length === 1
        ? HttpResponse.json(
            {
              error: {
                code: 'confirm',
                message: 'engine text that must not show',
                details: { estimatePence: 120, totalCalls: 300 },
              },
            },
            { status: 409 },
          )
        : HttpResponse.json({ executionId: 'exec-2' }, { status: 202 });
    }),
  );
  return { starts, estimates, estimateBodies, puts };
}

describe('SearchAgainButton, the second press (spec rev 55 §11; ruling A10; Ian’s ruling 3)', () => {
  it('a 409 confirm shows the estimate sentence inline, relabels the button with the cost, and the second press confirms that run only', async () => {
    const seen = serveSecondPress({ confirmedCostPence: 0, confirmedCalls: 154 });
    const { user, client } = renderWithProviders(<SearchAgainButton definitionId="def-0001" />);
    const first = await button();
    await waitFor(() => expect(first).toBeEnabled());
    await user.click(first);
    const second = await button('Search again · about £1.20');
    expect(seen.estimates).toEqual(['def-0001']);
    // why: ruling R2 — the search is estimated as itself, with its own fields as the body
    expect(seen.estimateBodies[0]).toMatchObject({ origins: ['LHR', 'LGW'], destinations: ['JFK', 'EWR'] });
    expect(seen.estimateBodies[0]).not.toHaveProperty('confirmedCostPence');
    expect(
      screen.getByText(
        'About 3 hours · about £1.20 · asks about 300 of 405 date pairs this run, the rest when you search again',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/engine text that must not show/)).toBeNull();
    await user.click(second);
    await waitFor(() => expect(seen.starts).toHaveLength(2));
    expect(seen.starts[1]).toEqual({
      confirmCostPence: 120,
      confirmCalls: 300,
      requireCovered: true,
      replaceStopped: true,
    });
    expect(await screen.findByRole('status')).toHaveTextContent(COPY.searchAgain.working);
    // why: a confirmation covers that run only, so the second press stores no standing confirmation
    await settled(client);
    expect(seen.puts).toEqual([]);
  });

  it('a search with nothing stored sends no figures first, then confirms the shown ones on the second press (ruling A10)', async () => {
    const seen = serveSecondPress({ confirmedCostPence: null, confirmedCalls: null });
    const { user } = renderWithProviders(<SearchAgainButton definitionId="def-0001" />);
    const first = await button();
    await waitFor(() => expect(first).toBeEnabled());
    await user.click(first);
    await user.click(await button('Search again · about £1.20'));
    await waitFor(() => expect(seen.starts).toHaveLength(2));
    expect(seen.starts).toEqual([
      { requireCovered: true, replaceStopped: true },
      { confirmCostPence: 120, confirmCalls: 300, requireCovered: true, replaceStopped: true },
    ]);
  });

  it('the sentence’s "the rest …" clause follows the schedule', async () => {
    serveSecondPress({ confirmedCostPence: 0, confirmedCalls: 154 }, '0 5 * * 1');
    const { user } = renderWithProviders(<SearchAgainButton definitionId="def-0001" />);
    const first = await button();
    await waitFor(() => expect(first).toBeEnabled());
    await user.click(first);
    await button('Search again · about £1.20');
    expect(
      screen.getByText(
        'About 3 hours · about £1.20 · asks about 300 of 405 date pairs this run, the rest next Monday',
      ),
    ).toBeInTheDocument();
  });

  it('while the estimate is being asked again the button waits, in words, and a press sends nothing', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seen = serveSecondPress({ confirmedCostPence: 0, confirmedCalls: 154 });
    server.use(
      http.post(`${API}/definitions/:id/estimate`, async () => {
        await gate;
        return HttpResponse.json(paid());
      }),
    );
    const { user, client } = renderWithProviders(<SearchAgainButton definitionId="def-0001" />);
    const first = await button();
    await waitFor(() => expect(first).toBeEnabled());
    await user.click(first);
    const waiting = await screen.findByRole('button', {
      name: COPY.searchAgain.label,
      description: COPY.newSearch.working,
    });
    expect(waiting).toHaveAttribute('aria-disabled', 'true');
    await user.click(waiting);
    // why: the estimate is held, so the client is never idle here; a start the press began would be a mutation now
    expect(client.isMutating()).toBe(0);
    expect(seen.starts).toHaveLength(1);
    release();
    await button('Search again · about £1.20');
  });

  it('confirmFirst (a refused Search now’s page) asks the estimate at once and starts nothing until pressed', async () => {
    const seen = serveSecondPress({ confirmedCostPence: null, confirmedCalls: null });
    const { client } = renderWithProviders(<SearchAgainButton definitionId="def-0001" confirmFirst />);
    await button('Search again · about £1.20');
    await settled(client);
    expect(seen.estimates).toEqual(['def-0001']);
    expect(seen.starts).toEqual([]);
  });
});
