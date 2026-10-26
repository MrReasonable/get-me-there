import { CONSTRAINT_LABELS } from '@gmt/core';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { delay, HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SETUP_COPY } from '../../../src/copy/setup.js';
import { COPY } from '../../../src/copy.js';
import { EXAMPLE_LABEL } from '../../../src/example.js';
import { AIRPORT_DEBOUNCE_MS } from '../../../src/views/Definitions/AirportListInput.js';
import { DefinitionForm } from '../../../src/views/Definitions/DefinitionForm.js';
import {
  defaultDraft,
  definitionToDraft,
  draftToRequest,
  normaliseIata,
} from '../../../src/views/Definitions/draft.js';
import { API, airports, definition, estimate, providersResponse } from '../../fixtures.js';
import { server } from '../../msw/server.js';
import { renderWithProviders, settled } from '../../render.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const renderForm = (existing: ReturnType<typeof definition> | null = null) =>
  renderWithProviders(<DefinitionForm existing={existing} providers={providersResponse()} />);
/** The current value of a labelled control, read without a cast. */
function fieldValue(label: string): string {
  const el = screen.getByLabelText(label);
  if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement))
    throw new Error(`${label} is not an input`);
  return el.value;
}
/** The chip list inside the Origins or Destinations group. */
const chips = (name: string) => within(screen.getByRole('group', { name })).getByRole('list');
const chipCodes = (name: string) =>
  within(chips(name))
    .queryAllByRole('listitem')
    .map((li) => li.firstChild?.textContent);

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

