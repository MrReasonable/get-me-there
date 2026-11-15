import { DEFAULT_CRON } from '@gmt/core';
import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DefinitionResponse, ProvidersResponse } from '../../../src/api/types.js';
import { Limits } from '../../../src/components/TopBar.js';
import { PLAN_COPY } from '../../../src/copy/plan.js';
import { SETUP_COPY } from '../../../src/copy/setup.js';
import { COPY } from '../../../src/copy.js';
import { searchApiCallsLeft } from '../../../src/lib/searchApiCallsLeft.js';
import { DefinitionForm } from '../../../src/views/Definitions/DefinitionForm.js';
import { NewSearchForm } from '../../../src/views/Searches/NewSearchForm.js';
import {
  API,
  budgetResponse,
  definition,
  estimate,
  estimateResponse,
  providersResponse,
  usage,
} from '../../fixtures.js';
import { server } from '../../msw/server.js';
import { renderWithProviders } from '../../render.js';
import { freeProviders, pickDate } from './formSupport.js';
import { airportRows } from './support.js';

// Design 2026-11-08 Rulings 13–14 (Trips and Search Task 7): the new-search panel's four fields, Where to look with each
// source's cost, the short More options with Repeat, the one-sentence estimate and the press, and the Edit page that
// shares them with its Limits and checks fold. The estimate's debounce is not what these test, so it is 0.

const N = COPY.newSearch;
const W = COPY.repeatWeekly;

beforeEach(() => window.localStorage.clear());

/** Every install source set up: the Aviasales cache and SearchApi (the fixture's), and the browser. */
function allSources(): ProvidersResponse {
  const base = providersResponse();
  const browser = freeProviders().providers.find((p) => p.providerId === 'camoufox');
  if (browser === undefined) throw new Error('freeProviders names the browser');
  return providersResponse({
    providers: [...base.providers, browser],
    presets: {
      ...base.presets,
      providers: {
        discovery: ['travelpayouts', 'camoufox', 'searchapi'],
        verification: ['searchapi'],
        discoveryRefreshHours: { travelpayouts: 168, camoufox: 168, searchapi: 168 },
      },
    },
  });
}

/** SearchApi's month: 615 of 10,000 calls used. */
const searchApiMonth = () =>
  budgetResponse({
    scopes: [usage('global-month', 0, 35_000_000, 0), usage('provider-month:searchapi', 615, 10_000)],
  });

/** Records each estimate and create-and-start body; each estimate answers `answer()`. */
function serve(answer = () => HttpResponse.json(estimateResponse())) {
  const estimates: unknown[] = [];
  const creates: unknown[] = [];
  server.use(
    airportRows(),
    http.get(`${API}/budget`, () => HttpResponse.json(searchApiMonth())),
    http.post(`${API}/definitions/estimate`, async ({ request }) => {
      estimates.push(await request.json());
      return answer();
    }),
    http.post(`${API}/definitions/:id/estimate`, async ({ request }) => {
      estimates.push(await request.json());
      return answer();
    }),
    http.post(`${API}/definitions/create-and-start`, async ({ request }) => {
      creates.push(await request.json());
      return HttpResponse.json(
        { definition: definition({ id: 'def-0002' }), executionId: 'exec-9', refusal: null },
        { status: 201 },
      );
    }),
  );
  return { estimates, creates };
}

const renderPanel = (providers = allSources()) =>
  renderWithProviders(<NewSearchForm providers={providers} debounceMs={0} />);

/** From and To by code, then both dates. */
async function fill(user: ReturnType<typeof renderPanel>['user']) {
  await user.type(screen.getByRole('combobox', { name: PLAN_COPY.from }), 'BHX{Enter}');
  await user.type(screen.getByRole('combobox', { name: PLAN_COPY.to }), 'FRA{Enter}');
  await screen.findByRole('button', { name: 'Remove FRA' });
  pickDate(PLAN_COPY.earliest, '2027-01-10');
  pickDate(PLAN_COPY.latest, '2027-03-31');
}

