import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import type { DefinitionResponse } from '../../../src/api/types.js';
import { PLAN_COPY } from '../../../src/copy/plan.js';
import { SETUP_COPY } from '../../../src/copy/setup.js';
import { COPY } from '../../../src/copy.js';
import { DefinitionForm } from '../../../src/views/Definitions/DefinitionForm.js';
import { BudgetFitPanel } from '../../../src/views/Definitions/EstimatePanel.js';
import { API, definition, estimateResponse, providersResponse } from '../../fixtures.js';
import { server } from '../../msw/server.js';
import { renderWithProviders } from '../../render.js';

const D = SETUP_COPY.definitions;
const S = SETUP_COPY.schedule;

// why: these tests are about the fields, not the estimate's debounce, so it is injected as 0 (searches/form.test.tsx
// steps the real one on the fake clock); the Edit page holds every field the new-search form has, and the schedule
const renderForm = (existing: DefinitionResponse = definition()) =>
  renderWithProviders(<DefinitionForm existing={existing} providers={providersResponse()} debounceMs={0} />);

/** The bodies POSTed to the estimate route, in order. */
function estimateBodies() {
  const bodies: unknown[] = [];
  server.use(
    // why: the Edit page estimates its draft as the saved search (Task 20.5 R2)
    http.post(`${API}/definitions/:id/estimate`, async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json(estimateResponse());
    }),
  );
  return bodies;
}

async function openAdvanced(user: ReturnType<typeof renderForm>['user']) {
  await user.click(screen.getByText(PLAN_COPY.moreOptions));
}

/** Edit's Limits and checks fold (design 2026-11-08 Ruling 13): the constraints, checking fares and the run budget. */
async function openLimits(user: ReturnType<typeof renderForm>['user']) {
  await user.click(screen.getByText(COPY.newSearch.limitsHeading));
}

/** Repeat's Other (Ruling 14): the schedule picker, under More options. */
async function openPicker(user: ReturnType<typeof renderForm>['user']) {
  await openAdvanced(user);
  await user.selectOptions(screen.getByLabelText(COPY.newSearch.repeat), 'other');
}

describe('plain labels, each with a short hint (critique heuristic 2)', () => {
  it('names the policy fields in plain words and keeps the spec terms in their hints', async () => {
    const { user } = renderForm();
    await openLimits(user);
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
    // which sources a search uses is Where to look's (Ruling 13), never a tick per stage here
    expect(screen.getByRole('group', { name: COPY.newSearch.whereToLook })).toBeInTheDocument();
    expect(document.querySelector('[id^="p-d-"], [id^="p-v-"]')).toBeNull();
  });

  it('the Name field does not stretch the full width', () => {
    renderForm();
    expect(screen.getByLabelText(COPY.name).closest('span')).toHaveClass('max-w-md');
  });
});

describe('Max billed calls per run 0 explains itself where it appears', () => {
  it('beside the field: why SearchApi does not run, and how to raise it', async () => {
    const zero = definition({ budget: { ...definition().budget, maxCalls: 0 } });
    const { user } = renderForm(zero);
    await openLimits(user);
    expect(screen.getByLabelText(COPY.maxCalls)).toHaveValue('0');
    expect(screen.getByLabelText(COPY.maxCalls)).toHaveAccessibleDescription(D.maxCallsZero);
    await user.clear(screen.getByLabelText(COPY.maxCalls));
    await user.type(screen.getByLabelText(COPY.maxCalls), '200');
    expect(screen.getByLabelText(COPY.maxCalls)).toHaveAccessibleDescription(D.maxCallsHint);
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
    await waitFor(() => expect(bodies.at(-1)).toMatchObject({ constraints: { maxJourneyMinutes: 1230 } }));
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
    await waitFor(() => {
      expect(bodies.at(-1)).toHaveProperty('constraints');
      expect(bodies.at(-1)).not.toMatchObject({ constraints: { maxJourneyMinutes: expect.anything() } });
    });
  });
});

