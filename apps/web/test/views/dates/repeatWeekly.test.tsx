import { DEFAULT_CRON } from '@gmt/core';
import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { SETUP_COPY } from '../../../src/copy/setup.js';
import { COPY } from '../../../src/copy.js';
import { DatesView } from '../../../src/views/Dates/DatesView.js';
import { RepeatWeekly } from '../../../src/views/Dates/RepeatWeekly.js';
import { API, definition, estimate, estimateResponse, execution } from '../../fixtures.js';
import { server } from '../../msw/server.js';
import { renderWithProviders, settled } from '../../render.js';

// Spec rev 55 §8.2, §11 "Repeat weekly…" (WP20 Task 20.5; rulings A13, 20.0 concern 6): the schedule fields open with
// the stored cron (else DEFAULT_CRON) in the search's time zone, beside the estimate sentence and the monthly figure,
// and send nothing until Save; Save registers the schedule and stores the sentence's shown runnable totals as its
// confirmation (`confirmShown: true`); "Stop repeating" turns scheduled runs off.

const W = COPY.repeatWeekly;

/** An estimate whose runnable line costs 120p over 300 calls, and a 200p line a cap blocks today. */
const blocked = () =>
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
        {
          providerId: 'searchapi',
          stage: 'verification',
          calls: 40,
          planCalls: 40,
          costMicroGbp: 2_000_000,
          costPence: 200,
          seconds: 600,
          blocked: 'provider-month',
        },
      ],
      totalCalls: 300,
      totalCostMicroGbp: 1_200_000,
      totalCostPence: 120,
      seconds: 10_800,
    }),
    budgetFit: {
      fits: true,
      runsPerMonth: 4.33,
      perScope: [{ scope: 'provider-month:camoufox', estimated: 476, cap: 1500, fits: true }],
    },
    datePairs: 405,
    datePairsCovered: 300,
  });

/** Records every estimate body and PUT body; `put` answers each PUT. */
function serve(put: (body: unknown) => Response = () => HttpResponse.json(definition())) {
  const estimates: unknown[] = [];
  const puts: unknown[] = [];
  server.use(
    http.post(`${API}/definitions/estimate`, async ({ request }) => {
      estimates.push(await request.json());
      return HttpResponse.json(blocked());
    }),
    http.put(`${API}/definitions/:id`, async ({ request }) => {
      const body = await request.json();
      puts.push(body);
      return put(body);
    }),
  );
  return { estimates, puts };
}

const unscheduled = () => definition({ scheduleCron: null, enabled: false });

