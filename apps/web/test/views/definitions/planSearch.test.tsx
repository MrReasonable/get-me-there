import { asIata } from '@gmt/core';
// "Plan a search": the short form leads the Searches view and sets up a whole search (from, to, when, how long,
// journey time, cabin and a suggested name) through the estimate and Create without opening More options.
import { act, screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AirportsResponse } from '../../../src/api/types.js';
import { PLAN_COPY } from '../../../src/copy/plan.js';
import { EXAMPLE_DEFINITION, EXAMPLE_LABEL } from '../../../src/example.js';
import { AIRPORT_DEBOUNCE_MS } from '../../../src/views/Definitions/AirportListInput.js';
import { DefinitionForm } from '../../../src/views/Definitions/DefinitionForm.js';
import { DefinitionsView } from '../../../src/views/Definitions/DefinitionsView.js';
import { API, definition, estimate, providersResponse } from '../../fixtures.js';
import { server } from '../../msw/server.js';
import { renderWithProviders } from '../../render.js';

type Row = AirportsResponse[number];
const row = (iata: string, name: string, city: string, country: string, metro: string | null): Row => ({
  iata: asIata(iata),
  name,
  city,
  country,
  tz: 'UTC',
  metro,
});
const LHR = row('LHR', 'London Heathrow Airport', 'London', 'GB', 'LON');
const LGW = row('LGW', 'London Gatwick Airport', 'London', 'GB', 'LON');
const JFK = row('JFK', 'John F Kennedy International Airport', 'New York', 'US', 'NYC');
const EWR = row('EWR', 'Newark Liberty International Airport', 'Newark', 'US', 'NYC');
const LGA = row('LGA', 'La Guardia Airport', 'New York', 'US', 'NYC');
const ANSWERS: Record<string, Row[]> = {
  lond: [LGW, LHR],
  LON: [LGW, LHR],
  'new y': [EWR, JFK, LGA],
  NYC: [EWR, JFK, LGA],
  LHR: [LHR],
  LGW: [LGW],
  JFK: [JFK],
  EWR: [EWR],
  LGA: [LGA],
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The worked example's airports, a recorder for the estimate and create bodies, all on the fake clock. */
function setUp() {
  const estimates: unknown[] = [];
  const creates: unknown[] = [];
  server.use(
    http.get(`${API}/airports`, ({ request }) =>
      HttpResponse.json(ANSWERS[new URL(request.url).searchParams.get('q') ?? ''] ?? []),
    ),
    http.post(`${API}/definitions/estimate`, async ({ request }) => {
      estimates.push(await request.json());
      return HttpResponse.json({ estimate: estimate(), budgetFit: definition().budgetFit });
    }),
    http.post(`${API}/definitions`, async ({ request }) => {
      creates.push(await request.json());
      return HttpResponse.json(definition({ id: 'def-0002' }));
    }),
  );
  // why: fake the clear functions too, or a cleared debounce timer still fires on the real clock.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.stubGlobal('jest', { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) });
  const rendered = renderWithProviders(<DefinitionForm existing={null} providers={providersResponse()} />, {
    fakeTimers: true,
  });
  return { ...rendered, estimates, creates };
}

/** Types a place into From or To, steps past the debounce and picks the first option (the whole metro). */
async function pickPlace(user: ReturnType<typeof setUp>['user'], field: 'From' | 'To', text: string) {
  await user.type(screen.getByRole('combobox', { name: field }), text);
  await act(() => vi.advanceTimersByTimeAsync(AIRPORT_DEBOUNCE_MS));
  // why: a hidden listbox has no accessible name, so it is found by name only once it shows
  await vi.waitFor(() =>
    expect(screen.getByRole('listbox', { name: PLAN_COPY.listbox(field) })).toBeVisible(),
  );
  await user.keyboard('{Enter}');
}
const chipCodes = (field: string) =>
  within(within(screen.getByRole('group', { name: field })).getByRole('list'))
    .queryAllByRole('listitem')
    .map((li) => li.firstChild?.textContent);
const fieldValue = (label: string) => {
  const el = screen.getByLabelText(label);
  if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement))
    throw new Error(`${label} is not a box`);
  return el.value;
};

