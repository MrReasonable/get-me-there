// The Definitions form after the set-up polish pass: plain labels with their hints, the schedule picker, journey time in
// hours and minutes, the 0-billed-calls explanation and the run time beside the estimate. The worked example only.
import { CONSTRAINT_LABELS } from '@gmt/core';
import { screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { PLAN_COPY } from '../../../src/copy/plan.js';
import { SETUP_COPY } from '../../../src/copy/setup.js';
import { COPY } from '../../../src/copy.js';
import { DefinitionForm } from '../../../src/views/Definitions/DefinitionForm.js';
import { BudgetFitPanel, EstimatePanel } from '../../../src/views/Definitions/EstimatePanel.js';
import { API, definition, estimate, providersResponse } from '../../fixtures.js';
import { server } from '../../msw/server.js';
import { renderWithProviders } from '../../render.js';

const D = SETUP_COPY.definitions;
const S = SETUP_COPY.schedule;

function zeroCallPresets() {
  const base = providersResponse();
  return { ...base, presets: { ...base.presets, budget: { ...base.presets.budget, maxCalls: 0 } } };
}

const renderForm = (providers = providersResponse()) =>
  renderWithProviders(<DefinitionForm existing={null} providers={providers} />);

/** The bodies POSTed to the estimate route, in order. */
function estimateBodies() {
  const bodies: unknown[] = [];
  server.use(
    http.post(`${API}/definitions/estimate`, async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json({ estimate: estimate(), budgetFit: definition().budgetFit });
    }),
  );
  return bodies;
}

async function openAdvanced(user: ReturnType<typeof renderForm>['user']) {
  await user.click(screen.getByText(PLAN_COPY.moreOptions));
}

describe('plain labels, each with a short hint (critique heuristic 2)', () => {
  it('names the policy fields in plain words and keeps the spec terms in their hints', async () => {
    const { user } = renderForm();
    await openAdvanced(user);
    expect(screen.getByRole('group', { name: D.policyHeading })).toBeInTheDocument();
    expect(screen.getByText(D.policyIntro)).toBeInTheDocument();
    for (const [label, hint] of [
      [D.maxCells, D.maxCellsHint],
      [D.topN, D.topNHint],
      [D.perDepartureDateBest, D.perDepartureDateBestHint],
      [D.expandTop, D.expandTopHint(5)],
    ] as const) {
      const box = screen.getByLabelText(label);
      // the hint is tied to its box, so a screen reader hears it with the label
      expect(box).toHaveAccessibleDescription(hint);
    }
    expect(screen.getByLabelText(D.maxCells)).toHaveValue('10');
    expect(screen.getByLabelText(D.topN)).toHaveValue('10');
    expect(screen.getByLabelText(D.expandTop)).toHaveValue('2');
    expect(screen.getByLabelText(COPY.priceCeiling)).toHaveAccessibleDescription(D.priceCeilingHint);
    // no jargon label is left on the form
    for (const old of ['Max cells per run', 'Top N by discovery price', 'Outbounds expanded per cell'])
      expect(screen.queryByText(old)).toBeNull();
    expect(screen.getByText(D.discoveryProviders)).toBeInTheDocument();
    expect(screen.getByText(D.verificationProviders)).toBeInTheDocument();
  });

  it('the estimate says what a cell is and how long a run takes', () => {
    renderWithProviders(<EstimatePanel estimate={estimate()} hardStop={2000} />);
    const panel = screen.getByRole('region', { name: COPY.estimateHeading });
    expect(within(panel).getByText('126 cells')).toBeInTheDocument();
    expect(within(panel).getByText(D.estimateCellsHint)).toBeInTheDocument();
    // 620 s, the estimate's own seconds
    expect(within(panel).getByText('A run of this search takes about 10m.')).toBeInTheDocument();
  });

  it('the Name field does not stretch the full width', () => {
    renderForm();
    expect(screen.getByLabelText(COPY.name).closest('span')).toHaveClass('max-w-md');
  });
});

describe('Max billed calls per run 0 explains itself where it appears', () => {
  it('beside the field: why SearchApi does not run, and how to raise it', async () => {
    const { user } = renderForm(zeroCallPresets());
    await openAdvanced(user);
    expect(screen.getByLabelText(COPY.maxCalls)).toHaveValue('0');
    expect(screen.getByLabelText(COPY.maxCalls)).toHaveAccessibleDescription(D.maxCallsZero);
    await user.clear(screen.getByLabelText(COPY.maxCalls));
    await user.type(screen.getByLabelText(COPY.maxCalls), '200');
    expect(screen.getByLabelText(COPY.maxCalls)).toHaveAccessibleDescription(D.maxCallsHint);
  });

  it('beside the estimate: the hard stop of 0 names the calls that will not run and the number to raise it to', () => {
    renderWithProviders(<EstimatePanel estimate={estimate()} hardStop={0} />);
    expect(screen.getByText(D.hardStopZero(140))).toBeInTheDocument();
  });

  it('says nothing extra when the search uses no billed source', () => {
    const free = estimate({
      perProvider: estimate().perProvider.filter((p) => p.providerId === 'travelpayouts'),
      totalCalls: 14,
    });
    renderWithProviders(<EstimatePanel estimate={free} hardStop={0} />);
    expect(screen.queryByText(/^Hard stop 0/)).toBeNull();
  });
});

