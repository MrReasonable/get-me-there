import { CONSTRAINT_LABELS } from '@gmt/core';
import { screen, within } from '@testing-library/react';
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
  renderForm,
  searchNow,
  step,
  type User,
} from './formSupport.js';

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
  it('shows From, To, Leave between as two "10 Jan 2027" fields, Stay and Search now; nothing else outside More options', () => {
    renderForm();
    expect(screen.getByRole('combobox', { name: PLAN_COPY.from })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: PLAN_COPY.to })).toBeInTheDocument();
    const leave = screen.getByRole('group', { name: PLAN_COPY.leaveBetween });
    const dates = within(leave).getAllByRole('textbox');
    expect(dates.map((d) => d.getAttribute('placeholder'))).toEqual(['10 Jan 2027', '10 Jan 2027']);
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
    expect(screen.getByRole('checkbox', { name: 'Travelpayouts' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Camoufox' })).toBeChecked();
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
      screen.getByText('provider-month:searchapi: 616 estimated a month, cap 10000'),
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
        await user.clear(field(PLAN_COPY.latest));
        await user.type(field(PLAN_COPY.latest), '1 Jan 2027');
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

describe('dates typed the old way (Review Focus 5)', () => {
  it('"10/01/2027" is refused beside the field, no estimate is asked past the debounce, and the button names Leave between', async () => {
    const held = holdEstimates();
    const { user } = renderForm();
    await fill(user);
    await user.clear(field(PLAN_COPY.earliest));
    await user.type(field(PLAN_COPY.earliest), '10/01/2027');
    const box = field(PLAN_COPY.earliest);
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(box).toHaveAccessibleDescription(N.dateFormat);
    await step(ESTIMATE_DEBOUNCE_MS * 3);
    expect(held.bodies).toHaveLength(0);
    expect(searchNow()).toHaveAttribute('aria-disabled', 'true');
    expect(searchNow()).toHaveAccessibleDescription(N.reasons.dateText);
    expect(N.reasons.dateText).toContain(PLAN_COPY.leaveBetween);
  });

  it('"10 Jan" with no year is echoed beside the field as its next occurrence, "10 Jan 2027"', async () => {
    holdEstimates();
    const { user } = renderForm();
    await user.type(field(PLAN_COPY.earliest), '10 Jan');
    const box = field(PLAN_COPY.earliest);
    expect(box).not.toHaveAttribute('aria-invalid', 'true');
    expect(box).toHaveAccessibleDescription('10 Jan 2027');
  });
});
