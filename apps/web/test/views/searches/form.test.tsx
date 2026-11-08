import { CONSTRAINT_LABELS } from '@gmt/core';
import { screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ESTIMATE_DEBOUNCE_MS } from '../../../src/api/queries.js';
import { PLAN_COPY } from '../../../src/copy/plan.js';
import { SETUP_COPY } from '../../../src/copy/setup.js';
import { COPY } from '../../../src/copy.js';
import { API, estimate, estimateResponse } from '../../fixtures.js';
import { server } from '../../msw/server.js';
import {
  addAirport,
  field,
  fill,
  holdEstimates,
  pickDate,
  renderForm,
  searchNow,
  step,
  type User,
} from './formSupport.js';
import { airportRows } from './support.js';

// Spec rev 55 §11 "The new-search form and Search now" (WP20 Task 20.5), design §4.1–§4.3: From, To, Leave between,
// Stay and Search now, everything else filled in under More options; the estimate asked for 400 ms after the last
// change and shown as one sentence; the button disabled, with its reason in words, until the estimate for the current
// form has arrived. On Vitest's fake clock, so the debounce is stepped, never waited for.

const N = COPY.newSearch;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the new-search form: what it shows (spec rev 55 §11)', () => {
  it('shows From, To, Leave between as two date fields, Stay and Search now; nothing else outside More options', () => {
    renderForm();
    expect(screen.getByRole('combobox', { name: PLAN_COPY.from })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: PLAN_COPY.to })).toBeInTheDocument();
    const leave = screen.getByRole('group', { name: PLAN_COPY.leaveBetween });
    const dates = [field(PLAN_COPY.earliest), field(PLAN_COPY.latest)];
    expect(dates.every((d) => leave.contains(d) && d.type === 'date')).toBe(true);
    expect(dates.map((d) => (d instanceof HTMLInputElement ? d.value : null))).toEqual(['', '']);
    expect(field(PLAN_COPY.shortest).value).toBe('10');
    expect(field(PLAN_COPY.longest).value).toBe('21');
    expect(searchNow()).toBeInTheDocument();
    const more = screen.getByText(PLAN_COPY.moreOptions).closest('details');
    expect(more).not.toHaveAttribute('open');
    // the journey limit, cabin and name are inside More options
    for (const label of [
      PLAN_COPY.name,
      COPY.cabin,
      SETUP_COPY.definitions.journeyPart(PLAN_COPY.journey, SETUP_COPY.definitions.journeyHours),
    ])
      expect(more?.contains(screen.getByLabelText(label))).toBe(true);
  });

  it('More options holds the presets: 25 h each way, economy, the rolling switch, every free source ticked, the name, the budget', async () => {
    const { user } = renderForm();
    await user.click(screen.getByText(PLAN_COPY.moreOptions));
    expect(
      field(SETUP_COPY.definitions.journeyPart(PLAN_COPY.journey, SETUP_COPY.definitions.journeyHours)).value,
    ).toBe('25');
    expect(screen.getByLabelText(COPY.cabin)).toHaveValue('economy');
    const rolling = screen.getByRole('checkbox', { name: PLAN_COPY.rollingSwitch });
    expect(rolling).not.toBeChecked();
    await user.click(rolling);
    expect(field(COPY.startOffsetDays).value).toBe('7');
    expect(field(COPY.lengthDays).value).toBe('182');
    expect(screen.getByText(PLAN_COPY.rollingLine(7, 182), { exact: false })).toBeInTheDocument();
    // every free source the install has configured and enabled, ticked from the presets, the browser worker included
    // spec rev 55 §3: the sources by their main-path names
    expect(screen.getByRole('checkbox', { name: 'The Aviasales cache' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'The browser worker' })).toBeChecked();
    expect(field(COPY.maxCalls).value).toBe('2000');
    // each set-up term with its one-line explanation (ui-011)
    expect(screen.getByLabelText(COPY.maxCalls)).toHaveAccessibleDescription(/^Calls to paid sources/);
  });

  it('no arrival or departure window is filled in: the time fields are empty, "only if you set one"', async () => {
    const { user } = renderForm();
    await user.click(screen.getByText(PLAN_COPY.moreOptions));
    for (const name of [CONSTRAINT_LABELS.arrivalWindowLocal, CONSTRAINT_LABELS.departureWindowLocal]) {
      expect(field(`${name} ${COPY.timeFrom}`).value).toBe('');
      expect(field(`${name} ${COPY.timeTo}`).value).toBe('');
      expect(field(`${name} ${COPY.timeFrom}`)).toHaveAccessibleDescription(PLAN_COPY.onlyIfSet);
    }
  });

  it('the name is suggested from the airports', async () => {
    holdEstimates();
    const { user } = renderForm();
    await fill(user);
    await user.click(screen.getByText(PLAN_COPY.moreOptions));
    expect(field(PLAN_COPY.name).value).toBe('Birmingham → Frankfurt');
  });
});