describe('Plan a search (the short form)', () => {
  it('leads with from, to, when, stay, journey, cabin and name; More options stays closed', () => {
    setUp();
    const plan = screen.getByRole('region', { name: PLAN_COPY.heading });
    for (const name of ['From', 'To', PLAN_COPY.departing, PLAN_COPY.stay, PLAN_COPY.journey])
      expect(within(plan).getByRole('group', { name })).toBeInTheDocument();
    expect(within(plan).getByLabelText('Cabin')).toBeInTheDocument();
    expect(within(plan).getByLabelText(PLAN_COPY.name)).toHaveAccessibleDescription(PLAN_COPY.nameHint);
    expect(screen.getByText(PLAN_COPY.moreOptions).closest('details')).not.toHaveAttribute('open');
    // the estimate follows the short form and More options, so it is the last thing to press
    const estimateButton = screen.getByRole('button', { name: 'Show estimate' });
    expect(plan.compareDocumentPosition(estimateButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('sets up a whole search by places, through the estimate and Create, without opening More options', async () => {
    const { user, estimates, creates } = setUp();
    await pickPlace(user, 'From', 'lond');
    await vi.waitFor(() => expect(chipCodes('From')).toEqual(['LGW', 'LHR']));
    await pickPlace(user, 'To', 'new y');
    await vi.waitFor(() => expect(chipCodes('To')).toEqual(['EWR', 'JFK', 'LGA']));
    await user.click(screen.getByRole('button', { name: 'Next 9 months' }));
    await user.clear(screen.getByLabelText(PLAN_COPY.shortest));
    await user.type(screen.getByLabelText(PLAN_COPY.shortest), '7');
    await user.clear(screen.getByLabelText(PLAN_COPY.longest));
    await user.type(screen.getByLabelText(PLAN_COPY.longest), '14');
    await user.clear(screen.getByLabelText(`${PLAN_COPY.journey}, hours`));
    await user.type(screen.getByLabelText(`${PLAN_COPY.journey}, hours`), '18');
    await user.selectOptions(screen.getByLabelText('Cabin'), 'premium_economy');
    // the name follows the places, one per metro, until the operator types one
    await vi.waitFor(() => expect(fieldValue(PLAN_COPY.name)).toBe('London → New York'));
    await user.click(screen.getByRole('button', { name: 'Show estimate' }));
    await screen.findByRole('region', { name: 'Estimate' });
    await user.click(screen.getByRole('button', { name: /^Create and confirm about/ }));
    await vi.waitFor(() => expect(creates).toHaveLength(1));
    const expected = {
      name: 'London → New York',
      origins: ['LGW', 'LHR'],
      destinations: ['EWR', 'JFK', 'LGA'],
      window: { kind: 'relative', startOffsetDays: 7, lengthDays: 273 },
      minNights: 7,
      maxNights: 14,
      cabin: 'premium_economy',
      constraints: { maxJourneyMinutes: 1080 },
      // the defaults More options would show: the plan preset's sources and budget, the default schedule, disabled
      providers: providersResponse().presets.providers,
      budget: providersResponse().presets.budget,
      scheduleCron: '0 5 * * 1',
      enabled: false,
    };
    expect(estimates[0]).toMatchObject(expected);
    expect(creates[0]).toMatchObject({ ...expected, confirmedCalls: estimate().totalCalls });
    expect(screen.getByText(PLAN_COPY.moreOptions).closest('details')).not.toHaveAttribute('open');
  });

  it('a typed name is kept when the airports change; a name left empty follows the airports again', async () => {
    const { user } = setUp();
    await pickPlace(user, 'From', 'lond');
    await pickPlace(user, 'To', 'new y');
    await vi.waitFor(() => expect(fieldValue(PLAN_COPY.name)).toBe('London → New York'));
    await user.clear(screen.getByLabelText(PLAN_COPY.name));
    await user.type(screen.getByLabelText(PLAN_COPY.name), 'Family visit');
    await user.click(screen.getByRole('button', { name: 'Remove LGW' }));
    expect(fieldValue(PLAN_COPY.name)).toBe('Family visit');
    await user.clear(screen.getByLabelText(PLAN_COPY.name));
    // still the operator's (empty) box while they are in it, so typing a new name never fights the suggestion
    expect(fieldValue(PLAN_COPY.name)).toBe('');
    await user.tab();
    expect(fieldValue(PLAN_COPY.name)).toBe('London → New York');
  });

  it('Import example keeps the example name rather than suggesting one', async () => {
    const { user } = setUp();
    await user.click(screen.getByRole('button', { name: `Import example (${EXAMPLE_LABEL})` }));
    await vi.waitFor(() => expect(chipCodes('To')).toEqual(['JFK', 'EWR']));
    expect(fieldValue(PLAN_COPY.name)).toBe(EXAMPLE_DEFINITION.name);
  });

  it('an API error on the journey time stays in the short form; one on a destination note opens More options', async () => {
    let field = 'constraints.maxJourneyMinutes';
    server.use(
      http.post(`${API}/definitions/estimate`, () =>
        HttpResponse.json(
          { error: { code: 'validation', message: 'x', details: { fields: [{ field, message: 'bad' }] } } },
          { status: 422 },
        ),
      ),
    );
    const { user } = renderWithProviders(<DefinitionForm existing={null} providers={providersResponse()} />);
    await user.click(screen.getByRole('button', { name: 'Show estimate' }));
    await screen.findByText(`${field}: bad`);
    expect(screen.getByText(PLAN_COPY.moreOptions).closest('details')).not.toHaveAttribute('open');
    field = 'destinationNotes.JFK';
    await user.click(screen.getByRole('button', { name: 'Show estimate' }));
    await screen.findByText(`${field}: bad`);
    expect(screen.getByText(PLAN_COPY.moreOptions).closest('details')).toHaveAttribute('open');
  });
});

describe('the Searches view', () => {
  it('is headed Searches, offers a new search and names the saved ones to edit', async () => {
    renderWithProviders(<DefinitionsView />, { search: '?view=definitions' });
    expect(await screen.findByRole('heading', { level: 2, name: PLAN_COPY.viewHeading })).toBeInTheDocument();
    const list = screen.getByRole('list', { name: PLAN_COPY.searchList });
    expect(within(list).getByRole('link', { name: PLAN_COPY.newSearch })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      within(list).getByRole('link', { name: PLAN_COPY.editSearch(definition().name) }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: PLAN_COPY.heading })).toBeInTheDocument();
  });
});