describe('Definitions form defaults (spec §11)', () => {
  it('starts with empty airports and the spec defaults; the plan preset fills providers, policy and budget', async () => {
    const { user } = renderForm();
    expect(chipCodes('Origins')).toEqual([]);
    expect(screen.getByRole('radio', { name: 'Relative to today' })).toBeChecked();
    expect(fieldValue('Starts in (days)')).toBe('7');
    expect(fieldValue('Length (days)')).toBe('182');
    expect(
      screen.getByText('departures from 21 Oct 2026 to 20 Apr 2027, as resolved today'),
    ).toBeInTheDocument();
    expect(fieldValue('Min nights')).toBe('10');
    expect(fieldValue('Max nights')).toBe('21');
    expect(fieldValue('Cabin')).toBe('economy');
    await user.click(screen.getByText('Advanced: constraints and policy'));
    // 1500 minutes, entered and shown as 25 hours 0 minutes
    const D = SETUP_COPY.definitions;
    const journey = CONSTRAINT_LABELS.maxJourneyMinutes;
    expect(fieldValue(D.journeyPart(journey, D.journeyHours))).toBe('25');
    expect(fieldValue(D.journeyPart(journey, D.journeyMinutes))).toBe('0');
    expect(fieldValue(`${CONSTRAINT_LABELS.arrivalWindowLocal} from`)).toBe('06:00');
    expect(fieldValue(`${CONSTRAINT_LABELS.arrivalWindowLocal} to`)).toBe('23:00');
    expect(fieldValue(D.maxCells)).toBe('10');
    expect(fieldValue(D.topN)).toBe('10');
    expect(fieldValue(D.expandTop)).toBe('2');
    expect(screen.getByRole('checkbox', { name: 'Fetch booking options' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Fetch booking options' })).toBeDisabled();
    expect(
      screen.getByText('Always on for SearchApi: its sellers can undercut the airline fare.'),
    ).toBeInTheDocument();
    expect(fieldValue('Max billed calls per run')).toBe('2000');
    expect(fieldValue('Max cost per run in £')).toBe('0');
    expect(fieldValue('Travelpayouts refresh interval (hours)')).toBe('168');
    // the default cron 0 5 * * 1, read by the schedule picker
    expect(fieldValue(SETUP_COPY.schedule.repeat)).toBe('weekly');
    expect(screen.getByText('Mondays at 05:00 (Europe/London)')).toBeInTheDocument();
    expect(fieldValue('Time zone')).toBe('Europe/London');
    expect(screen.getByRole('checkbox', { name: 'Enabled: scheduled runs happen' })).not.toBeChecked();
  });

  it('defaultDraft and draftToRequest carry the spec values; the request never carries a confirmation', () => {
    const req = draftToRequest(defaultDraft(providersResponse().presets));
    expect(req).toMatchObject({
      window: { kind: 'relative', startOffsetDays: 7, lengthDays: 182 },
      minNights: 10,
      maxNights: 21,
      cabin: 'economy',
      constraints: { maxJourneyMinutes: 1500, arrivalWindowLocal: { from: '06:00', to: '23:00' } },
      scheduleCron: '0 5 * * 1',
      verification: { maxCells: 10, topN: 10, expandTop: 2, bookingLinks: true, alwaysInclude: [] },
      enabled: false,
    });
    expect(req).not.toHaveProperty('confirmedCostPence');
  });

  it('every money field takes pounds and sends integer pence (review po-012)', async () => {
    const bodies = estimateBodies();
    const { user } = renderForm();
    await user.type(screen.getByLabelText('Origins'), 'LHR{Enter}');
    await user.type(screen.getByLabelText('Destinations'), 'JFK{Enter}');
    await user.click(screen.getByText('Advanced: constraints and policy'));
    await user.type(screen.getByLabelText(`${CONSTRAINT_LABELS.maxPricePence} (£)`), '480');
    await user.type(screen.getByLabelText('Price ceiling in £ (optional)'), '500.50');
    await user.clear(screen.getByLabelText('Max cost per run in £'));
    await user.type(screen.getByLabelText('Max cost per run in £'), '2');
    await user.click(screen.getByRole('button', { name: 'Show estimate' }));
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toMatchObject({
      constraints: { maxPricePence: 48000 },
      verification: { priceCeilingPence: 50050 },
      budget: { maxCostMicroGbp: 2_000_000 },
    });
  });

  it('airline constraints parse like the carriers filter: codes kept, other entries shown as ignored (review arch-r2-009)', async () => {
    const bodies = estimateBodies();
    const { user } = renderForm();
    await user.click(screen.getByText('Advanced: constraints and policy'));
    await user.type(screen.getByLabelText(CONSTRAINT_LABELS.includeAirlines), 'zz, British');
    await user.tab();
    expect(screen.getByText('ignored, not two-character carrier codes: BRITISH')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show estimate' }));
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toMatchObject({ constraints: { includeAirlines: ['ZZ'] } });
  });

  it('switching the window mode keeps the other mode values (review PFT-08)', async () => {
    const { user } = renderForm();
    await user.clear(screen.getByLabelText('Starts in (days)'));
    await user.type(screen.getByLabelText('Starts in (days)'), '14');
    await user.click(screen.getByRole('radio', { name: 'Fixed dates' }));
    await user.type(screen.getByLabelText('From'), '2027-04-01');
    await user.click(screen.getByRole('radio', { name: 'Relative to today' }));
    expect(fieldValue('Starts in (days)')).toBe('14');
    await user.click(screen.getByRole('radio', { name: 'Fixed dates' }));
    expect(fieldValue('From')).toBe('2027-04-01');
  });

  it('editing a disabled definition keeps it disabled (review po-011)', async () => {
    const puts: unknown[] = [];
    server.use(
      http.put(`${API}/definitions/:id`, async ({ request }) => {
        puts.push(await request.json());
        return HttpResponse.json(definition({ enabled: false }));
      }),
    );
    expect(definitionToDraft(definition({ enabled: false })).enabled).toBe(false);
    const { user } = renderForm(definition({ enabled: false }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await expect.poll(() => puts.length).toBe(1);
    expect(puts[0]).toMatchObject({ enabled: false });
  });
});

describe('airport entry (review focus 1)', () => {
  it('upper-cases a three-letter code on blur, and only a three-letter code', async () => {
    expect([normaliseIata(' lhr '), normaliseIata('London'), normaliseIata('lhrx')]).toEqual([
      'LHR',
      'London',
      'lhrx',
    ]);
    const { user } = renderForm();
    const input = screen.getByLabelText('Origins');
    await user.type(input, 'lhr');
    await user.tab();
    expect(input).toHaveValue('LHR');
    await user.click(screen.getByRole('button', { name: 'Add origin' }));
    expect(chipCodes('Origins')).toEqual(['LHR']);
    expect(screen.getByRole('button', { name: 'Remove LHR' })).toHaveClass('min-h-11');
    expect(input).toHaveValue('');
    await user.type(input, 'London');
    await user.tab();
    expect(input).toHaveValue('London');
  });

  it('Enter adds without a blur, a pasted " lgw " is trimmed, and a duplicate is refused', async () => {
    const { user } = renderForm();
    const input = screen.getByLabelText('Origins');
    await user.click(input);
    await user.paste(' lgw ');
    await user.keyboard('{Enter}');
    expect(chipCodes('Origins')).toEqual(['LGW']);
    await user.type(input, 'lgw{Enter}');
    expect(screen.getByText('LGW is already in the list.')).toBeInTheDocument();
    expect(chipCodes('Origins')).toEqual(['LGW']);
  });

  it.each(['L1', 'LHRX'])('rejects "%s" locally, and links the message to the input', async (code) => {
    const { user } = renderForm();
    const input = screen.getByLabelText('Origins');
    await user.type(input, `${code}{Enter}`);
    expect(screen.getByText('An airport code is three letters.')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toContain('origins-errors');
  });

  it('autocompletes from GET /api/airports?q= once the debounce has passed', async () => {
    // why: fake the clear functions too, or a cleared debounce timer still fires on the real clock.
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
    });
    // why: Testing Library drains microtasks with a setTimeout(0) and steps it only when a global `jest` says fake timers
    // are on; this shim makes it step Vitest's fake clock, so the test needs no real-time `shouldAdvanceTime`.
    vi.stubGlobal('jest', { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) });
    const queries: string[] = [];
    server.use(
      http.get(`${API}/airports`, ({ request }) => {
        queries.push(new URL(request.url).searchParams.get('q') ?? '');
        return HttpResponse.json(airports);
      }),
    );
    const { user } = renderWithProviders(<DefinitionForm existing={null} providers={providersResponse()} />, {
      fakeTimers: true,
    });
    await user.type(screen.getByLabelText('Origins'), 'lon');
    expect(queries).toEqual([]);
    await act(() => vi.advanceTimersByTimeAsync(AIRPORT_DEBOUNCE_MS));
    // why: vi.waitFor steps the fake clock itself, so nothing here depends on the real one
    await vi.waitFor(() => expect(document.querySelectorAll('#origins-options option')).toHaveLength(2));
    const options = [...document.querySelectorAll('#origins-options option')].map(
      (o) => `${o.getAttribute('value')} ${o.textContent}`,
    );
    expect(options).toEqual(['LHR Heathrow, London, United Kingdom', 'LGW Gatwick, London, United Kingdom']);
    expect(queries).toEqual(['lon']);
    vi.useRealTimers();
  });

  it.each([
    [
      'Enter',
      async (u: ReturnType<typeof renderForm>['user']) =>
        u.type(screen.getByLabelText('Origins'), 'lon{Enter}'),
    ],
    [
      'Add',
      async (u: ReturnType<typeof renderForm>['user']) => {
        await u.type(screen.getByLabelText('Origins'), 'LON');
        await u.click(screen.getByRole('button', { name: 'Add origin' }));
      },
    ],
  ])(
    'a metro code expands to its member airports on %s, before the autocomplete answers (decision 44)',
    async (_how, enter) => {
      // why: the autocomplete never answers in this test, so the chips can only come from the table lookup done on Enter or Add
      const held = http.get(`${API}/airports`, async ({ request }) => {
        // the typed-code lookup is the exact code; only the debounced autocomplete (the lowercase or partial q) is held
        if (new URL(request.url).searchParams.get('q') !== 'LON') await delay('infinite');
        return HttpResponse.json(airports);
      });
      server.use(held);
      const { user } = renderForm();
      await enter(user);
      await waitFor(() => expect(chipCodes('Origins')).toEqual(['LHR', 'LGW']));
      expect(screen.getByRole('status')).toHaveTextContent('LON is a city code: added LHR, LGW.');
      expect(chipCodes('Origins')).not.toContain('LON');
    },
  );

  it('a code the airports table does not map is added as typed and left to the API to judge', async () => {
    server.use(http.get(`${API}/airports`, () => HttpResponse.json([])));
    const { user } = renderForm();
    await user.type(screen.getByLabelText('Destinations'), 'jfk{Enter}');
    await waitFor(() => expect(chipCodes('Destinations')).toEqual(['JFK']));
  });
});

describe("the API's field errors (422 details.fields) land under the field they name (review tsr-013)", () => {
  it.each<[string, string, () => HTMLElement]>([
    ['origins.0', 'LON is a city code; use one of LHR, LGW', () => screen.getByLabelText('Origins')],
    [
      'destinations',
      'origins and destinations must be disjoint',
      () => screen.getByLabelText('Destinations'),
    ],
    ['name', 'name: required', () => screen.getByLabelText('Name')],
    ['window.lengthDays', 'lengthDays must be at most 400', () => screen.getByLabelText('Length (days)')],
    ['maxNights', 'maxNights must be at least minNights', () => screen.getByLabelText('Max nights')],
  ])('%s', async (field, message, input) => {
    server.use(
      http.post(`${API}/definitions/estimate`, () =>
        HttpResponse.json(
          {
            error: {
              code: 'validation',
              message: 'invalid definition',
              details: { fields: [{ field, message }] },
            },
          },
          { status: 422 },
        ),
      ),
    );
    const { user } = renderForm();
    await user.click(screen.getByRole('button', { name: 'Show estimate' }));
    const summary = await screen.findByText('Fix these before saving:');
    expect(summary.parentElement).toHaveTextContent(`${field}: ${message}`);
    expect(input()).toHaveAttribute('aria-invalid', 'true');
    const describedBy = input().getAttribute('aria-describedby') ?? '';
    const linked = describedBy
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    expect(linked).toContain(message);
  });

  it('a field the form has no place for appears in the summary only; a non-422 failure is a notice; errors clear after a success', async () => {
    let reply = () =>
      HttpResponse.json(
        {
          error: {
            code: 'validation',
            message: 'x',
            details: { fields: [{ field: 'verification.alwaysInclude', message: 'too many' }] },
          },
        },
        { status: 422 },
      );
    server.use(http.post(`${API}/definitions/estimate`, () => reply()));
    const { user } = renderForm();
    await user.click(screen.getByRole('button', { name: 'Show estimate' }));
    expect(await screen.findByText('verification.alwaysInclude: too many')).toBeInTheDocument();
    reply = () =>
      HttpResponse.json({ error: { code: 'internal', message: 'database is locked' } }, { status: 500 });
    await user.click(screen.getByRole('button', { name: 'Show estimate' }));
    expect(await screen.findByText('That did not work: database is locked')).toBeInTheDocument();
    expect(screen.queryByText('Fix these before saving:')).toBeNull();
    reply = () => HttpResponse.json({ estimate: estimate(), budgetFit: definition().budgetFit });
    await user.click(screen.getByRole('button', { name: 'Show estimate' }));
    await screen.findByRole('region', { name: 'Estimate' });
    expect(screen.queryByText('That did not work: database is locked')).toBeNull();
  });
});

describe('blocking, required fields, pending and focus (fix round 1)', () => {
  it('a cleared nights box is "required", blocks estimating, and is never sent as 0 (UI-10)', async () => {
    const bodies = estimateBodies();
    const { user } = renderForm();
    await user.clear(screen.getByLabelText('Min nights'));
    expect(screen.getByRole('alert')).toHaveTextContent('required');
    expect(screen.getByLabelText('Min nights')).toBeInvalid();
    const estimate = screen.getByRole('button', { name: 'Show estimate' });
    expect(estimate).toBeDisabled();
    expect(estimate).toHaveAccessibleDescription(
      'Cannot estimate or save: fill in the required number fields.',
    );
    await user.type(screen.getByLabelText('Min nights'), '8');
    expect(screen.getByRole('button', { name: 'Show estimate' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Show estimate' }));
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toMatchObject({ minNights: 8 });
  });

  it('Show estimate is disabled and labelled while working, so a double tap sends one request (UI-2)', async () => {
    let posts = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(`${API}/definitions/estimate`, async () => {
        posts += 1;
        await gate;
        return HttpResponse.json({ estimate: estimate(), budgetFit: definition().budgetFit });
      }),
    );
    const { user } = renderForm();
    await user.click(screen.getByRole('button', { name: 'Show estimate' }));
    const working = await screen.findByRole('button', { name: 'Working…' });
    expect(working).toBeDisabled();
    await user.click(working);
    release();
    await screen.findByRole('region', { name: 'Estimate' });
    expect(posts).toBe(1);
  });

  it('an API error on a field inside the advanced fold opens the fold and moves focus to the summary (UI-11)', async () => {
    server.use(
      http.post(`${API}/definitions/estimate`, () =>
        HttpResponse.json(
          {
            error: {
              code: 'validation',
              message: 'x',
              details: { fields: [{ field: 'constraints.maxStops', message: 'too many' }] },
            },
          },
          { status: 422 },
        ),
      ),
    );
    const { user } = renderForm();
    await user.click(screen.getByRole('button', { name: 'Show estimate' }));
    const summary = await screen.findByRole('alert');
    expect(summary).toHaveTextContent('constraints.maxStops: too many');
    await waitFor(() => expect(summary).toHaveFocus());
    expect(screen.getByText('Advanced: constraints and policy').closest('details')).toHaveAttribute('open');
  });

  it('a pounds box with text that is not an amount says so instead of silently keeping the old value (UI-8)', async () => {
    const { user } = renderForm();
    await user.type(screen.getByLabelText('Destinations'), 'JFK{Enter}');
    const box = screen.getByLabelText(/^Onward cost to JFK in £/);
    await user.type(box, '12.5.0');
    expect(box).toBeInvalid();
    expect(screen.getByRole('alert')).toHaveTextContent('not an amount in pounds');
    await user.clear(box);
    expect(box).toBeValid();
  });
});

describe('per-destination fields and the example (spec §11)', () => {
  it('note and onward cost per destination reach the estimate request, the cost in pence', async () => {
    const bodies = estimateBodies();
    const { user } = renderForm();
    await user.type(screen.getByLabelText('Origins'), 'LHR{Enter}');
    await user.type(screen.getByLabelText('Destinations'), 'JFK{Enter}');
    await user.type(screen.getByLabelText('Note for JFK (shown on every row)'), 'onward leg not included');
    await user.type(
      screen.getByLabelText('Onward cost to JFK in £ (optional, shown as a separate adjusted column)'),
      '25.50',
    );
    await user.click(screen.getByRole('button', { name: 'Show estimate' }));
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toMatchObject({
      origins: ['LHR'],
      destinations: ['JFK'],
      destinationNotes: { JFK: 'onward leg not included' },
      onwardCostPence: { JFK: 2550 },
    });
    expect(bodies[0]).not.toHaveProperty('confirmedCostPence');
  });

  it('the time-window boxes follow the draft: Import example shows its 06:00–23:00 arrival window (review arch-r3-004)', async () => {
    const bodies = estimateBodies();
    const { user } = renderForm();
    await user.click(screen.getByText('Advanced: constraints and policy'));
    const from = `${CONSTRAINT_LABELS.arrivalWindowLocal} from`;
    const to = `${CONSTRAINT_LABELS.arrivalWindowLocal} to`;
    await user.clear(screen.getByLabelText(from));
    await user.clear(screen.getByLabelText(to));
    expect([fieldValue(from), fieldValue(to)]).toEqual(['', '']);
    await user.click(screen.getByRole('button', { name: `Import example (${EXAMPLE_LABEL})` }));
    expect([fieldValue(from), fieldValue(to)]).toEqual(['06:00', '23:00']);
    await user.click(screen.getByRole('button', { name: 'Show estimate' }));
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toMatchObject({ constraints: { arrivalWindowLocal: { from: '06:00', to: '23:00' } } });
  });

  it('a half-filled time window shows "both ends needed" instead of being dropped, and filling the other end clears it (controller-directed)', async () => {
    const { user } = renderForm();
    await user.click(screen.getByText('Advanced: constraints and policy'));
    const from = `${CONSTRAINT_LABELS.arrivalWindowLocal} from`;
    const to = `${CONSTRAINT_LABELS.arrivalWindowLocal} to`;
    expect(screen.queryByText('both ends needed')).toBeNull();
    await user.clear(screen.getByLabelText(to));
    expect(screen.getByRole('alert')).toHaveTextContent('both ends needed');
    expect(screen.getByLabelText(to)).toBeInvalid();
    expect(screen.getByLabelText(from)).toBeInvalid();
    fireEvent.change(screen.getByLabelText(to), { target: { value: '22:00' } });
    expect(screen.queryByText('both ends needed')).toBeNull();
  });

  it('a half-filled time window disables Show estimate, says why beside it, sends nothing, and re-enables once fixed (coordinator correction)', async () => {
    const bodies = estimateBodies();
    const { user, client } = renderForm();
    await user.click(screen.getByText('Advanced: constraints and policy'));
    const to = `${CONSTRAINT_LABELS.arrivalWindowLocal} to`;
    await user.clear(screen.getByLabelText(to));
    const estimate = screen.getByRole('button', { name: 'Show estimate' });
    expect(estimate).toBeDisabled();
    expect(estimate).toHaveAccessibleDescription(
      'Cannot estimate or save: a time window needs both ends, or neither.',
    );
    await user.click(estimate);
    // why: a POST the click started would arrive after this line; wait until nothing is in flight, then count
    await settled(client);
    expect(bodies).toHaveLength(0);
    fireEvent.change(screen.getByLabelText(to), { target: { value: '22:00' } });
    expect(screen.getByRole('button', { name: 'Show estimate' })).toBeEnabled();
    expect(screen.queryByText(/Cannot estimate or save/)).toBeNull();
  });

  it('a half-filled time window also disables Save changes on an existing definition (coordinator correction)', async () => {
    const { user } = renderForm(definition());
    await user.click(screen.getByText('Advanced: constraints and policy'));
    await user.clear(screen.getByLabelText(`${CONSTRAINT_LABELS.arrivalWindowLocal} to`));
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(screen.getByText(/Cannot estimate or save/)).toBeInTheDocument();
  });

  it('"import example" loads the route, window, nights, cabin and constraints of docs/examples/london-new-york.json', async () => {
    const { user } = renderForm();
    await user.click(screen.getByRole('button', { name: `Import example (${EXAMPLE_LABEL})` }));
    expect(fieldValue('Name')).not.toBe('');
    expect(chipCodes('Origins')).toEqual(['LHR', 'LGW']);
    expect(chipCodes('Destinations')).toEqual(['JFK', 'EWR']);
    expect(fieldValue('Min nights')).toBe('10');
    expect(fieldValue('Max nights')).toBe('21');
  });

  it('"import example" leaves the per-execution budget from the plan preset (the api\'s new-definition source), never zeroed or the file\'s', async () => {
    const base = providersResponse();
    const providers = {
      ...base,
      presets: { ...base.presets, budget: { maxCalls: 321, maxFreeCalls: 654, maxCostMicroGbp: 0 } },
    };
    const { user } = renderWithProviders(<DefinitionForm existing={null} providers={providers} />);
    await user.click(screen.getByRole('button', { name: `Import example (${EXAMPLE_LABEL})` }));
    await user.click(screen.getByText(COPY.advanced));
    expect(fieldValue(COPY.maxCalls)).toBe('321');
    expect(fieldValue(COPY.maxFreeCalls)).toBe('654');
  });
});