describe('the estimate: asked for automatically, 400 ms after the last change (spec rev 55 §11)', () => {
  it('is asked ESTIMATE_DEBOUNCE_MS after the last change and never before', async () => {
    const held = holdEstimates();
    const { user } = renderForm();
    await fill(user);
    expect(ESTIMATE_DEBOUNCE_MS).toBe(400);
    await step(ESTIMATE_DEBOUNCE_MS - 1);
    expect(held.bodies).toHaveLength(0);
    await step(1);
    await vi.waitFor(() => expect(held.bodies).toHaveLength(1));
    expect(held.bodies[0]).toMatchObject({
      origins: ['BHX'],
      destinations: ['FRA'],
      window: { kind: 'absolute', from: '2027-01-10', to: '2027-03-31' },
      minNights: 10,
      maxNights: 21,
      scheduleCron: null,
      enabled: false,
      name: 'Birmingham → Frankfurt',
    });
    expect(held.bodies[0]).not.toHaveProperty('confirmedCostPence');
    // a later change waits its own 400 ms
    await user.clear(field(PLAN_COPY.longest));
    await user.type(field(PLAN_COPY.longest), '14');
    await step(ESTIMATE_DEBOUNCE_MS - 1);
    expect(held.bodies).toHaveLength(1);
    await step(1);
    await vi.waitFor(() => expect(held.bodies).toHaveLength(2));
    expect(held.bodies[1]).toMatchObject({ maxNights: 14 });
  });

  it('until the estimate for the current form arrives the button is aria-disabled, "Working out the estimate…", and a press sends nothing', async () => {
    const held = holdEstimates();
    const creates: unknown[] = [];
    server.use(
      http.post(`${API}/definitions/create-and-start`, async ({ request }) => {
        creates.push(await request.json());
        return HttpResponse.json({}, { status: 500 });
      }),
    );
    const { user } = renderForm();
    await fill(user);
    expect(searchNow()).toHaveAttribute('aria-disabled', 'true');
    expect(searchNow()).toHaveAccessibleDescription(N.working);
    await step(ESTIMATE_DEBOUNCE_MS);
    await vi.waitFor(() => expect(held.bodies).toHaveLength(1));
    expect(searchNow()).toHaveAccessibleDescription(N.working);
    await user.click(searchNow());
    held.release();
    const region = await screen.findByRole('status', { name: N.estimateRegion });
    await vi.waitFor(() => expect(region).toHaveTextContent('free · asks about all 126 date pairs'));
    expect(searchNow()).not.toHaveAttribute('aria-disabled');
    // a change makes the shown estimate an old form's: the button waits again and the old sentence goes
    await user.clear(field(PLAN_COPY.longest));
    await user.type(field(PLAN_COPY.longest), '14');
    expect(searchNow()).toHaveAttribute('aria-disabled', 'true');
    expect(searchNow()).toHaveAccessibleDescription(N.working);
    expect(region).not.toHaveTextContent('asks about');
    await user.click(searchNow());
    expect(creates).toEqual([]);
  });

  it('the sentence sits in a polite live region beside the button, the notes under it, and the button carries the cost', async () => {
    const paid = estimate({
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
    });
    const held = holdEstimates(() =>
      HttpResponse.json(
        estimateResponse({
          estimate: paid,
          datePairs: 405,
          datePairsCovered: 300,
          softConfirm: { reason: 'cost', estimatePence: 120, thresholdPence: 100 },
        }),
      ),
    );
    held.release();
    const { user } = renderForm();
    await fill(user);
    await step(ESTIMATE_DEBOUNCE_MS);
    const region = await screen.findByRole('status', { name: N.estimateRegion });
    await vi.waitFor(() =>
      expect(region).toHaveTextContent(
        'About 3 hours · about £1.20 · asks about 300 of 405 date pairs this run, the rest when you search again',
      ),
    );
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent(
      'This costs about £1.20, above your £1.00 check; pressing Search now confirms it',
    );
    expect(screen.getByRole('button', { name: 'Search now · about £1.20' })).toBeInTheDocument();
    // the budget-fit table moves under More options
    await user.click(screen.getByText(PLAN_COPY.moreOptions));
    expect(
      screen.getByText('Google Flights via SearchApi this month: about 616, limit 10000'),
    ).toBeInTheDocument();
  });
});

