// The set-up polish pass on Providers, Alerts, Status, History and the definition selector (critique 2026-10-26).
// The worked example only.
import { screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { DefinitionSelector } from '../../src/components/DefinitionSelector.js';
import { SETUP_COPY } from '../../src/copy/setup.js';
import { COPY } from '../../src/copy.js';
import { AlertsView } from '../../src/views/Alerts/index.js';
import { HistoryView } from '../../src/views/History/HistoryView.js';
import { ProvidersView } from '../../src/views/Providers/ProvidersView.js';
import { StatusView } from '../../src/views/Status.js';
import { API, definition, providersResponse, resultsResponse, statusReport } from '../fixtures.js';
import { fetchPoint, routeHistory, runsAt } from '../fixtures.wp10.js';
import { server } from '../msw/server.js';
import { drawn, renderWithProviders } from '../render.js';

const P = SETUP_COPY.providers;

describe('Providers', () => {
  it('with no source set up, says what each one is, what it costs and where to set it up', async () => {
    server.use(http.get(`${API}/providers`, () => HttpResponse.json(providersResponse({ providers: [] }))));
    renderWithProviders(<ProvidersView />);
    const empty = await screen.findByRole('region', { name: P.emptyHeading });
    expect(within(empty).getByRole('heading', { name: P.emptyHeading })).toBeInTheDocument();
    expect(within(empty).getByText(P.emptyLead)).toBeInTheDocument();
    const items = within(empty).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    for (const [i, source] of P.sources.entries()) {
      const item = items[i];
      if (item === undefined) throw new Error(`no item ${i}`);
      expect(item).toHaveTextContent(source.name);
      expect(item).toHaveTextContent(source.what);
      expect(item).toHaveTextContent(source.cost);
      expect(within(item).getByText(source.command)).toBeInTheDocument();
      expect(item).toHaveTextContent(source.doc);
    }
    expect(empty).toHaveTextContent('docs/setup.md section 2');
    expect(empty).toHaveTextContent('docs/setup.md section 14');
  });

  it("explains each card's compact mark and the vendor's unknown cache age where they appear", async () => {
    renderWithProviders(<ProvidersView />);
    const searchapi = await screen.findByRole('region', { name: 'SearchApi' });
    expect(within(searchapi).getByText(P.markLine('SA'))).toBeInTheDocument();
    expect(within(searchapi).getByText(P.ageUnknownHint)).toBeInTheDocument();
    const tp = screen.getByRole('region', { name: 'Travelpayouts' });
    expect(within(tp).getByText(P.markLine('TP'))).toBeInTheDocument();
    // Travelpayouts states its age, so the unknown-age note is not repeated on its card
    expect(within(tp).queryByText(P.ageUnknownHint)).toBeNull();
    expect(screen.getByText(P.intro)).toBeInTheDocument();
  });
});

describe('Alerts', () => {
  it('the heading matches every other view, and every rule field has a visible box', async () => {
    renderWithProviders(<AlertsView definitionId="def-1" />);
    expect(await screen.findByRole('heading', { level: 2, name: COPY.alertsView.heading })).toHaveClass(
      'text-xl',
      'font-semibold',
    );
    const form = screen.getByRole('form', { name: COPY.alertsView.formLabel });
    const fields = [
      ...within(form).getAllByRole('combobox'),
      within(form).getByLabelText(COPY.alertsView.threshold),
      within(form).getByLabelText(COPY.alertsView.cooldown),
    ];
    expect(fields.length).toBeGreaterThanOrEqual(4);
    for (const f of fields) expect(f).toHaveClass('border', 'border-slate-400', 'min-h-11');
    // the labels stay visible text, not only accessible names
    expect(within(form).getByText(COPY.alertsView.threshold)).toBeVisible();
  });
});

describe('Status', () => {
  it("a search's Data card shows the search's name, not only in its accessible name", async () => {
    server.use(
      http.get(`${API}/status`, () =>
        HttpResponse.json(
          statusReport([
            {
              id: 'data-a1',
              area: 'data',
              label: 'London to New York',
              state: 'ok',
              summary: 'last run fine',
            },
          ]),
        ),
      ),
    );
    renderWithProviders(<StatusView />);
    const card = await screen.findByRole('region', { name: 'Data, London to New York' });
    expect(within(card).getByRole('heading', { name: 'London to New York' })).toBeVisible();
  });
});

describe('History', () => {
  it('the runs shown and the runs named in the header agree, and the line says why one has no price here', async () => {
    // four runs; this route has prices from three of them (the run 300h ago fetched nothing for it)
    server.use(
      http.get(`${API}/definitions/:id/results`, () =>
        HttpResponse.json(resultsResponse({ executions: runsAt(2, 170, 300, 500) })),
      ),
      http.get(`${API}/routes/:origin/:destination/history`, () =>
        HttpResponse.json(
          routeHistory({
            calendarSeries: [
              {
                providerId: 'travelpayouts',
                cabin: 'economy',
                points: [fetchPoint(500, 45000), fetchPoint(2, 39900), fetchPoint(170, 42000)],
              },
            ],
          }),
        ),
      ),
    );
    renderWithProviders(<HistoryView definition={definition()} />);
    await drawn(await screen.findByRole('figure', { name: COPY.historyView.fetchChartTitle }));
    expect(screen.getByText(COPY.spanExecutions(4, 0))).toBeInTheDocument();
    const line = screen.getByText('3 runs shown, 23 Sep 2026 to 14 Oct 2026').closest('p');
    expect(line).toHaveTextContent(
      '3 runs shown, 23 Sep 2026 to 14 Oct 2026. 1 of the 4 runs named above has no price for this route.',
    );
  });

  it("counts only this search's runs: a point from another search's run on the same pair is not one of them", async () => {
    server.use(
      http.get(`${API}/definitions/:id/results`, () =>
        HttpResponse.json(resultsResponse({ executions: runsAt(2, 170, 300, 500) })),
      ),
      http.get(`${API}/routes/:origin/:destination/history`, () =>
        HttpResponse.json(
          routeHistory({
            calendarSeries: [
              {
                providerId: 'travelpayouts',
                cabin: 'economy',
                // exec-400 belongs to another search; exec-300 of this one has no point
                points: [
                  fetchPoint(500, 45000),
                  fetchPoint(400, 44000),
                  fetchPoint(2, 39900),
                  fetchPoint(170, 42000),
                ],
              },
            ],
          }),
        ),
      ),
    );
    renderWithProviders(<HistoryView definition={definition()} />);
    await drawn(await screen.findByRole('figure', { name: COPY.historyView.fetchChartTitle }));
    expect(
      screen.getByText(SETUP_COPY.history.runsWithoutPrice(1, 4, 'route'), { exact: false }),
    ).toBeInTheDocument();
  });

  it('with runs but no price at all, it still says how many runs have none', async () => {
    server.use(
      http.get(`${API}/definitions/:id/results`, () =>
        HttpResponse.json(resultsResponse({ executions: runsAt(2, 170) })),
      ),
      http.get(`${API}/routes/:origin/:destination/history`, () =>
        HttpResponse.json(routeHistory({ calendarSeries: [] })),
      ),
    );
    renderWithProviders(<HistoryView definition={definition()} />);
    expect(await screen.findByText(SETUP_COPY.history.runsWithoutPrice(2, 2, 'route'))).toBeInTheDocument();
  });

  it('the route select does not stretch the full width', async () => {
    renderWithProviders(<HistoryView definition={definition()} />);
    expect(await screen.findByLabelText(COPY.historyView.routePicker)).toHaveClass('max-w-full');
    expect(screen.getByLabelText(COPY.historyView.routePicker).closest('label')).toHaveClass('max-w-xs');
  });
});

describe('the definition selector at 375 px', () => {
  it('can shrink inside the header, so a long search name never widens the page', () => {
    renderWithProviders(
      <DefinitionSelector
        definitions={[definition({ name: 'London to New York, ten to twenty-one nights, economy, weekly' })]}
        selectedId="def-0001"
      />,
    );
    const select = screen.getByLabelText(COPY.definitionSelectorLabel);
    expect(select).toHaveClass('min-w-0', 'max-w-full');
    expect(select.parentElement).toHaveClass('min-w-0', 'max-w-full');
  });
});
