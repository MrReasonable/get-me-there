import { asIata } from '@gmt/core';
// "Plan a search" (spec rev 55 §11, WP20 Task 20.5): the new-search form sets up a whole search from From, To, Leave
// between and Stay, through the estimate sentence and Search now, without opening More options.
import { act, screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ESTIMATE_DEBOUNCE_MS } from '../../../src/api/queries.js';
import type { AirportsResponse } from '../../../src/api/types.js';
import { PLAN_COPY } from '../../../src/copy/plan.js';
import { COPY } from '../../../src/copy.js';
import { AIRPORT_DEBOUNCE_MS } from '../../../src/views/Definitions/AirportListInput.js';
import { DefinitionsView } from '../../../src/views/Definitions/DefinitionsView.js';
import { NewSearchForm } from '../../../src/views/Searches/NewSearchForm.js';
import { API, definition, estimate, estimateResponse, providersResponse } from '../../fixtures.js';
import { server } from '../../msw/server.js';
import { renderWithProviders } from '../../render.js';
import { pickDate } from '../searches/formSupport.js';

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
const ANSWERS: Record<string, Row[]> = {
  lond: [LGW, LHR],
  LON: [LGW, LHR],
  'new y': [JFK, EWR],
  NYC: [EWR, JFK],
  LHR: [LHR],
  LGW: [LGW],
  JFK: [JFK],
  EWR: [EWR],
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The worked example's airports, a recorder for the estimate and Search now bodies, all on the fake clock. */
function setUp() {
  const estimates: unknown[] = [];
  const creates: unknown[] = [];
  server.use(
    http.get(`${API}/airports`, ({ request }) =>
      HttpResponse.json(ANSWERS[new URL(request.url).searchParams.get('q') ?? ''] ?? []),
    ),
    http.post(`${API}/definitions/estimate`, async ({ request }) => {
      estimates.push(await request.json());
      return HttpResponse.json(estimateResponse());
    }),
    http.post(`${API}/definitions/create-and-start`, async ({ request }) => {
      creates.push(await request.json());
      return HttpResponse.json(
        { definition: definition({ id: 'def-0002' }), executionId: 'exec-9', refusal: null },
        { status: 201 },
      );
    }),
  );
  // why: fake the clear functions too, or a cleared debounce timer still fires on the real clock.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.stubGlobal('jest', { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) });
  const rendered = renderWithProviders(<NewSearchForm providers={providersResponse()} />, {
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

describe('Plan a search (the new-search form)', () => {
  it('leads with From, To, Leave between and Stay; More options stays closed; the press comes after them', () => {
    setUp();
    const plan = screen.getByRole('region', { name: PLAN_COPY.heading });
    for (const name of ['From', 'To', PLAN_COPY.leaveBetween, PLAN_COPY.stay])
      expect(within(plan).getByRole('group', { name })).toBeInTheDocument();
    // the journey limit, cabin and name are filled in under More options
    expect(within(plan).queryByLabelText('Cabin')).toBeNull();
    expect(within(plan).queryByLabelText(PLAN_COPY.name)).toBeNull();
    expect(screen.getByLabelText(PLAN_COPY.name)).toHaveAccessibleDescription(PLAN_COPY.nameHint);
    expect(screen.getByText(PLAN_COPY.moreOptions).closest('details')).not.toHaveAttribute('open');
    const press = screen.getByRole('button', { name: /^Search now/ });
    expect(plan.compareDocumentPosition(press) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('sets up a whole search by places, through the estimate sentence and Search now, without opening More options', async () => {
    const { user, estimates, creates } = setUp();
    await pickPlace(user, 'From', 'lond');
    await vi.waitFor(() => expect(chipCodes('From')).toEqual(['LGW', 'LHR']));
    await pickPlace(user, 'To', 'new y');
    await vi.waitFor(() => expect(chipCodes('To')).toEqual(['EWR', 'JFK']));
    pickDate(PLAN_COPY.earliest, '2027-03-01');
    pickDate(PLAN_COPY.latest, '2027-04-30');
    await user.clear(screen.getByLabelText(PLAN_COPY.shortest));
    await user.type(screen.getByLabelText(PLAN_COPY.shortest), '7');
    await user.clear(screen.getByLabelText(PLAN_COPY.longest));
    await user.type(screen.getByLabelText(PLAN_COPY.longest), '14');
    // the name follows the places, one per metro, until the operator types one
    await vi.waitFor(() => expect(fieldValue(PLAN_COPY.name)).toBe('London → New York'));
    await act(() => vi.advanceTimersByTimeAsync(ESTIMATE_DEBOUNCE_MS));
    const press = screen.getByRole('button', { name: /^Search now/ });
    await vi.waitFor(() => expect(press).not.toHaveAttribute('aria-disabled'));
    await user.click(press);
    await vi.waitFor(() => expect(creates).toHaveLength(1));
    const expected = {
      name: 'London → New York',
      origins: ['LGW', 'LHR'],
      destinations: ['EWR', 'JFK'],
      window: { kind: 'absolute', from: '2027-03-01', to: '2027-04-30' },
      minNights: 7,
      maxNights: 14,
      cabin: 'economy',
      constraints: { maxJourneyMinutes: 1500 },
      // the defaults More options would show: the plan preset's sources and budget, no schedule (spec rev 55 §8.2)
      providers: providersResponse().presets.providers,
      budget: providersResponse().presets.budget,
      scheduleCron: null,
      enabled: false,
    };
    expect(estimates.at(-1)).toMatchObject(expected);
    expect(creates[0]).toMatchObject({
      ...expected,
      confirmCalls: estimate().totalCalls,
      confirmCostPence: 0,
    });
    expect(screen.getByText(PLAN_COPY.moreOptions).closest('details')).not.toHaveAttribute('open');
  });

  it('a typed name is kept when the airports change; a name left empty follows the airports again', async () => {
    const { user } = setUp();
    await pickPlace(user, 'From', 'lond');
    await pickPlace(user, 'To', 'new y');
    await vi.waitFor(() => expect(fieldValue(PLAN_COPY.name)).toBe('London → New York'));
    await user.click(screen.getByText(PLAN_COPY.moreOptions));
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

  it('an API error on the stay stays in the short form; one on the name opens More options', async () => {
    let field = 'maxNights';
    server.use(
      http.post(`${API}/definitions/estimate`, () =>
        HttpResponse.json(
          { error: { code: 'validation', message: 'x', details: { fields: [{ field, message: 'bad' }] } } },
          { status: 422 },
        ),
      ),
    );
    const { user } = renderWithProviders(<NewSearchForm providers={providersResponse()} debounceMs={0} />);
    await user.type(screen.getByLabelText('From'), 'LHR{Enter}');
    await user.type(screen.getByLabelText('To'), 'JFK{Enter}');
    pickDate(PLAN_COPY.earliest, '2027-03-01');
    pickDate(PLAN_COPY.latest, '2027-04-30');
    await screen.findByText(`${field}: bad`);
    expect(screen.getByText(PLAN_COPY.moreOptions).closest('details')).not.toHaveAttribute('open');
    field = 'name';
    await user.clear(screen.getByLabelText(PLAN_COPY.longest));
    await user.type(screen.getByLabelText(PLAN_COPY.longest), '14');
    await screen.findByText(`${field}: bad`);
    expect(screen.getByText(PLAN_COPY.moreOptions).closest('details')).toHaveAttribute('open');
  });
});

describe('the Edit page (spec rev 55 §11 Edit)', () => {
  it('is headed by the search’s name, with its fields and its two presses', async () => {
    renderWithProviders(<DefinitionsView />, { search: '?view=definitions&edit=def-0001' });
    expect(
      await screen.findByRole('heading', { level: 2, name: COPY.editSearch.heading(definition().name) }),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: PLAN_COPY.heading })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: COPY.editSearch.save })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Save and search again/ })).toBeInTheDocument();
  });

  it('an edit= link to a search that does not exist says so, with the way back to Searches', async () => {
    renderWithProviders(<DefinitionsView />, { search: '?view=definitions&edit=nope' });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(PLAN_COPY.notFound);
    expect(within(alert).getByRole('link', { name: PLAN_COPY.viewHeading }).getAttribute('href')).toContain(
      'view=searches',
    );
    expect(screen.queryByRole('button', { name: COPY.editSearch.save })).toBeNull();
  });
});