describe('an incomplete form says why, as the button’s accessible description (spec rev 55 §11)', () => {
  it.each<[string, (user: User) => Promise<void>, string]>([
    ['nothing entered', async () => undefined, N.reasons.airports],
    [
      'no dates',
      async (user) => {
        await addAirport(user, PLAN_COPY.from, 'BHX');
        await addAirport(user, PLAN_COPY.to, 'FRA');
      },
      N.reasons.dates,
    ],
    [
      'a cleared stay',
      async (user) => {
        await fill(user);
        await user.clear(field(PLAN_COPY.shortest));
      },
      N.reasons.stay,
    ],
    [
      'a shortest stay above the longest',
      async (user) => {
        await fill(user);
        await user.clear(field(PLAN_COPY.shortest));
        await user.type(field(PLAN_COPY.shortest), '22');
      },
      N.reasons.stayOrder,
    ],
    [
      'a last date before the first',
      async (user) => {
        await fill(user);
        pickDate(PLAN_COPY.latest, '2027-01-01');
      },
      N.reasons.dateOrder,
    ],
  ])('%s', async (_name, act_, reason) => {
    const held = holdEstimates();
    const { user } = renderForm();
    await act_(user);
    await step(ESTIMATE_DEBOUNCE_MS);
    expect(searchNow()).toHaveAttribute('aria-disabled', 'true');
    expect(searchNow()).toHaveAccessibleDescription(reason);
    expect(held.bodies).toHaveLength(0);
  });
});

describe('Leave between: two browser date fields (spec rev 67 §11)', () => {
  it('the picked dates are sent as the window, as picked', async () => {
    const held = holdEstimates();
    const { user } = renderForm();
    await fill(user);
    await step(ESTIMATE_DEBOUNCE_MS);
    await vi.waitFor(() => expect(held.bodies).toHaveLength(1));
    expect(held.bodies[0]).toMatchObject({
      window: { kind: 'absolute', from: '2027-01-10', to: '2027-03-31' },
    });
  });

  it('neither can be picked before today, and the latest not before the earliest once one is picked', () => {
    renderForm();
    // why: today is the pinned test clock's London date, 14 Oct 2026
    expect(field(PLAN_COPY.earliest)).toHaveAttribute('min', '2026-10-14');
    expect(field(PLAN_COPY.latest)).toHaveAttribute('min', '2026-10-14');
    pickDate(PLAN_COPY.earliest, '2027-01-10');
    expect(field(PLAN_COPY.earliest)).toHaveAttribute('min', '2026-10-14');
    expect(field(PLAN_COPY.latest)).toHaveAttribute('min', '2027-01-10');
  });

  it('a date field emptied again (a part-typed date reads as none) waits with "Enter the dates", and asks no estimate', async () => {
    const held = holdEstimates();
    const { user } = renderForm();
    await fill(user);
    await step(ESTIMATE_DEBOUNCE_MS);
    await vi.waitFor(() => expect(held.bodies).toHaveLength(1));
    pickDate(PLAN_COPY.latest, '');
    await step(ESTIMATE_DEBOUNCE_MS * 3);
    expect(searchNow()).toHaveAttribute('aria-disabled', 'true');
    expect(searchNow()).toHaveAccessibleDescription(N.reasons.dates);
    expect(held.bodies).toHaveLength(1);
  });

  it("each date field has a polite region for the API's error about it, there and empty before one comes", () => {
    renderForm();
    const region = (end: string) => document.getElementById(`w-${end}-note`);
    for (const end of ['from', 'to']) {
      expect(region(end)).toHaveAttribute('aria-live', 'polite');
      expect(region(end)).toHaveTextContent('');
      expect(field(end === 'from' ? PLAN_COPY.earliest : PLAN_COPY.latest)).not.toHaveAttribute(
        'aria-invalid',
        'true',
      );
    }
  });
});

