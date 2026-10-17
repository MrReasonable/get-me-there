import { screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { App } from '../../../src/App.js';
import { COPY } from '../../../src/copy.js';
import { EXAMPLE_LABEL } from '../../../src/example.js';
import { DefinitionsView } from '../../../src/views/Definitions/DefinitionsView.js';
import { API, coverageCheck, definition, estimate, providersResponse } from '../../fixtures.js';
import { server } from '../../msw/server.js';
import { renderWithProviders } from '../../render.js';

const pricedEstimate = estimate({ totalCostMicroGbp: 12_345, totalCostPence: 2 });
const estimateBody = (budgetFit = definition().budgetFit) => ({ estimate: pricedEstimate, budgetFit });
const importButton = `Import example (${EXAMPLE_LABEL})`;

async function importAndEstimate(user: ReturnType<typeof renderWithProviders>['user']) {
  await user.click(await screen.findByRole('button', { name: importButton }));
  await user.click(screen.getByRole('button', { name: 'Show estimate' }));
}

describe('coverage check before saving (spec §1, §10, §11)', () => {
  it('posts the entered pairs, window and nights and shows cached cells of cells in band per pair per month', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API}/definitions/coverage-check`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(coverageCheck());
      }),
    );
    const { user } = renderWithProviders(<DefinitionsView />, { search: '?view=definitions' });
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
    const { user } = renderWithProviders(<DefinitionsView />);
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
    const { user } = renderWithProviders(<DefinitionsView />);
    await user.click(await screen.findByRole('button', { name: importButton }));
    await user.click(screen.getByRole('button', { name: 'Check free coverage' }));
    await screen.findByRole('table', { name: 'Check free coverage' });
    expect(screen.queryByText(/changed since this check/)).toBeNull();
    await user.clear(screen.getByLabelText('Max nights'));
    await user.type(screen.getByLabelText('Max nights'), '14');
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
    const { user } = renderWithProviders(<DefinitionsView />);
    await user.click(await screen.findByRole('button', { name: importButton }));
    await user.click(screen.getByRole('button', { name: 'Check free coverage' }));
    await user.clear(screen.getByLabelText('Max nights'));
    await user.type(screen.getByLabelText('Max nights'), '14');
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
    renderWithProviders(<DefinitionsView />);
    expect(await screen.findByText('The free coverage check needs TRAVELPAYOUTS_TOKEN.')).toBeInTheDocument();
  });
});

describe('estimate, then the create click as the explicit confirmation (spec §8.1, §11)', () => {
  it('estimates the unsaved body; Create, below the estimate, names calls and pounds and POSTs both confirmation figures', async () => {
    const estimates: unknown[] = [];
    const creates: unknown[] = [];
    server.use(
      http.post(`${API}/definitions/estimate`, async ({ request }) => {
        estimates.push(await request.json());
        return HttpResponse.json(estimateBody());
      }),
      http.post(`${API}/definitions`, async ({ request }) => {
        creates.push(await request.json());
        return HttpResponse.json(
          definition({ id: 'def-0002', confirmedCostPence: 2, estimate: pricedEstimate }),
        );
      }),
    );
    const { user } = renderWithProviders(<DefinitionsView />);
    await importAndEstimate(user);
    const panel = await screen.findByRole('region', { name: 'Estimate' });
    expect(within(panel).getByText('126 cells')).toBeInTheDocument();
    expect(within(panel).getByText('Travelpayouts discovery: 14 calls · £0 · about 20s')).toBeInTheDocument();
    expect(
      within(panel).getByText('about 154 calls (hard stop 2000), £0.02 per run · about 10m'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('provider-month:searchapi: 616 estimated a month, cap 10000'),
    ).toBeInTheDocument();
    expect(estimates[0]).toMatchObject({ origins: ['LHR', 'LGW'], enabled: false });
    expect(estimates[0]).not.toHaveProperty('confirmedCostPence');
    const createButton = screen.getByRole('button', {
      name: 'Create and confirm about 154 calls (hard stop 2000), £0.02 per run',
    });
    // why: the operator sees the breakdown before the amount they confirm (review UI-11).
    expect(panel.compareDocumentPosition(createButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(creates).toEqual([]);
    await user.click(createButton);
    await expect.poll(() => creates.length).toBe(1);
    expect(creates[0]).toMatchObject({
      origins: ['LHR', 'LGW'],
      enabled: false,
      confirmedCostPence: 2,
      confirmedCalls: 154,
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Created. Scheduled runs use the calls and cost you confirmed.',
    );
  });

  it('a half-filled time window disables Create and confirm as well, with the reason beside it (ruling 6)', async () => {
    server.use(http.post(`${API}/definitions/estimate`, () => HttpResponse.json(estimateBody())));
    const { user } = renderWithProviders(<DefinitionsView />);
    await importAndEstimate(user);
    const create = await screen.findByRole('button', { name: /^Create and confirm/ });
    expect(create).toBeEnabled();
    await user.click(screen.getByText('Advanced: constraints and policy'));
    await user.clear(screen.getByLabelText('arrival time window to'));
    expect(create).toBeDisabled();
    expect(create).toHaveAccessibleDescription(
      'Cannot estimate or save: a time window needs both ends, or neither.',
    );
  });

  it('editing after an estimate replaces Create with "show the estimate again" until re-estimated', async () => {
    server.use(http.post(`${API}/definitions/estimate`, () => HttpResponse.json(estimateBody())));
    const { user } = renderWithProviders(<DefinitionsView />);
    await importAndEstimate(user);
    await screen.findByRole('button', { name: /Create and confirm/ });
    await user.clear(screen.getByLabelText('Max nights'));
    await user.type(screen.getByLabelText('Max nights'), '14');
    expect(screen.queryByRole('button', { name: /Create and confirm/ })).toBeNull();
    expect(
      screen.getByText('The draft changed since this estimate; show the estimate again before creating.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show estimate' }));
    expect(await screen.findByRole('button', { name: /Create and confirm/ })).toBeInTheDocument();
  });

  it('editing while the estimate is in flight leaves Create hidden: the estimate is recorded for the draft that was sent', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sent: unknown[] = [];
    server.use(
      http.post(`${API}/definitions/estimate`, async ({ request }) => {
        sent.push(await request.json());
        await gate;
        return HttpResponse.json(estimateBody());
      }),
    );
    const { user } = renderWithProviders(<DefinitionsView />);
    await importAndEstimate(user);
    await expect.poll(() => sent.length).toBe(1);
    // why: the form fields stay editable while the request is in flight
    await user.clear(screen.getByLabelText('Max nights'));
    await user.type(screen.getByLabelText('Max nights'), '14');
    release();
    expect(
      await screen.findByText(
        'The draft changed since this estimate; show the estimate again before creating.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Create and confirm/ })).toBeNull();
  });

  it('Create sends the body that was estimated, with the confirmation of that estimate', async () => {
    const created: unknown[] = [];
    server.use(
      http.post(`${API}/definitions/estimate`, () => HttpResponse.json(estimateBody())),
      http.post(`${API}/definitions`, async ({ request }) => {
        created.push(await request.json());
        return HttpResponse.json(definition());
      }),
    );
    const { user } = renderWithProviders(<DefinitionsView />);
    await importAndEstimate(user);
    await user.click(await screen.findByRole('button', { name: /^Create and confirm/ }));
    await expect.poll(() => created.length).toBe(1);
    expect(created[0]).toMatchObject({ minNights: 10, maxNights: 21, confirmedCalls: 154 });
  });

  it('a budgetFit miss is shown as an alert before the create click', async () => {
    server.use(
      http.post(`${API}/definitions/estimate`, () =>
        HttpResponse.json(
          estimateBody({
            fits: false,
            runsPerMonth: 4,
            perScope: [{ scope: 'provider-month:searchapi', estimated: 12000, cap: 10000, fits: false }],
          }),
        ),
      ),
    );
    const { user } = renderWithProviders(<DefinitionsView />);
    await importAndEstimate(user);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Does not fit every cap at 4 runs a month:');
    expect(alert).toHaveTextContent(
      'provider-month:searchapi: 12000 estimated a month, cap 10000over the cap',
    );
    expect(screen.getByRole('button', { name: /Create and confirm/ })).toBeInTheDocument();
  });
});

describe('saved definitions (spec §8.1)', () => {
  it('a save that raises the estimate above the confirmation asks again with calls and pounds; Confirm PUTs ceil(estimate / 10 000)', async () => {
    const puts: unknown[] = [];
    server.use(
      http.put(`${API}/definitions/:id`, async ({ request }) => {
        puts.push(await request.json());
        return HttpResponse.json(
          puts.length === 1
            ? definition({
                needsConfirmation: {
                  estimateMicroGbp: 2_500_000,
                  totalCalls: 300,
                  confirmedCostPence: 100,
                  confirmedCalls: 154,
                },
              })
            : definition({ confirmedCostPence: 250, confirmedCalls: 300 }),
        );
      }),
    );
    const { user } = renderWithProviders(<DefinitionsView />, { search: '?view=definitions&edit=def-0001' });
    await user.click(await screen.findByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByText(
        'The new estimate, about 300 calls (hard stop 2000) and £2.50 per run, is above what you confirmed (154 calls, £1). Scheduled runs are skipped until you confirm.',
      ),
    ).toBeInTheDocument();
    expect(puts[0]).not.toHaveProperty('confirmedCostPence');
    await user.click(
      screen.getByRole('button', { name: 'Confirm about 300 calls (hard stop 2000), £2.50 per run' }),
    );
    // why: the call trigger comes from the contract's needsConfirmation (decisions 42, 43), never from a stale estimate.
    await expect.poll(() => puts.at(-1)).toEqual({ confirmedCostPence: 250, confirmedCalls: 300 });
  });

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
    expect(await screen.findByRole('alert')).toHaveTextContent(COPY.definitionNotFound);
    // why: no create flow behind a dead link: nothing to estimate or confirm
    expect(screen.queryByRole('button', { name: 'Show estimate' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Create and confirm/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
  });

  it('edit=new and an existing definition show no not-found alert', async () => {
    const first = renderWithProviders(<DefinitionsView />, { search: '?view=definitions&edit=new' });
    await screen.findByRole('button', { name: importButton });
    expect(screen.queryByText(COPY.definitionNotFound)).toBeNull();
    first.unmount();
    renderWithProviders(<DefinitionsView />, { search: '?view=definitions&edit=def-0001' });
    await screen.findByRole('button', { name: 'Save changes' });
    expect(screen.queryByText(COPY.definitionNotFound)).toBeNull();
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
      search: '?view=results&def=def-0001&f.class=partially-verified',
    });
    const table = await screen.findByRole('table', { name: 'Round trips found' });
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    const nav = screen.getByRole('navigation', { name: 'Views' });
    await user.click(within(nav).getByRole('link', { name: 'Providers' }));
    expect(await screen.findByRole('heading', { name: 'Providers' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Run status' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Run now/ })).toBeNull();
    await user.click(within(nav).getByRole('link', { name: 'Results' }));
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
    renderWithProviders(<App />, { search: '?view=results&def=def-0001' });
    await screen.findByRole('table', { name: 'Round trips found' });
    expect(screen.getAllByText(/Synthetic data: the fixture provider is enabled/)).toHaveLength(1);
  });

  it('with /providers real only (synthetic: false) there is no banner', async () => {
    renderWithProviders(<App />, { search: '?view=results&def=def-0001' });
    await screen.findByRole('table', { name: 'Round trips found' });
    expect(screen.queryByText(/Synthetic data: the fixture provider is enabled/)).toBeNull();
  });

  it('Coverage is reachable from the Results header link', async () => {
    const { user } = renderWithProviders(<App />, { search: '?view=results&def=def-0001' });
    await user.click(await screen.findByRole('link', { name: /^discovery: / }));
    expect(await screen.findByRole('table', { name: 'Coverage' })).toBeInTheDocument();
  });
});
