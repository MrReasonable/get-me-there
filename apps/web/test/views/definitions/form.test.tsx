import { CONSTRAINT_LABELS } from '@gmt/core';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { delay, HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DefinitionResponse } from '../../../src/api/types.js';
import { PLAN_COPY } from '../../../src/copy/plan.js';
import { SETUP_COPY } from '../../../src/copy/setup.js';
import { COPY } from '../../../src/copy.js';
import { EXAMPLE_LABEL } from '../../../src/example.js';
import { readLastSearch } from '../../../src/state/lastSearch.js';
import { AIRPORT_DEBOUNCE_MS } from '../../../src/views/Definitions/AirportListInput.js';
import { DefinitionForm } from '../../../src/views/Definitions/DefinitionForm.js';
import {
  defaultDraft,
  definitionToDraft,
  draftToRequest,
  normaliseIata,
} from '../../../src/views/Definitions/draft.js';
import { NewSearchForm } from '../../../src/views/Searches/NewSearchForm.js';
import { API, airports, definition, estimate, estimateResponse, providersResponse } from '../../fixtures.js';
import { server } from '../../msw/server.js';
import { renderWithProviders, settled } from '../../render.js';
import { pickDate } from '../searches/formSupport.js';

// The search form's fields and the Edit page (spec rev 55 §11; WP20 Task 20.5). The new-search form and the Edit page
// share their fields (`SearchFields`); these tests are not about the estimate's debounce (searches/form.test.tsx steps
// it on the fake clock), so they inject a debounce of 0 and wait on the request itself.

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const E = COPY.editSearch;
const renderNew = (providers = providersResponse()) =>
  renderWithProviders(<NewSearchForm providers={providers} debounceMs={0} />);
const renderEdit = (
  existing: DefinitionResponse = definition(),
  search = '?view=definitions&edit=def-0001',
) =>
  renderWithProviders(<DefinitionForm existing={existing} providers={providersResponse()} debounceMs={0} />, {
    search,
  });
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

/**
 * Records every estimate body, an unsaved form's (`POST /definitions/estimate`) and a saved search's draft
 * (`POST /definitions/:id/estimate`, Task 20.5 R2) alike; each answers `answer()`. `ids` holds the saved search's id
 * for each request, null for an unsaved form's.
 */
function estimateBodies(answer = () => HttpResponse.json(estimateResponse())) {
  const bodies: unknown[] = [];
  const ids: Array<string | null> = [];
  server.use(
    http.post(`${API}/definitions/estimate`, async ({ request }) => {
      bodies.push(await request.json());
      ids.push(null);
      return answer();
    }),
    http.post(`${API}/definitions/:id/estimate`, async ({ request, params }) => {
      bodies.push(await request.json());
      ids.push(String(params.id));
      return answer();
    }),
  );
  return Object.assign(bodies, { ids });
}

/** Fills the new-search form with the worked example's first pair and dates, so it asks for an estimate. */
async function complete(user: ReturnType<typeof renderNew>['user']) {
  await user.type(screen.getByLabelText('From'), 'LHR{Enter}');
  await user.type(screen.getByLabelText('To'), 'JFK{Enter}');
  await waitFor(() => expect(chipCodes('To')).toEqual(['JFK']));
  pickDate(PLAN_COPY.earliest, '2027-03-14');
  pickDate(PLAN_COPY.latest, '2027-03-28');
}

/** A paid estimate: 300 SearchApi calls at 120p over 300 of 405 date pairs. */
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