const press = () => screen.getByRole('button', { name: /^Search( ·|$)/ });
const ready = () => waitFor(() => expect(press()).not.toHaveAttribute('aria-disabled'));
const more = () => {
  const d = screen.getByText(PLAN_COPY.moreOptions).closest('details');
  if (d === null) throw new Error('no More options fold');
  return d;
};
const source = (name: RegExp) => screen.getByRole('checkbox', { name });
const BROWSER = /^Google Flights, in your browser · free, takes a while$/;
const CACHE = /^Aviasales cache · free, prices from other people's searches, often days old$/;
const SEARCHAPI = /^SearchApi · uses calls/;

describe('the panel: what is in view (Ruling 13)', () => {
  it('outside More options only From, To, Leave from, Leave by, Stay, Where to look and Search', async () => {
    serve();
    renderPanel();
    // the calls left arrive with the budget read
    await waitFor(() => expect(source(SEARCHAPI)).toHaveAccessibleName(/9,385 left$/));
    const form = press().closest('form');
    if (form === null) throw new Error('no form');
    const fold = more();
    const outside = [
      ...form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(
        'input, select, button',
      ),
    ].filter((el) => !fold.contains(el));
    const names = outside.map((el) =>
      el instanceof HTMLButtonElement ? el.textContent : (el.labels?.[0]?.textContent ?? '').trim(),
    );
    expect(names).toEqual([
      PLAN_COPY.from,
      PLAN_COPY.to,
      PLAN_COPY.earliest,
      PLAN_COPY.latest,
      PLAN_COPY.shortest,
      PLAN_COPY.longest,
      `${N.source.camoufox} · ${N.sourceNote.camoufox}`,
      `${N.source.travelpayouts} · ${N.sourceNote.travelpayouts}`,
      expect.stringMatching(/^SearchApi · uses calls, 9,385 left$/),
      N.search,
    ]);
    expect(fold).not.toHaveAttribute('open');
    expect(press()).toHaveTextContent(/^Search$/);
  });

  it('the three sources with their words; SearchApi is unticked in a new draft, the free ones ticked', async () => {
    serve();
    renderPanel();
    expect(screen.getByRole('group', { name: N.whereToLook })).toBeInTheDocument();
    expect(source(BROWSER)).toBeChecked();
    expect(source(CACHE)).toBeChecked();
    expect(source(SEARCHAPI)).not.toBeChecked();
  });

  it('ticking SearchApi sets it in the first pass and in checking fares; unticking takes it out of both', async () => {
    const { estimates } = serve();
    const { user } = renderPanel();
    await fill(user);
    await waitFor(() => expect(estimates.length).toBeGreaterThan(0));
    expect(estimates.at(-1)).toMatchObject({
      providers: { discovery: ['travelpayouts', 'camoufox'], verification: [] },
    });
    await user.click(source(SEARCHAPI));
    await waitFor(() =>
      expect(estimates.at(-1)).toMatchObject({
        providers: { discovery: ['travelpayouts', 'camoufox', 'searchapi'], verification: ['searchapi'] },
        verification: { bookingLinks: true },
      }),
    );
    await user.click(source(SEARCHAPI));
    await waitFor(() =>
      expect(estimates.at(-1)).toMatchObject({
        providers: { discovery: ['travelpayouts', 'camoufox'], verification: [] },
      }),
    );
  });

  it('a source that is not set up has no checkbox; one sentence links to Settings instead', async () => {
    serve();
    renderPanel(freeProviders());
    expect(screen.queryByRole('checkbox', { name: SEARCHAPI })).toBeNull();
    const group = screen.getByRole('group', { name: N.whereToLook });
    expect(group).toHaveTextContent("SearchApi isn't set up yet; set it up in Settings.");
    expect(within(group).getByRole('link', { name: N.notSetUpLink })).toHaveAttribute(
      'href',
      '/?view=settings',
    );
    expect(N.notSetUp(['the browser', 'SearchApi'])).toBe(
      "The browser and SearchApi aren't set up yet; set them up in",
    );
  });

  it('the panel’s "M left" is the top bar’s figure, from the one helper', async () => {
    serve();
    renderWithProviders(
      <>
        <Limits />
        <NewSearchForm providers={allSources()} debounceMs={0} />
      </>,
    );
    const left = searchApiCallsLeft(searchApiMonth(), allSources());
    expect(left?.left).toBe(9385);
    const bar = await screen.findByRole('region', { name: COPY.topBar.limitsLabel });
    // the same figure, grouped alike in both
    await waitFor(() => expect(bar).toHaveTextContent('SearchApi: 9,385 of 10,000 calls left this month'));
    await waitFor(() => expect(source(SEARCHAPI)).toHaveAccessibleName('SearchApi · uses calls, 9,385 left'));
  });
});