/**
 * Answers each estimate request in turn when the test says, with a body chosen from the request (its longest stay),
 * so a test sees which answer is shown while another is still out.
 */
function queueEstimates() {
  const waiting: Array<{ maxNights: unknown; answer: () => void }> = [];
  server.use(
    airportRows(),
    http.post(`${API}/definitions/estimate`, async ({ request }) => {
      const body: unknown = await request.json();
      const maxNights =
        typeof body === 'object' && body !== null && 'maxNights' in body ? body.maxNights : null;
      await new Promise<void>((resolve) => waiting.push({ maxNights, answer: resolve }));
      // why: each body's answer differs in the date pairs it asks, so the sentence shows whose answer it is
      return HttpResponse.json(
        estimateResponse({ datePairs: Number(maxNights) * 10, datePairsCovered: Number(maxNights) * 10 }),
      );
    }),
  );
  return waiting;
}

describe('the sentence is only ever the current form’s (fix round 1, findings 8 and 11)', () => {
  const longest = async (user: User, n: string) => {
    await user.clear(field(PLAN_COPY.longest));
    await user.type(field(PLAN_COPY.longest), n);
  };
  const region = () => screen.getByRole('status', { name: N.estimateRegion });

  it('an older form’s estimate landing after a change is never shown; the current one’s is', async () => {
    const waiting = queueEstimates();
    const { user } = renderForm();
    await fill(user);
    await step(ESTIMATE_DEBOUNCE_MS);
    await vi.waitFor(() => expect(waiting).toHaveLength(1));
    await longest(user, '14');
    // the 21-night answer lands now, for a form that is no longer on screen
    waiting[0]?.answer();
    await step(0);
    expect(region()).not.toHaveTextContent('asks about');
    expect(searchNow()).toHaveAttribute('aria-disabled', 'true');
    await step(ESTIMATE_DEBOUNCE_MS);
    await vi.waitFor(() => expect(waiting).toHaveLength(2));
    expect(waiting[1]?.maxNights).toBe(14);
    waiting[1]?.answer();
    await vi.waitFor(() => expect(region()).toHaveTextContent('asks about all 140 date pairs'));
  });

  it('going back to a form asked before shows nothing until its answer is read again (A → B → A)', async () => {
    const waiting = queueEstimates();
    const { user } = renderForm();
    await fill(user);
    await step(ESTIMATE_DEBOUNCE_MS);
    await vi.waitFor(() => expect(waiting).toHaveLength(1));
    waiting[0]?.answer();
    await vi.waitFor(() => expect(region()).toHaveTextContent('asks about all 210 date pairs'));
    await longest(user, '14');
    await step(ESTIMATE_DEBOUNCE_MS);
    await vi.waitFor(() => expect(waiting).toHaveLength(2));
    waiting[1]?.answer();
    await vi.waitFor(() => expect(region()).toHaveTextContent('asks about all 140 date pairs'));
    await longest(user, '21');
    await step(ESTIMATE_DEBOUNCE_MS);
    await vi.waitFor(() => expect(waiting).toHaveLength(3));
    // the 21-night answer is cached, but it is being read again: the press waits for the new one
    expect(region()).not.toHaveTextContent('asks about');
    expect(searchNow()).toHaveAccessibleDescription(N.working);
    waiting[2]?.answer();
    await vi.waitFor(() => expect(region()).toHaveTextContent('asks about all 210 date pairs'));
  });
});