describe('Repeat weekly… (spec rev 55 §8.2, §11)', () => {
  it('opens the schedule fields with DEFAULT_CRON in the search’s zone, the estimate sentence and the monthly figure, and sends no PUT', async () => {
    const seen = serve();
    const { user, client } = renderWithProviders(<RepeatWeekly definition={unscheduled()} />);
    await user.click(screen.getByRole('button', { name: W.open }));
    expect(screen.getByLabelText(SETUP_COPY.schedule.repeat)).toHaveValue('weekly');
    expect(screen.getByLabelText(SETUP_COPY.schedule.time)).toHaveValue('05:00');
    expect(screen.getByRole('checkbox', { name: 'Mon' })).toBeChecked();
    expect(screen.getByText('Mondays at 05:00 (Europe/London)')).toBeInTheDocument();
    expect(
      await screen.findByText(
        'About 3 hours · about £1.20 · asks about 300 of 405 date pairs this run, the rest next Monday',
      ),
    ).toBeInTheDocument();
    // the monthly figure: the budget fit at the schedule's runs a month (flight pages join it in Task 20.9)
    expect(screen.getByText('provider-month:camoufox: 476 estimated a month, cap 1500')).toBeInTheDocument();
    expect(seen.estimates[0]).toMatchObject({ scheduleCron: DEFAULT_CRON });
    await settled(client);
    expect(seen.puts).toEqual([]);
  });

  it('opens with the stored cron when the search has one', async () => {
    serve();
    const { user } = renderWithProviders(
      <RepeatWeekly definition={definition({ scheduleCron: '30 6 * * 4', enabled: false })} />,
    );
    await user.click(screen.getByRole('button', { name: W.open }));
    expect(screen.getByLabelText(SETUP_COPY.schedule.time)).toHaveValue('06:30');
    expect(screen.getByRole('checkbox', { name: 'Thu' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Mon' })).not.toBeChecked();
  });

  it('Save PUTs the schedule, enabled and the sentence’s shown runnable totals with confirmShown (ruling A13)', async () => {
    const seen = serve(() => HttpResponse.json(definition({ confirmedCostPence: 120, confirmedCalls: 300 })));
    const { user } = renderWithProviders(<RepeatWeekly definition={unscheduled()} />);
    await user.click(screen.getByRole('button', { name: W.open }));
    const save = await screen.findByRole('button', { name: `${W.save} · about £1.20` });
    await user.click(save);
    await waitFor(() => expect(seen.puts).toHaveLength(1));
    // why: the shown totals leave the blocked 200p line out; the worst case (320p, 340 calls) is never sent
    expect(seen.puts).toEqual([
      {
        scheduleCron: DEFAULT_CRON,
        enabled: true,
        confirmedCostPence: 120,
        confirmedCalls: 300,
        confirmShown: true,
      },
    ]);
    expect(await screen.findByRole('status')).toHaveTextContent(W.saved);
  });

  it('Save keeping the stored cron sends only enabled and the confirmation', async () => {
    const seen = serve();
    const { user } = renderWithProviders(
      <RepeatWeekly definition={definition({ scheduleCron: DEFAULT_CRON, enabled: false })} />,
    );
    await user.click(screen.getByRole('button', { name: W.open }));
    await user.click(await screen.findByRole('button', { name: `${W.save} · about £1.20` }));
    await waitFor(() => expect(seen.puts).toHaveLength(1));
    expect(seen.puts[0]).toEqual({
      enabled: true,
      confirmedCostPence: 120,
      confirmedCalls: 300,
      confirmShown: true,
    });
  });

  it('a 422 monthly-fit refusal is said in words beside the fields, never the server’s', async () => {
    serve(() =>
      HttpResponse.json(
        {
          error: {
            code: 'schedule_over_budget',
            message: 'server text that must not show',
            details: { fields: [{ field: 'scheduleCron', message: 'server text that must not show' }] },
          },
        },
        { status: 422 },
      ),
    );
    const { user } = renderWithProviders(<RepeatWeekly definition={unscheduled()} />);
    await user.click(screen.getByRole('button', { name: W.open }));
    await user.click(await screen.findByRole('button', { name: `${W.save} · about £1.20` }));
    const fields = screen.getByRole('group', { name: W.fieldsLabel });
    expect(await within(fields).findByRole('alert')).toHaveTextContent(W.overBudget);
    expect(screen.queryByText(/server text that must not show/)).toBeNull();
  });

  it('a scheduled search reads "Repeats Mondays 05:00 · Change", and Stop repeating PUTs enabled false', async () => {
    const seen = serve(() => HttpResponse.json(definition({ enabled: false })));
    const { user } = renderWithProviders(<RepeatWeekly definition={definition()} />);
    expect(screen.getByText(W.repeats('Mondays', '05:00'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: W.change })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: W.stop }));
    await waitFor(() => expect(seen.puts).toEqual([{ enabled: false }]));
  });

  it('a search whose latest run is stopped shows no warning here: its first firing supersedes it (Task 20.2)', async () => {
    serve();
    server.use(
      http.get(`${API}/executions/:id`, () => HttpResponse.json(execution({ status: 'paused_budget' }))),
    );
    const { user } = renderWithProviders(<RepeatWeekly definition={unscheduled()} />);
    await user.click(screen.getByRole('button', { name: W.open }));
    await screen.findByRole('button', { name: `${W.save} · about £1.20` });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/stopped|paused/i)).toBeNull();
  });

  it('a search’s page carries it in its header', async () => {
    renderWithProviders(<DatesView definition={unscheduled()} />, { search: '?view=dates&def=def-0001' });
    expect(await screen.findByRole('button', { name: W.open })).toBeInTheDocument();
  });
});