describe('More options (Ruling 13)', () => {
  it('holds exactly the journey limit with its new hint, cabin, Repeat, rolling dates and the name', async () => {
    serve();
    const { user } = renderPanel();
    await user.click(screen.getByText(PLAN_COPY.moreOptions));
    const fold = more();
    // each control by its own name: its label, or the name a part of the journey box carries
    const controls = [...fold.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')].map(
      (el) => `${el.tagName}:${el.labels?.[0]?.textContent ?? el.getAttribute('aria-label') ?? ''}`,
    );
    const D = SETUP_COPY.definitions;
    expect(controls).toEqual([
      `INPUT:${D.journeyPart(PLAN_COPY.journey, D.journeyHours)}`,
      `INPUT:${D.journeyPart(PLAN_COPY.journey, D.journeyMinutes)}`,
      `SELECT:${COPY.cabin}`,
      `SELECT:${N.repeat}`,
      `INPUT:${PLAN_COPY.rollingSwitch}`,
      `INPUT:${PLAN_COPY.name}`,
    ]);
    expect(
      within(fold).getByLabelText(D.journeyPart(PLAN_COPY.journey, D.journeyHours)),
    ).toHaveAccessibleDescription('Trips over this are left out once their flights are read.');
    // nothing of Limits and checks on a new search
    expect(screen.queryByText(N.limitsHeading)).toBeNull();
    expect(screen.queryByLabelText(COPY.maxCalls)).toBeNull();
  });
});

