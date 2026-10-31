import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { COPY } from '../../../src/copy.js';
import { SearchAgainButton } from '../../../src/views/Dates/SearchAgainButton.js';
import { API, definition, execution } from '../../fixtures.js';
import { server } from '../../msw/server.js';
import { renderWithProviders, settled } from '../../render.js';

// Spec rev 55 §8.1, §11 (WP20 Task 20.3, the first press): Search again posts the stored confirmation with
// `requireCovered` and `replaceStopped`; the second-press flow (nothing stored yet) is Task 20.5's.

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
    ['confirm', COPY.searchAgain.refused.confirm],
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
});
