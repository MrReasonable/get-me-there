import { screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { App } from '../../../src/App.js';
import { PLAN_COPY } from '../../../src/copy/plan.js';
import { COPY } from '../../../src/copy.js';
import { EXAMPLE_LABEL } from '../../../src/example.js';
import { DefinitionsView } from '../../../src/views/Definitions/DefinitionsView.js';
import { API, coverageCheck, definition, estimateResponse, providersResponse } from '../../fixtures.js';
import { server } from '../../msw/server.js';
import { renderWithProviders } from '../../render.js';

const importButton = `Import example (${EXAMPLE_LABEL})`;
/** The coverage check, the example import and the notices belong to the Edit page (spec rev 55 §11 Edit). */
const EDIT = '?view=definitions&edit=def-0001';

describe('coverage check before saving (spec §1, §10, §11)', () => {
  it('posts the entered pairs, window and nights and shows cached cells of cells in band per pair per month', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API}/definitions/coverage-check`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(coverageCheck());
      }),
    );
    const { user } = renderWithProviders(<DefinitionsView />, { search: EDIT });
    await user.click(await screen.findByRole('button', { name: importButton }));
    await user.click(screen.getByRole('button', { name: 'Check free coverage' }));
    const table = await screen.findByRole('table', { name: 'Check free coverage' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Month', '2027-03', '2027-04']);
    expect(
      [...(within(table).getAllByRole('row')[1]?.querySelectorAll('th, td') ?? [])].map((c) => c.textContent),
    ).toEqual(['LHR → JFK', '5 of 372', '0 of 360']);
    expect(screen.getByText('14 free tile requests used')).toBeInTheDocument();
    expect(bodies).toEqual([
      {
        origins: ['LHR', 'LGW'],
        destinations: ['JFK', 'EWR'],
        window: { kind: 'relative', startOffsetDays: 7, lengthDays: 182 },
        minNights: 10,
        maxNights: 21,
      },
    ]);
  });

  it('a month the check could not read, or did not return for a pair, is "not checked", never 0 (decision 25)', async () => {
    server.use(
      http.post(`${API}/definitions/coverage-check`, () =>
        HttpResponse.json(
          coverageCheck({
            pairs: [
              {
                origin: 'LHR',
                destination: 'JFK',
                months: [
                  { month: '2027-03', cachedRows: null, cellsInBand: 372 },
                  { month: '2027-04', cachedRows: 0, cellsInBand: 360 },
                ],
              },
              {
                origin: 'LGW',
                destination: 'JFK',
                months: [{ month: '2027-04', cachedRows: 2, cellsInBand: 360 }],
              },
            ],
            notes: ['the 2027-03 tile for LHR → JFK failed: rate-limit'],
          }),
        ),
      ),
    );
    const { user } = renderWithProviders(<DefinitionsView />, { search: EDIT });
    await user.click(await screen.findByRole('button', { name: importButton }));
    await user.click(screen.getByRole('button', { name: 'Check free coverage' }));
    const table = await screen.findByRole('table', { name: 'Check free coverage' });
    const cells = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((r) => [...r.querySelectorAll('td')].map((c) => c.textContent));
    expect(cells).toEqual([
      ['not checked', '0 of 360'],
      ['not checked', '2 of 360'],
    ]);
    expect(within(table).getAllByText('not checked')[0]).toHaveClass('italic');
    expect(screen.getByText('the 2027-03 tile for LHR → JFK failed: rate-limit')).toBeInTheDocument();
  });

  it('a check made for other airports or dates is marked out of date', async () => {
    const { user } = renderWithProviders(<DefinitionsView />, { search: EDIT });
    await user.click(await screen.findByRole('button', { name: importButton }));
    await user.click(screen.getByRole('button', { name: 'Check free coverage' }));
    await screen.findByRole('table', { name: 'Check free coverage' });
    expect(screen.queryByText(/changed since this check/)).toBeNull();
    await user.clear(screen.getByLabelText('Longest stay'));
    await user.type(screen.getByLabelText('Longest stay'), '14');
    expect(
      screen.getByText('The airports, window or nights changed since this check; run it again.'),
    ).toBeInTheDocument();
  });

  it('editing while the check is in flight marks the answer out of date: it describes the body that was sent', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(`${API}/definitions/coverage-check`, async () => {
        await gate;
        return HttpResponse.json(coverageCheck());
      }),
    );
    const { user } = renderWithProviders(<DefinitionsView />, { search: EDIT });
    await user.click(await screen.findByRole('button', { name: importButton }));
    await user.click(screen.getByRole('button', { name: 'Check free coverage' }));
    await user.clear(screen.getByLabelText('Longest stay'));
    await user.type(screen.getByLabelText('Longest stay'), '14');
    release();
    await screen.findByRole('table', { name: 'Check free coverage' });
    expect(
      screen.getByText('The airports, window or nights changed since this check; run it again.'),
    ).toBeInTheDocument();
  });

  it('says what it needs when Travelpayouts is not configured', async () => {
    const base = providersResponse();
    server.use(
      http.get(`${API}/providers`, () =>
        HttpResponse.json({
          ...base,
          providers: base.providers.map((p) =>
            p.providerId === 'travelpayouts' ? { ...p, enabled: false } : p,
          ),
        }),
      ),
    );
    renderWithProviders(<DefinitionsView />, { search: EDIT });
    expect(await screen.findByText('The free coverage check needs TRAVELPAYOUTS_TOKEN.')).toBeInTheDocument();
  });
});

describe('the budget fit under More options (spec rev 55 §11)', () => {
  it('a budgetFit miss is shown as an alert beside the monthly figures', async () => {
    server.use(
      http.post(`${API}/definitions/estimate`, () =>
        HttpResponse.json(
          estimateResponse({
            budgetFit: {
              fits: false,
              runsPerMonth: 4,
              perScope: [{ scope: 'provider-month:searchapi', estimated: 12000, cap: 10000, fits: false }],
            },
          }),
        ),
      ),
    );
    const { user } = renderWithProviders(<DefinitionsView />, { search: EDIT });
    await user.click(await screen.findByText(PLAN_COPY.moreOptions));
    const alert = await screen.findByText('Does not fit every cap at 4 runs a month:');
    expect(alert.parentElement).toHaveAttribute('role', 'alert');
    expect(alert.parentElement).toHaveTextContent(
      'provider-month:searchapi: 12000 estimated a month, cap 10000over the cap',
    );
  });
});

describe('saved definitions (spec §8.1)', () => {
  it("shows the definition's notices from the API", async () => {
    server.use(
      http.get(`${API}/definitions`, () =>
        HttpResponse.json([definition({ notices: ['alerts running on calendar basis only'] })]),
      ),
    );
    renderWithProviders(<DefinitionsView />, { search: '?view=definitions&edit=def-0001' });
    const list = await screen.findByRole('list', { name: 'Notices for this definition' });
    expect(within(list).getByText('alerts running on calendar basis only')).toBeInTheDocument();
  });

  it('an edit= link to a definition that does not exist says so instead of showing a blank create form', async () => {
    renderWithProviders(<DefinitionsView />, { search: '?view=definitions&edit=no-such-definition' });
    expect(await screen.findByRole('alert')).toHaveTextContent(PLAN_COPY.notFound);
    // why: no form behind a dead link: nothing to estimate, start or save
    expect(screen.queryByRole('button', { name: /^Search now/ })).toBeNull();
    expect(screen.queryByRole('button', { name: COPY.editSearch.save })).toBeNull();
  });

  it('edit=new and an existing definition show no not-found alert', async () => {
    const first = renderWithProviders(<DefinitionsView />, { search: '?view=definitions&edit=new' });
    await screen.findByRole('button', { name: /^Search now/ });
    expect(screen.queryByText(PLAN_COPY.notFound)).toBeNull();
    first.unmount();
    renderWithProviders(<DefinitionsView />, { search: EDIT });
    await screen.findByRole('button', { name: COPY.editSearch.save });
    expect(screen.queryByText(PLAN_COPY.notFound)).toBeNull();
  });

  it('a failed definitions load shows the reason and a retry', async () => {
    server.use(
      http.get(`${API}/definitions`, () =>
        HttpResponse.json({ error: { code: 'internal', message: 'boom' } }, { status: 500 }),
      ),
    );
    renderWithProviders(<DefinitionsView />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load: boom');
  });
});

describe('the App (spec §11 layout)', () => {
  it('filter state persists across a view switch, and the status bar is on every view', async () => {
    const { user } = renderWithProviders(<App />, {
      search: '?view=results&def=def-0001&depart=2027-03-14&return=2027-03-28&f.class=partially-verified',
    });
    const table = await screen.findByRole('table', { name: 'Round trips found' });
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    const nav = screen.getByRole('navigation', { name: 'Views' });
    await user.click(within(nav).getByRole('link', { name: 'Providers' }));
    expect(await screen.findByRole('heading', { name: 'Providers' })).toBeInTheDocument();
    // why: ruling R-bar — the bar always carries the month's spend, whichever view is open
    expect(await screen.findByRole('region', { name: COPY.monthSpendLabel })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Run now/ })).toBeNull();
    // why: WP19 Task 19.7: the detail is not in the nav; a card's See dates opens the search's page (WP20 Task 20.3), and a
    // board row opens the detail again
    await user.click(within(nav).getByRole('link', { name: 'Searches' }));
    await user.click(await screen.findByRole('link', { name: /^See dates for / }));
    const board = await screen.findByRole('table', { name: /^Best dates/ });
    const [first] = within(board).getAllByRole('row').slice(1);
    if (first === undefined) throw new Error('the board has a row');
    await user.click(within(first).getAllByRole('link')[0] ?? first);
    const again = await screen.findByRole('table', { name: 'Round trips found' });
    expect(within(again).getAllByRole('row')).toHaveLength(2);
    expect(screen.getByRole('checkbox', { name: 'partially verified' })).toBeChecked();
  });

  it('with /providers synthetic and real rows the red banner shows once (spec §5.5)', async () => {
    const base = providersResponse();
    const [real] = base.providers;
    if (real === undefined) throw new Error('the providers fixture has a real provider');
    // why: the mixed case the title names: the fixture provider (synthetic source kind) listed beside the real ones
    const fixtureRow = {
      ...real,
      providerId: 'fixture' as const,
      displayName: 'Fixture',
      plan: 'synthetic' as const,
      capNote: null,
      usage: [],
      capabilities: {
        discovery: {
          sourceKind: 'synthetic' as const,
          provenanceNote: 'synthetic fixture data',
          maxAgeHours: 1,
        },
        verification: null,
      },
    };
    server.use(
      http.get(`${API}/providers`, () =>
        HttpResponse.json(providersResponse({ synthetic: true, providers: [...base.providers, fixtureRow] })),
      ),
    );
    renderWithProviders(<App />, {
      search: '?view=results&def=def-0001&depart=2027-03-14&return=2027-03-28',
    });
    await screen.findByRole('table', { name: 'Round trips found' });
    expect(screen.getAllByText(/Synthetic data: the fixture provider is enabled/)).toHaveLength(1);
  });

  it('with /providers real only (synthetic: false) there is no banner', async () => {
    renderWithProviders(<App />, {
      search: '?view=results&def=def-0001&depart=2027-03-14&return=2027-03-28',
    });
    await screen.findByRole('table', { name: 'Round trips found' });
    expect(screen.queryByText(/Synthetic data: the fixture provider is enabled/)).toBeNull();
  });

  it("the detail's coverage line links to the Dates view's coverage section", async () => {
    renderWithProviders(<App />, {
      search: '?view=results&def=def-0001&depart=2027-03-14&return=2027-03-28',
    });
    expect(await screen.findByRole('link', { name: /^discovery: / })).toHaveAttribute(
      'href',
      '/?view=dates&def=def-0001&d.coverage=open',
    );
  });
});