describe('the form’s defaults (spec rev 55 §8.2, §11)', () => {
  it('a new search starts with empty airports and dates and the presets; no schedule, no arrival window', async () => {
    const { user } = renderNew();
    expect(chipCodes('From')).toEqual([]);
    expect(chipCodes('To')).toEqual([]);
    expect(fieldValue(PLAN_COPY.earliest)).toBe('');
    expect(fieldValue(PLAN_COPY.latest)).toBe('');
    expect(fieldValue('Shortest stay')).toBe('10');
    expect(fieldValue('Longest stay')).toBe('21');
    await user.click(screen.getByText(PLAN_COPY.moreOptions));
    expect(fieldValue('Cabin')).toBe('economy');
    // 1500 minutes, entered and shown as 25 hours 0 minutes
    const D = SETUP_COPY.definitions;
    expect(fieldValue(D.journeyPart(PLAN_COPY.journey, D.journeyHours))).toBe('25');
    expect(fieldValue(D.journeyPart(PLAN_COPY.journey, D.journeyMinutes))).toBe('0');
    expect(fieldValue(`${CONSTRAINT_LABELS.arrivalWindowLocal} from`)).toBe('');
    expect(fieldValue(`${CONSTRAINT_LABELS.arrivalWindowLocal} to`)).toBe('');
    expect(fieldValue(D.maxCells)).toBe('10');
    expect(fieldValue(D.topN)).toBe('10');
    expect(fieldValue(D.expandTop)).toBe('2');
    expect(screen.getByRole('checkbox', { name: 'Fetch booking options' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Fetch booking options' })).toBeDisabled();
    expect(fieldValue('Max billed calls per run')).toBe('2000');
    expect(fieldValue('Max cost per run in £')).toBe('0');
    expect(fieldValue('How often to ask the Aviasales cache again (hours)')).toBe('168');
    // spec rev 55 §8.2: a new search has no schedule; repeating is added from its page
    expect(screen.queryByLabelText(SETUP_COPY.schedule.repeat)).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Enabled: scheduled runs happen' })).toBeNull();
  });

  it('defaultDraft and draftToRequest carry the spec values; the request never carries a confirmation', () => {
    const req = draftToRequest(defaultDraft(providersResponse().presets));
    expect(req).toMatchObject({
      window: { kind: 'relative', startOffsetDays: 7, lengthDays: 182 },
      minNights: 10,
      maxNights: 21,
      cabin: 'economy',
      constraints: { maxJourneyMinutes: 1500 },
      scheduleCron: null,
      verification: { maxCells: 10, topN: 10, expandTop: 2, bookingLinks: true, alwaysInclude: [] },
      enabled: false,
    });
    expect(req.constraints).not.toHaveProperty('arrivalWindowLocal');
    expect(req).not.toHaveProperty('confirmedCostPence');
  });

  it('every money field takes pounds and sends integer pence (review po-012)', async () => {
    const bodies = estimateBodies();
    const { user } = renderNew();
    await user.click(screen.getByText(PLAN_COPY.moreOptions));
    await user.type(screen.getByLabelText(`${CONSTRAINT_LABELS.maxPricePence} (£)`), '480');
    await user.type(screen.getByLabelText('Price ceiling in £ (optional)'), '500.50');
    await user.clear(screen.getByLabelText('Max cost per run in £'));
    await user.type(screen.getByLabelText('Max cost per run in £'), '2');
    await complete(user);
    await waitFor(() =>
      expect(bodies.at(-1)).toMatchObject({
        constraints: { maxPricePence: 48000 },
        verification: { priceCeilingPence: 50050 },
        budget: { maxCostMicroGbp: 2_000_000 },
      }),
    );
  });

  it('airline constraints parse like the carriers filter: codes kept, other entries shown as ignored (review arch-r2-009)', async () => {
    const bodies = estimateBodies();
    const { user } = renderNew();
    await user.click(screen.getByText(PLAN_COPY.moreOptions));
    await user.type(screen.getByLabelText(CONSTRAINT_LABELS.includeAirlines), 'zz, British');
    await user.tab();
    expect(screen.getByText('ignored, not two-character carrier codes: BRITISH')).toBeInTheDocument();
    await complete(user);
    await waitFor(() => expect(bodies.at(-1)).toMatchObject({ constraints: { includeAirlines: ['ZZ'] } }));
  });

  it('rolling dates are a switch under More options; switching back restores the fixed dates (review PFT-08)', async () => {
    const bodies = estimateBodies();
    const { user } = renderNew();
    await complete(user);
    await waitFor(() =>
      expect(bodies.at(-1)).toMatchObject({
        window: { kind: 'absolute', from: '2027-03-14', to: '2027-03-28' },
      }),
    );
    await user.click(screen.getByText(PLAN_COPY.moreOptions));
    await user.click(screen.getByRole('checkbox', { name: PLAN_COPY.rollingSwitch }));
    expect(
      screen.getByText(/^starts in 7 days, lasts 182 days: departures from 21 Oct 2026/),
    ).toBeInTheDocument();
    // the short form says what the rolling window covers today instead of the date boxes
    expect(screen.queryByLabelText(PLAN_COPY.earliest)).toBeNull();
    await user.clear(screen.getByLabelText(COPY.startOffsetDays));
    await user.type(screen.getByLabelText(COPY.startOffsetDays), '14');
    await waitFor(() =>
      expect(bodies.at(-1)).toMatchObject({
        window: { kind: 'relative', startOffsetDays: 14, lengthDays: 182 },
      }),
    );
    await user.click(screen.getByRole('checkbox', { name: PLAN_COPY.rollingSwitch }));
    expect(fieldValue(PLAN_COPY.earliest)).toBe('2027-03-14');
    expect(fieldValue(PLAN_COPY.latest)).toBe('2027-03-28');
    await waitFor(() =>
      expect(bodies.at(-1)).toMatchObject({
        window: { kind: 'absolute', from: '2027-03-14', to: '2027-03-28' },
      }),
    );
  });
});

describe('airport entry (review focus 1)', () => {
  it('upper-cases a three-letter code on blur, and only a three-letter code', async () => {
    expect([normaliseIata(' lhr '), normaliseIata('London'), normaliseIata('lhrx')]).toEqual([
      'LHR',
      'London',
      'lhrx',
    ]);
    const { user } = renderNew();
    const input = screen.getByLabelText('From');
    await user.type(input, 'lhr');
    await user.tab();
    expect(input).toHaveValue('LHR');
    await user.click(input);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(chipCodes('From')).toEqual(['LHR']));
    expect(screen.getByRole('button', { name: 'Remove LHR' })).toHaveClass('min-h-11');
    expect(input).toHaveValue('');
    await user.type(input, 'London');
    await user.tab();
    expect(input).toHaveValue('London');
  });

  it('Enter adds without a blur, a pasted " lgw " is trimmed, and a duplicate is refused', async () => {
    const { user } = renderNew();
    const input = screen.getByLabelText('From');
    await user.click(input);
    await user.paste(' lgw ');
    await user.keyboard('{Enter}');
    expect(chipCodes('From')).toEqual(['LGW']);
    await user.type(input, 'lgw{Enter}');
    expect(screen.getByText('LGW is already in the list.')).toBeInTheDocument();
    expect(chipCodes('From')).toEqual(['LGW']);
  });

  it.each(['L1', 'LHRX'])('rejects "%s" locally, and links the message to the input', async (code) => {
    const { user } = renderNew();
    const input = screen.getByLabelText('From');
    await user.type(input, `${code}{Enter}`);
    expect(screen.getByText(PLAN_COPY.pickOrCode)).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toContain('origins-errors');
  });

  it('autocompletes from GET /api/airports?q= once the debounce has passed, in a listbox', async () => {
    // why: fake the clear functions too, or a cleared debounce timer still fires on the real clock.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    // why: Testing Library steps its own setTimeout(0) waits only when a global `jest` says fake timers are on
    vi.stubGlobal('jest', { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) });
    const queries: string[] = [];
    server.use(
      http.get(`${API}/airports`, ({ request }) => {
        queries.push(new URL(request.url).searchParams.get('q') ?? '');
        return HttpResponse.json(airports);
      }),
    );
    const { user } = renderWithProviders(<NewSearchForm providers={providersResponse()} />, {
      fakeTimers: true,
    });
    await user.type(screen.getByLabelText('From'), 'lon');
    expect(queries).toEqual([]);
    await act(() => vi.advanceTimersByTimeAsync(AIRPORT_DEBOUNCE_MS));
    // why: vi.waitFor steps the fake clock itself, so nothing here depends on the real one
    const listbox = () => screen.getByRole('listbox', { name: 'From: matching airports' });
    await vi.waitFor(() => expect(within(listbox()).getAllByRole('option')).toHaveLength(3));
    expect(
      within(listbox())
        .getAllByRole('option')
        .map((o) => o.getAttribute('aria-label')),
    ).toEqual([
      'London, all airports (LHR, LGW)',
      'Heathrow (LHR) · London, United Kingdom',
      'Gatwick (LGW) · London, United Kingdom',
    ]);
    expect(queries).toEqual(['lon']);
  });

  it.each([
    [
      'Enter',
      async (u: ReturnType<typeof renderNew>['user']) => u.type(screen.getByLabelText('From'), 'lon{Enter}'),
    ],
    [
      'Enter after a blur',
      async (u: ReturnType<typeof renderNew>['user']) => {
        await u.type(screen.getByLabelText('From'), 'lon');
        await u.tab();
        await u.click(screen.getByLabelText('From'));
        await u.keyboard('{Enter}');
      },
    ],
  ])(
    'a metro code expands to its member airports on %s, before the autocomplete answers (decision 44)',
    async (_how, enter) => {
      // why: the autocomplete never answers in this test, so the chips can only come from the table lookup done on Enter
      server.use(
        http.get(`${API}/airports`, async ({ request }) => {
          // the typed-code lookup is the exact code; only the debounced autocomplete (the lowercase or partial q) is held
          if (new URL(request.url).searchParams.get('q') !== 'LON') await delay('infinite');
          return HttpResponse.json(airports);
        }),
      );
      const { user } = renderNew();
      await enter(user);
      await waitFor(() => expect(chipCodes('From')).toEqual(['LHR', 'LGW']));
      expect(screen.getByText('LON is a city code: added LHR, LGW.')).toBeInTheDocument();
      expect(chipCodes('From')).not.toContain('LON');
    },
  );

  it('a code the airports table does not map is added as typed and left to the API to judge', async () => {
    server.use(http.get(`${API}/airports`, () => HttpResponse.json([])));
    const { user } = renderNew();
    await user.type(screen.getByLabelText('To'), 'jfk{Enter}');
    await waitFor(() => expect(chipCodes('To')).toEqual(['JFK']));
  });
});

describe("the API's field errors (422 details.fields) land under the field they name (review tsr-013)", () => {
  it.each<[string, string, () => HTMLElement]>([
    ['origins.0', 'LON is a city code; use one of LHR, LGW', () => screen.getByLabelText('From')],
    ['destinations', 'origins and destinations must be disjoint', () => screen.getByLabelText('To')],
    ['window.from', 'the window has no dates left', () => screen.getByLabelText(PLAN_COPY.earliest)],
    ['maxNights', 'maxNights must be at least minNights', () => screen.getByLabelText('Longest stay')],
    ['name', 'name: required', () => screen.getByLabelText('Name')],
  ])('%s', async (field, message, input) => {
    estimateBodies(() =>
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
    );
    const { user } = renderNew();
    await complete(user);
    const summary = await screen.findByText('Fix these before saving:');
    expect(summary.parentElement).toHaveTextContent(`${field}: ${message}`);
    expect(input()).toHaveAttribute('aria-invalid', 'true');
    const linked = (input().getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    expect(linked).toContain(message);
    // the press waits, and says why in words
    expect(screen.getByRole('button', { name: /^Search now/ })).toHaveAccessibleDescription(
      COPY.newSearch.reasons.fields,
    );
  });

  it('an API error on a field inside More options opens it and moves focus to the summary (UI-11)', async () => {
    estimateBodies(() =>
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
    );
    const { user } = renderNew();
    await complete(user);
    const summary = (await screen.findByText('Fix these before saving:')).parentElement;
    expect(summary).toHaveTextContent('constraints.maxStops: too many');
    await waitFor(() => expect(summary).toHaveFocus());
    expect(screen.getByText(PLAN_COPY.moreOptions).closest('details')).toHaveAttribute('open');
  });

  it('a failed estimate that names no field says so in words beside the press', async () => {
    estimateBodies(() =>
      HttpResponse.json({ error: { code: 'internal', message: 'database is locked' } }, { status: 500 }),
    );
    const { user } = renderNew();
    await complete(user);
    const press = screen.getByRole('button', { name: /^Search now/ });
    await waitFor(() =>
      expect(press).toHaveAccessibleDescription("Couldn't work out the estimate: database is locked"),
    );
    expect(press).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('blocking and required fields (fix round 1, UI-10)', () => {
  it('a cleared nights box is "required", blocks the estimate, and is never sent as 0', async () => {
    const bodies = estimateBodies();
    const { user, client } = renderNew();
    await complete(user);
    await waitFor(() => expect(bodies.length).toBeGreaterThan(0));
    const before = bodies.length;
    await user.clear(screen.getByLabelText('Shortest stay'));
    expect(screen.getByLabelText('Shortest stay')).toBeInvalid();
    expect(screen.getByRole('button', { name: /^Search now/ })).toHaveAccessibleDescription(
      COPY.newSearch.reasons.stay,
    );
    await settled(client);
    expect(bodies).toHaveLength(before);
    await user.type(screen.getByLabelText('Shortest stay'), '8');
    await waitFor(() => expect(bodies.at(-1)).toMatchObject({ minNights: 8 }));
  });

  it('a half-filled time window shows "both ends needed", blocks the estimate, and filling the other end clears it', async () => {
    const bodies = estimateBodies();
    const { user, client } = renderNew();
    await complete(user);
    await waitFor(() => expect(bodies.length).toBeGreaterThan(0));
    const before = bodies.length;
    await user.click(screen.getByText(PLAN_COPY.moreOptions));
    const from = `${CONSTRAINT_LABELS.arrivalWindowLocal} from`;
    const to = `${CONSTRAINT_LABELS.arrivalWindowLocal} to`;
    expect(screen.queryByText('both ends needed')).toBeNull();
    fireEvent.change(screen.getByLabelText(from), { target: { value: '06:00' } });
    expect(screen.getByText('both ends needed')).toBeInTheDocument();
    expect(screen.getByLabelText(to)).toBeInvalid();
    expect(screen.getByRole('button', { name: /^Search now/ })).toHaveAccessibleDescription(
      COPY.blockedByTimeWindow,
    );
    await settled(client);
    expect(bodies).toHaveLength(before);
    fireEvent.change(screen.getByLabelText(to), { target: { value: '22:00' } });
    expect(screen.queryByText('both ends needed')).toBeNull();
    await waitFor(() =>
      expect(bodies.at(-1)).toMatchObject({
        constraints: { arrivalWindowLocal: { from: '06:00', to: '22:00' } },
      }),
    );
  });

  it('a pounds box with text that is not an amount says so instead of silently keeping the old value (UI-8)', async () => {
    const { user } = renderEdit();
    await user.click(screen.getByText(PLAN_COPY.moreOptions));
    const box = screen.getByLabelText(/^Onward cost to JFK in £/);
    await user.type(box, '12.5.0');
    expect(box).toBeInvalid();
    expect(screen.getByText(/not an amount in pounds/)).toBeInTheDocument();
    await user.clear(box);
    expect(box).toBeValid();
  });
});

describe('Edit (spec rev 55 §11 Edit)', () => {
  /** Serves the estimate, every PUT and every start, recording each in order. */
  function serveEdit(over: { start?: () => Response; put?: (body: unknown) => Response } = {}) {
    const calls: Array<{ kind: 'put' | 'start' | 'estimate'; id: string; body: unknown }> = [];
    server.use(
      http.post(`${API}/definitions/:id/estimate`, async ({ request, params }) => {
        calls.push({ kind: 'estimate', id: String(params.id), body: await request.json() });
        return HttpResponse.json(paid());
      }),
      http.put(`${API}/definitions/:id`, async ({ request, params }) => {
        const body = await request.json();
        calls.push({ kind: 'put', id: String(params.id), body });
        return over.put?.(body) ?? HttpResponse.json(definition({ id: String(params.id) }));
      }),
      http.post(`${API}/definitions/:id/executions`, async ({ request, params }) => {
        calls.push({ kind: 'start', id: String(params.id), body: await request.json() });
        return over.start?.() ?? HttpResponse.json({ executionId: 'exec-9' }, { status: 202 });
      }),
    );
    return calls;
  }
  /** The PUTs and starts, in order, without the estimates asked meanwhile. */
  const sent = (calls: ReturnType<typeof serveEdit>) => calls.filter((c) => c.kind !== 'estimate');

  it('shows the same estimate sentence, and ends with "Save and search again · about £1.20" and "Save"', async () => {
    serveEdit();
    renderEdit(definition({ scheduleCron: null, enabled: false }));
    expect(
      await screen.findByText(
        'About 3 hours · about £1.20 · asks about 300 of 405 date pairs this run, the rest when you search again',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `${E.saveAndSearch} · about £1.20` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: E.save })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show estimate' })).toBeNull();
  });

  it('on a scheduled search the sentence’s "the rest" clause follows its schedule', async () => {
    serveEdit();
    renderEdit(definition());
    expect(await screen.findByText(/, the rest next Monday$/)).toBeInTheDocument();
  });

  it('"Save and search again" PUTs, then starts that search with the sentence’s figures, then opens its page', async () => {
    const calls = serveEdit();
    // why: the URL names another search; the press acts on the one being edited, never on def=
    const { user } = renderEdit(
      definition({ id: 'def-0007', scheduleCron: null, enabled: false }),
      '?view=definitions&edit=def-0007&def=def-0001',
    );
    await user.click(await screen.findByRole('button', { name: `${E.saveAndSearch} · about £1.20` }));
    await waitFor(() => expect(sent(calls).map((c) => c.kind)).toEqual(['put', 'start']));
    expect(sent(calls)[0]).toMatchObject({ kind: 'put', id: 'def-0007' });
    expect(sent(calls)[0]?.body).not.toHaveProperty('confirmedCostPence');
    expect(sent(calls)[1]).toEqual({
      kind: 'start',
      id: 'def-0007',
      body: { confirmCostPence: 120, confirmCalls: 300, requireCovered: true, replaceStopped: true },
    });
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('view')).toBe('dates'));
    const params = new URLSearchParams(window.location.search);
    expect(params.get('def')).toBe('def-0007');
    expect(params.get('edit')).toBeNull();
    expect(readLastSearch()).toBe('def-0007');
  });

  it('two presses of Save and search again in the same tick save and start once', async () => {
    const calls = serveEdit();
    renderEdit(definition({ scheduleCron: null, enabled: false }));
    const press = await screen.findByRole('button', { name: `${E.saveAndSearch} · about £1.20` });
    act(() => {
      press.click();
      press.click();
    });
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('view')).toBe('dates'));
    expect(sent(calls).map((c) => c.kind)).toEqual(['put', 'start']);
  });

  it('estimates the edited draft as this search, by its id (R2: its own reservation and reuse are its own)', async () => {
    const calls = serveEdit();
    const { user } = renderEdit(definition({ id: 'def-0007', scheduleCron: null, enabled: false }));
    await screen.findByRole('button', { name: `${E.saveAndSearch} · about £1.20` });
    await user.clear(screen.getByLabelText('Longest stay'));
    await user.type(screen.getByLabelText('Longest stay'), '14');
    await waitFor(() =>
      expect(calls.filter((c) => c.kind === 'estimate').at(-1)).toMatchObject({
        id: 'def-0007',
        body: { maxNights: 14, origins: ['LHR', 'LGW'] },
      }),
    );
  });

  // R1: a refused start is worded where it happens, beside the press on the Edit page, and opens nothing
  it.each<[string, number, string]>([
    ['active', 409, COPY.searchAgain.refused.active],
    ['cap', 409, COPY.searchAgain.refused.cap],
    ['disabled', 409, COPY.searchAgain.refused.disabled],
    ['window', 422, COPY.searchAgain.refused.window],
    ['shutting-down', 503, COPY.searchAgain.refused['shutting-down']],
    ['confirm', 409, E.estimateChanged],
    ['internal', 500, E.startFailed('db is down')],
  ])(
    'a start refused %s is said beside Save and search again, and the page does not open',
    async (code, status, words) => {
      serveEdit({
        start: () =>
          HttpResponse.json(
            {
              error: { code, message: code === 'internal' ? 'db is down' : 'engine text that must not show' },
            },
            { status },
          ),
      });
      const { user } = renderEdit(definition({ scheduleCron: null, enabled: false }));
      await user.click(await screen.findByRole('button', { name: `${E.saveAndSearch} · about £1.20` }));
      const said = await screen.findByText(words);
      expect(said.closest('[role="alert"]')).not.toBeNull();
      expect(screen.queryByText(/engine text that must not show/)).toBeNull();
      expect(new URLSearchParams(window.location.search).get('view')).toBe('definitions');
      expect(new URLSearchParams(window.location.search).get('refused')).toBeNull();
    },
  );

  it('a confirm refusal asks the estimate again, so the press shows the new figures', async () => {
    const calls = serveEdit({
      start: () => HttpResponse.json({ error: { code: 'confirm', message: 'x' } }, { status: 409 }),
    });
    const { user } = renderEdit(definition({ scheduleCron: null, enabled: false }));
    const press = await screen.findByRole('button', { name: `${E.saveAndSearch} · about £1.20` });
    const before = calls.filter((c) => c.kind === 'estimate').length;
    await user.click(press);
    await screen.findByText(E.estimateChanged);
    await waitFor(() => expect(calls.filter((c) => c.kind === 'estimate').length).toBeGreaterThan(before));
  });

  it('a plain Save that changes the space opens the search’s page; one that does not says Saved here', async () => {
    const calls = serveEdit({
      put: (body) =>
        HttpResponse.json(
          definition(
            typeof body === 'object' && body !== null && 'maxNights' in body && body.maxNights === 14
              ? { maxNights: 14 }
              : {},
          ),
        ),
    });
    const { user } = renderEdit();
    await screen.findByRole('button', { name: `${E.saveAndSearch} · about £1.20` });
    await user.click(screen.getByRole('button', { name: E.save }));
    expect(await screen.findByText(E.saved)).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get('view')).toBe('definitions');
    await user.clear(screen.getByLabelText('Longest stay'));
    await user.type(screen.getByLabelText('Longest stay'), '14');
    await user.click(screen.getByRole('button', { name: E.save }));
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('view')).toBe('dates'));
    expect(new URLSearchParams(window.location.search).get('def')).toBe('def-0001');
    expect(sent(calls).filter((c) => c.kind === 'start')).toEqual([]);
  });

  it('editing a disabled search keeps it disabled (review po-011)', async () => {
    const calls = serveEdit();
    expect(definitionToDraft(definition({ enabled: false })).enabled).toBe(false);
    const { user } = renderEdit(definition({ enabled: false }));
    await user.click(screen.getByRole('button', { name: E.save }));
    await waitFor(() => expect(sent(calls)).toHaveLength(1));
    expect(sent(calls)[0]?.body).toMatchObject({ enabled: false });
  });

  it('a half-filled time window holds Save too, with the reason', async () => {
    const calls = serveEdit();
    const { user, client } = renderEdit(
      definition({
        constraints: { maxJourneyMinutes: 1500, arrivalWindowLocal: { from: '06:00', to: '23:00' } },
      }),
    );
    await user.click(screen.getByText(PLAN_COPY.moreOptions));
    await user.clear(screen.getByLabelText(`${CONSTRAINT_LABELS.arrivalWindowLocal} to`));
    const save = screen.getByRole('button', { name: E.save });
    expect(save).toHaveAttribute('aria-disabled', 'true');
    expect(save).toHaveAccessibleDescription(COPY.blockedByTimeWindow);
    await user.click(save);
    await settled(client);
    expect(sent(calls)).toEqual([]);
  });

  it('a save that raises the estimate above a scheduled search’s confirmation asks again; Confirm PUTs its figures', async () => {
    const calls = serveEdit({
      put: () =>
        HttpResponse.json(
          definition({
            needsConfirmation: {
              estimateMicroGbp: 2_500_000,
              totalCalls: 300,
              confirmedCostPence: 100,
              confirmedCalls: 154,
            },
          }),
        ),
    });
    const { user } = renderEdit();
    await user.click(screen.getByRole('button', { name: E.save }));
    const confirm = await screen.findByRole('button', {
      name: 'Confirm about 300 calls (stops at 2000), £2.50 per run',
    });
    await user.click(confirm);
    await waitFor(() =>
      expect(sent(calls).at(-1)?.body).toEqual({ confirmedCostPence: 250, confirmedCalls: 300 }),
    );
  });

  it('note and onward cost per destination reach the estimate, the cost in pence', async () => {
    const bodies = estimateBodies();
    const { user } = renderEdit(definition({ destinations: ['JFK'] }));
    await user.click(screen.getByText(PLAN_COPY.moreOptions));
    await user.type(screen.getByLabelText('Note for JFK (shown on every row)'), 'onward leg not included');
    await user.type(
      screen.getByLabelText('Onward cost to JFK in £ (optional, shown as a separate adjusted column)'),
      '25.50',
    );
    await waitFor(() =>
      expect(bodies.at(-1)).toMatchObject({
        destinations: ['JFK'],
        destinationNotes: { JFK: 'onward leg not included' },
        onwardCostPence: { JFK: 2550 },
      }),
    );
    expect(bodies.at(-1)).not.toHaveProperty('confirmedCostPence');
  });

  it('"import example" loads the route, window, nights and the arrival window of docs/examples/london-new-york.json', async () => {
    estimateBodies();
    const { user } = renderEdit(
      definition({ origins: ['BHX'], destinations: ['FRA'], minNights: 3, maxNights: 4 }),
    );
    await user.click(screen.getByRole('button', { name: `Import example (${EXAMPLE_LABEL})` }));
    expect(chipCodes('From')).toEqual(['LHR', 'LGW']);
    expect(chipCodes('To')).toEqual(['JFK', 'EWR']);
    expect(fieldValue('Shortest stay')).toBe('10');
    expect(fieldValue('Longest stay')).toBe('21');
    await user.click(screen.getByText(PLAN_COPY.moreOptions));
    // why: the time-window boxes follow the draft (review arch-r3-004)
    expect(fieldValue(`${CONSTRAINT_LABELS.arrivalWindowLocal} from`)).toBe('06:00');
    expect(fieldValue(`${CONSTRAINT_LABELS.arrivalWindowLocal} to`)).toBe('23:00');
  });

  it('keeps the schedule fields, worded without Run now (20.1 concern 4)', async () => {
    estimateBodies();
    const { user } = renderEdit(definition({ scheduleCron: null, enabled: false }));
    await user.click(screen.getByText(PLAN_COPY.moreOptions));
    expect(fieldValue(SETUP_COPY.schedule.repeat)).toBe('none');
    expect(screen.getByText(SETUP_COPY.schedule.none)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Run now/);
  });
});