describe('journey time in hours and minutes', () => {
  it('shows the stored minutes as hours and minutes and sends minutes', async () => {
    const bodies = estimateBodies();
    const { user } = renderForm();
    await openAdvanced(user);
    const label = PLAN_COPY.journey;
    const hours = screen.getByLabelText(D.journeyPart(label, D.journeyHours));
    const minutes = screen.getByLabelText(D.journeyPart(label, D.journeyMinutes));
    expect(screen.getByRole('group', { name: label })).toBeInTheDocument();
    expect(hours).toHaveValue('25');
    expect(minutes).toHaveValue('0');
    await user.clear(hours);
    await user.type(hours, '20');
    await user.clear(minutes);
    await user.type(minutes, '30');
    await user.click(screen.getByRole('button', { name: COPY.showEstimate }));
    await screen.findByRole('region', { name: COPY.estimateHeading });
    expect(bodies[0]).toMatchObject({ constraints: { maxJourneyMinutes: 1230 } });
  });

  it('a letter is not taken, and clearing both boxes removes the constraint', async () => {
    const bodies = estimateBodies();
    const { user } = renderForm();
    await openAdvanced(user);
    const label = PLAN_COPY.journey;
    const hours = screen.getByLabelText(D.journeyPart(label, D.journeyHours));
    const minutes = screen.getByLabelText(D.journeyPart(label, D.journeyMinutes));
    await user.type(hours, 'x');
    expect(hours).toHaveValue('25');
    await user.clear(hours);
    await user.clear(minutes);
    await user.click(screen.getByRole('button', { name: COPY.showEstimate }));
    await screen.findByRole('region', { name: COPY.estimateHeading });
    expect(bodies[0]).toHaveProperty('constraints');
    expect(bodies[0]).not.toMatchObject({ constraints: { maxJourneyMinutes: expect.anything() } });
  });
});

describe('the schedule picker', () => {
  it('reads the default cron as a weekly schedule, in words', async () => {
    const { user } = renderForm();
    await openAdvanced(user);
    expect(screen.getByLabelText(S.repeat)).toHaveValue('weekly');
    expect(screen.getByRole('checkbox', { name: 'Mon' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Thu' })).not.toBeChecked();
    expect(screen.getByLabelText(S.time)).toHaveValue('05:00');
    expect(screen.getByText('Mondays at 05:00 (Europe/London)')).toBeInTheDocument();
  });

  it('weekly days, daily, none and custom each send their cron', async () => {
    const bodies = estimateBodies();
    const { user } = renderForm();
    await openAdvanced(user);
    const estimateOnce = async () => {
      await user.click(screen.getByRole('button', { name: COPY.showEstimate }));
      await screen.findByRole('region', { name: COPY.estimateHeading });
    };
    await user.click(screen.getByRole('checkbox', { name: 'Thu' }));
    expect(screen.getByText('Mondays and Thursdays at 05:00 (Europe/London)')).toBeInTheDocument();
    await estimateOnce();
    expect(bodies.at(-1)).toMatchObject({ scheduleCron: '0 5 * * 1,4' });

    await user.selectOptions(screen.getByLabelText(S.repeat), 'daily');
    expect(screen.getByText('Every day at 05:00 (Europe/London)')).toBeInTheDocument();
    await estimateOnce();
    expect(bodies.at(-1)).toMatchObject({ scheduleCron: '0 5 * * *' });

    await user.selectOptions(screen.getByLabelText(S.repeat), 'custom');
    expect(screen.getByLabelText(S.cron)).toHaveValue('0 5 * * *');
    await user.clear(screen.getByLabelText(S.cron));
    await user.type(screen.getByLabelText(S.cron), '*/30 6 1 * *');
    expect(screen.getByText('On the cron schedule "*/30 6 1 * *" (Europe/London)')).toBeInTheDocument();
    await estimateOnce();
    expect(bodies.at(-1)).toMatchObject({ scheduleCron: '*/30 6 1 * *' });

    await user.selectOptions(screen.getByLabelText(S.repeat), 'none');
    expect(screen.getByText(S.none)).toBeInTheDocument();
    await estimateOnce();
    expect(bodies.at(-1)).toMatchObject({ scheduleCron: null });
  });

  it('a weekly schedule with every day unticked says so and blocks estimating', async () => {
    const { user } = renderForm();
    await openAdvanced(user);
    await user.click(screen.getByRole('checkbox', { name: 'Mon' }));
    expect(screen.getByText(S.noDays)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: COPY.showEstimate })).toBeDisabled();
  });

  it('a saved custom cron is kept as it is until the operator changes it', async () => {
    const existing = definition({ scheduleCron: '0 5 1,15 * *' });
    const { user } = renderWithProviders(
      <DefinitionForm existing={existing} providers={providersResponse()} />,
    );
    await openAdvanced(user);
    expect(screen.getByLabelText(S.repeat)).toHaveValue('custom');
    expect(screen.getByLabelText(S.cron)).toHaveValue('0 5 1,15 * *');
  });
});

describe('the estimate and budget fit read plainly', () => {
  it('a run every line of which a cap blocks states no duration', () => {
    renderWithProviders(<EstimatePanel estimate={estimate({ seconds: 0 })} hardStop={0} />);
    expect(screen.queryByText(/^A run of this search takes/)).toBeNull();
  });
  it('budget fit rounds the runs a month to one decimal', () => {
    const fit = { ...definition().budgetFit, runsPerMonth: 52 / 12, fits: false };
    renderWithProviders(<BudgetFitPanel fit={fit} />);
    expect(screen.getByText(COPY.budgetFitWarn(4.3))).toBeInTheDocument();
  });
});