describe('Repeat (Ruling 14)', () => {
  it('Never, Weekly and Other; a new search starts at Never', async () => {
    serve();
    const { user } = renderPanel();
    await user.click(screen.getByText(PLAN_COPY.moreOptions));
    const repeat = screen.getByLabelText(N.repeat);
    expect(repeat).toHaveValue('never');
    expect(
      within(repeat)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Never', 'Weekly', 'Other']);
  });

  it('Weekly posts DEFAULT_CRON in SCHEDULER_TIMEZONE, repeating on, with the shown totals', async () => {
    const paid = estimateResponse({
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
    const { estimates, creates } = serve(() => HttpResponse.json(paid));
    const { user } = renderPanel();
    await fill(user);
    await user.click(screen.getByText(PLAN_COPY.moreOptions));
    await user.selectOptions(screen.getByLabelText(N.repeat), 'weekly');
    await waitFor(() =>
      expect(estimates.at(-1)).toMatchObject({ scheduleCron: DEFAULT_CRON, enabled: true }),
    );
    const region = screen.getByRole('status', { name: N.estimateRegion });
    // the sentence follows the schedule: the rest of the dates next Monday
    await waitFor(() => expect(region).toHaveTextContent(/, the rest next Monday\./));
    await user.click(await screen.findByRole('button', { name: 'Search · about £1.20' }));
    await waitFor(() => expect(creates).toHaveLength(1));
    expect(creates[0]).toMatchObject({
      scheduleCron: DEFAULT_CRON,
      scheduleTz: 'Europe/London',
      enabled: true,
      confirmCostPence: 120,
      confirmCalls: 300,
    });
  });

  it('a weekly search over a monthly limit is refused in Repeat weekly’s words, with the monthly figure, and posts nothing', async () => {
    const over = estimateResponse({
      budgetFit: {
        fits: false,
        runsPerMonth: 4.3,
        perScope: [{ scope: 'provider-month:searchapi', estimated: 12_000, cap: 10_000, fits: false }],
      },
    });
    const { creates } = serve(() => HttpResponse.json(over));
    const { user } = renderPanel();
    await fill(user);
    await user.click(screen.getByText(PLAN_COPY.moreOptions));
    await user.selectOptions(screen.getByLabelText(N.repeat), 'weekly');
    await ready();
    await user.click(press());
    const alert = await screen.findByText(W.overBudget);
    expect(alert.closest('[role="alert"]')).toHaveTextContent(/about 12000, limit 10000/);
    expect(creates).toEqual([]);
    // the same estimate, not repeating, is not refused; the refusal and its figure go with the form they were said of
    await user.selectOptions(screen.getByLabelText(N.repeat), 'never');
    expect(screen.queryByText(W.overBudget)).toBeNull();
    expect(screen.queryByText(/about 12000, limit 10000/)).toBeNull();
    await ready();
    await user.click(press());
    await waitFor(() => expect(creates).toHaveLength(1));
  });

  it('the api’s monthly-fit refusal is said in the same words, never the server’s', async () => {
    serve();
    server.use(
      http.post(`${API}/definitions/create-and-start`, () =>
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
      ),
    );
    const { user } = renderPanel();
    await fill(user);
    await user.click(screen.getByText(PLAN_COPY.moreOptions));
    await user.selectOptions(screen.getByLabelText(N.repeat), 'weekly');
    await ready();
    await user.click(press());
    expect(await screen.findByText(W.overBudget)).toBeInTheDocument();
    expect(screen.queryByText(/server text that must not show/)).toBeNull();
  });

  it('Other from Never opens the picker on its weekly default, so the search repeats as the select says (fix round 2)', async () => {
    const { estimates } = serve();
    const { user } = renderPanel();
    await fill(user);
    await user.click(screen.getByText(PLAN_COPY.moreOptions));
    await user.selectOptions(screen.getByLabelText(N.repeat), 'other');
    expect(screen.getByLabelText(N.repeat)).toHaveValue('other');
    expect(screen.getByLabelText(SETUP_COPY.schedule.repeat)).toHaveValue('weekly');
    await waitFor(() =>
      expect(estimates.at(-1)).toMatchObject({ scheduleCron: DEFAULT_CRON, enabled: true }),
    );
    // the picker's "No schedule" stops repeating, and the select says Never
    await user.selectOptions(screen.getByLabelText(SETUP_COPY.schedule.repeat), 'none');
    expect(screen.getByLabelText(N.repeat)).toHaveValue('never');
    await waitFor(() => expect(estimates.at(-1)).toMatchObject({ scheduleCron: null, enabled: false }));
  });

  it('a stored daily cron shows "Other: …" with Change, which opens the schedule picker', async () => {
    serve();
    const { user } = renderEdit(definition({ scheduleCron: '30 6 * * *', enabled: true }));
    await user.click(screen.getByText(PLAN_COPY.moreOptions));
    expect(screen.getByLabelText(N.repeat)).toHaveValue('other');
    expect(screen.getByText(/^Other: Every day at 06:30 \(Europe\/London\)/)).toBeInTheDocument();
    expect(screen.queryByLabelText(SETUP_COPY.schedule.repeat)).toBeNull();
    await user.click(screen.getByRole('button', { name: N.repeatChangeName }));
    expect(screen.getByLabelText(SETUP_COPY.schedule.repeat)).toHaveValue('daily');
  });

  it('a stopped search (its schedule kept, repeating off) reads Never', async () => {
    serve();
    const { user } = renderEdit(definition({ scheduleCron: DEFAULT_CRON, enabled: false }));
    await user.click(screen.getByText(PLAN_COPY.moreOptions));
    expect(screen.getByLabelText(N.repeat)).toHaveValue('never');
  });
});

describe('the sentence and the press (Ruling 13)', () => {
  it('a free run reads as mockup 01, the press says "Search"', async () => {
    serve(() =>
      HttpResponse.json(
        estimateResponse({
          estimate: estimate({
            perProvider: [
              {
                providerId: 'camoufox',
                stage: 'discovery',
                calls: 100,
                planCalls: 100,
                costMicroGbp: 0,
                costPence: 0,
                seconds: 1500,
                blocked: null,
              },
            ],
            totalCalls: 100,
            totalCostMicroGbp: 0,
            totalCostPence: 0,
            seconds: 1500,
            flightLists: {
              pages: 23,
              seconds: 100,
              pairs: 15,
              returns: true,
              pagesMax: 580,
              secondsMax: 1825,
            },
          }),
        }),
      ),
    );
    const { user } = renderPanel();
    await fill(user);
    await ready();
    const region = screen.getByRole('status', { name: N.estimateRegion });
    expect(region).toHaveTextContent(
      'About 25 min, free. Then flights are read for the cheapest dates until the 5 cheapest stop changing.',
    );
    // the notes stay below it
    expect(region).toHaveTextContent('usually about 15 dates, at most 290');
    expect(press()).toHaveAccessibleName('Search');
  });

  it('with SearchApi ticked the sentence names its calls against those left', async () => {
    serve(() =>
      HttpResponse.json(
        estimateResponse({
          billedCalls: [{ providerId: 'searchapi', calls: 140, left: 9385, window: 'month' }],
        }),
      ),
    );
    const { user } = renderPanel();
    await fill(user);
    await user.click(source(SEARCHAPI));
    await ready();
    expect(screen.getByRole('status', { name: N.estimateRegion })).toHaveTextContent(
      'uses about 140 of the 9,385 SearchApi calls left this month',
    );
    expect(press()).toHaveAccessibleName('Search · 140 SearchApi calls');
  });
});

const renderEdit = (existing: DefinitionResponse) =>
  renderWithProviders(<DefinitionForm existing={existing} providers={allSources()} debounceMs={0} />, {
    search: '?view=definitions&edit=def-0001',
  });

describe('a source the search uses with no checkbox of its own (fix round 2)', () => {
  it('the test source, and SearchApi no longer set up, are listed ticked with why; unticking takes them out', async () => {
    const { estimates } = serve();
    // the browser, the Aviasales cache and the test source set up; SearchApi not
    const free = freeProviders();
    const first = free.providers[0];
    if (first === undefined) throw new Error('freeProviders names a source');
    const withTestSource = providersResponse({
      ...free,
      providers: [...free.providers, { ...first, providerId: 'fixture', displayName: 'Fixture' }],
    });
    const { user } = renderWithProviders(
      <DefinitionForm
        existing={definition({
          providers: {
            discovery: ['fixture', 'searchapi'],
            verification: ['searchapi'],
            discoveryRefreshHours: { fixture: 168, searchapi: 168 },
          },
        })}
        providers={withTestSource}
        debounceMs={0}
      />,
      { search: '?view=definitions&edit=def-0001' },
    );
    const test = screen.getByRole('checkbox', { name: `The test source · ${N.sourceInSearch}` });
    const sa = screen.getByRole('checkbox', { name: `SearchApi · ${N.sourceInSearchUnset}` });
    expect(test).toBeChecked();
    expect(sa).toBeChecked();
    // SearchApi is still named in the not-set-up sentence
    expect(screen.getByRole('group', { name: N.whereToLook })).toHaveTextContent(
      "SearchApi isn't set up yet",
    );
    await user.click(sa);
    await waitFor(() =>
      expect(estimates.at(-1)).toMatchObject({ providers: { discovery: ['fixture'], verification: [] } }),
    );
    expect(screen.queryByRole('checkbox', { name: /^SearchApi · / })).toBeNull();
  });
});

describe('Edit shares the form (Ruling 13)', () => {
  it('adds Limits and checks with the rest of the old More options, and keeps the search’s own sources', async () => {
    serve();
    const { user } = renderEdit(
      definition({
        providers: {
          discovery: ['searchapi'],
          verification: ['searchapi'],
          discoveryRefreshHours: { searchapi: 24 },
        },
      }),
    );
    // its own sources, not the preset's
    expect(source(SEARCHAPI)).toBeChecked();
    expect(source(BROWSER)).not.toBeChecked();
    expect(source(CACHE)).not.toBeChecked();
    const limits = screen.getByText(N.limitsHeading).closest('details');
    expect(limits).not.toHaveAttribute('open');
    await user.click(screen.getByText(N.limitsHeading));
    const D = SETUP_COPY.definitions;
    for (const label of [
      COPY.maxCalls,
      D.maxCells,
      D.topN,
      'How often to ask Google Flights via SearchApi again (hours)',
    ])
      expect(limits?.contains(screen.getByLabelText(label))).toBe(true);
    expect(within(limits ?? document.body).getByText(COPY.constraintsHeading)).toBeInTheDocument();
    // the schedule picker, its time zone and the enabled switch are not here: Repeat is
    expect(screen.queryByLabelText(SETUP_COPY.schedule.repeat)).toBeNull();
    expect(screen.queryByLabelText('Time zone')).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /^Enabled/ })).toBeNull();
  });
});