describe('the schedule picker (Repeat’s Other, Ruling 14)', () => {
  it('a search with no schedule shows none; Weekly starts on Mondays at 05:00, in words', async () => {
    const { user } = renderForm(definition({ scheduleCron: null, enabled: false }));
    await openPicker(user);
    expect(screen.getByLabelText(S.repeat)).toHaveValue('none');
    expect(screen.getByText(S.none)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(S.repeat), 'weekly');
    expect(screen.getByLabelText(S.repeat)).toHaveValue('weekly');
    expect(screen.getByRole('checkbox', { name: 'Mon' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Thu' })).not.toBeChecked();
    expect(screen.getByLabelText(S.time)).toHaveValue('05:00');
    expect(screen.getByText('Mondays at 05:00 (Europe/London)')).toBeInTheDocument();
  });

  it('weekly days, daily, none and custom each send their cron', async () => {
    const bodies = estimateBodies();
    const { user } = renderForm(definition({ scheduleCron: null, enabled: false }));
    await openPicker(user);
    // why: each change asks for the estimate itself; the last body asked for carries the picked cron
    const sent = (cron: string | null) =>
      waitFor(() => expect(bodies.at(-1)).toMatchObject({ scheduleCron: cron }));
    await user.selectOptions(screen.getByLabelText(S.repeat), 'weekly');
    await user.click(screen.getByRole('checkbox', { name: 'Thu' }));
    expect(screen.getByText('Mondays and Thursdays at 05:00 (Europe/London)')).toBeInTheDocument();
    await sent('0 5 * * 1,4');

    await user.selectOptions(screen.getByLabelText(S.repeat), 'daily');
    expect(screen.getByText('Every day at 05:00 (Europe/London)')).toBeInTheDocument();
    await sent('0 5 * * *');

    await user.selectOptions(screen.getByLabelText(S.repeat), 'custom');
    expect(screen.getByLabelText(S.cron)).toHaveValue('0 5 * * *');
    await user.clear(screen.getByLabelText(S.cron));
    await user.type(screen.getByLabelText(S.cron), '*/30 6 1 * *');
    expect(screen.getByText('On the cron schedule "*/30 6 1 * *" (Europe/London)')).toBeInTheDocument();
    await sent('*/30 6 1 * *');

    await user.selectOptions(screen.getByLabelText(S.repeat), 'none');
    expect(screen.getByText(S.none)).toBeInTheDocument();
    await sent(null);
  });

  it('a weekly schedule with every day unticked says so and holds both presses, with the reason', async () => {
    const { user } = renderForm(definition({ scheduleCron: null, enabled: false }));
    await openPicker(user);
    await user.selectOptions(screen.getByLabelText(S.repeat), 'weekly');
    await user.click(screen.getByRole('checkbox', { name: 'Mon' }));
    expect(screen.getByText(S.noDays)).toBeInTheDocument();
    for (const press of [
      screen.getByRole('button', { name: COPY.editSearch.save }),
      screen.getByRole('button', { name: /^Save and search again/ }),
    ]) {
      expect(press).toHaveAttribute('aria-disabled', 'true');
      expect(press).toHaveAccessibleDescription(S.blocked);
    }
  });

  it('a saved custom cron is kept as it is until the operator changes it', async () => {
    const { user } = renderForm(definition({ scheduleCron: '0 5 1,15 * *' }));
    await openAdvanced(user);
    expect(
      screen.getByText('Other: On the cron schedule "0 5 1,15 * *" (Europe/London)'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: COPY.newSearch.repeatChangeName }));
    expect(screen.getByLabelText(S.repeat)).toHaveValue('custom');
    expect(screen.getByLabelText(S.cron)).toHaveValue('0 5 1,15 * *');
  });
});

describe('the budget fit reads plainly', () => {
  it('budget fit rounds the runs a month to one decimal', () => {
    const fit = { ...definition().budgetFit, runsPerMonth: 52 / 12, fits: false };
    renderWithProviders(<BudgetFitPanel fit={fit} />);
    expect(screen.getByText(COPY.budgetFitWarn(4.3))).toBeInTheDocument();
  });
});
