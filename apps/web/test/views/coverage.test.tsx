import { screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { COPY } from '../../src/copy.js';
import { CoverageView } from '../../src/views/Coverage/CoverageView.js';
import { API, coverageResponse, definition, execution } from '../fixtures.js';
import { server } from '../msw/server.js';
import { renderWithProviders } from '../render.js';

const rowTexts = (table: HTMLElement) =>
  within(table)
    .getAllByRole('row')
    .slice(1)
    .map((r) => [...r.querySelectorAll('th, td')].map((c) => c.firstChild?.textContent ?? ''));

function withStage(patch: Partial<ReturnType<typeof coverageResponse>['perStage'][number]>) {
  const base = coverageResponse();
  const [first, ...rest] = base.perStage;
  if (first === undefined) throw new Error('fixture');
  return { ...base, perStage: [{ ...first, ...patch }, ...rest] };
}

const render = () => renderWithProviders(<CoverageView definition={definition()} />);

describe('View D (spec §11, §6.6)', () => {
  it('lists each on-demand itinerary search below the parent run, with its own buckets and ledger calls (UI-004, ruling 15)', async () => {
    server.use(
      http.get(`${API}/definitions/:id/coverage`, () =>
        HttpResponse.json(
          coverageResponse({
            onDemand: [
              {
                executionId: 'child-1',
                status: 'completed',
                startedAt: '2026-10-14T13:41:00.000Z',
                cell: {
                  origin: 'LHR',
                  destination: 'JFK',
                  departureDate: '2027-03-05',
                  returnDate: '2027-03-15',
                  nights: 10,
                },
                perStage: [
                  {
                    stage: 'verification',
                    providerId: 'searchapi',
                    // why: a different count in every bucket, so a swapped or shifted column cannot read as right
                    buckets: { priced: 1, empty: 2, no_data: 3, error: 4, skipped: 5, not_run: 6, reused: 0 },
                    total: 21,
                    requests: { calls: 3, cacheHits: 0, costMicroGbp: 0 },
                  },
                ],
              },
            ],
          }),
        ),
      ),
    );
    render();
    const table = await screen.findByRole('table', { name: COPY.coverageOnDemandHeading });
    const [row] = within(table).getAllByRole('row').slice(1);
    expect(row).toHaveTextContent('LHR → JFK');
    expect(row).toHaveTextContent('itinerary search');
    expect(row).toHaveTextContent('SearchApi');
    expect(row).toHaveTextContent('completed');
    expect(row).toHaveTextContent('3 calls');
    // why: its own buckets, in the column order of the table's header (priced, no fares, no cached data, error, skipped, not searched)
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers.slice(4, 10)).toEqual([
      'priced',
      'no fares',
      'no cached data',
      'error',
      'skipped',
      'not searched',
    ]);
    expect([...(row?.querySelectorAll('td') ?? [])].slice(3, 9).map((c) => c.textContent)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
    ]);
  });

  it('says when no on-demand search has run', async () => {
    render();
    expect(await screen.findByText(COPY.coverageOnDemandNone)).toBeInTheDocument();
  });

  it('counts per stage × provider in the six buckets, with cells, "searched", "with a price" and estimate vs ledger', async () => {
    render();
    const table = await screen.findByRole('table', { name: 'Coverage' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual([
      'Stage',
      'Provider',
      'priced',
      'no fares',
      'no cached data',
      'error',
      'skipped',
      'not searched',
      'cells',
      'searched (priced + no fares + no cached data)',
      'with a price',
      'Requests (estimate vs ledger)',
    ]);
    expect(rowTexts(table)).toEqual([
      [
        'discovery',
        'Travelpayouts',
        '60',
        '10',
        '40',
        '6',
        '0',
        '10',
        '126',
        '110',
        '60 of 126',
        // why: cost-008: discovery is planned and judged in tiles (decision 43), so its line says tiles, calls beside.
        '14 of 14 planned tiles (14 calls) · 0 cache hits · ledger cost £0, from configured rates',
      ],
      [
        'itinerary search',
        'SearchApi',
        '8',
        '1',
        '0',
        '1',
        '116',
        '0',
        '126',
        '9',
        '8 of 126',
        '50 of 50 planned calls · 0 cache hits · ledger cost £0, from configured rates',
      ],
    ]);
  });

  it('the table scrolls sideways in a labelled region, and a legend defines every bucket (review UI-6)', async () => {
    render();
    const region = await screen.findByRole('region', {
      name: 'Coverage counts (scrolls sideways on a narrow screen)',
    });
    // why: decision 46: a labelled region without tabIndex; the browser makes the scroll box focusable itself.
    expect(region).not.toHaveAttribute('tabindex');
    expect(region.className).toContain('overflow-x-auto');
    const legend = screen.getByRole('list', { name: 'What the columns mean' });
    expect(
      within(legend).getByText('not searched: not asked yet. Different from no fares: nobody has looked.'),
    ).toBeInTheDocument();
    expect(
      within(legend).getByText(
        'no cached data: asked, nothing returned; this is not evidence that no flights exist.',
      ),
    ).toBeInTheDocument();
  });

  it('the header names the run these counts come from, with its own status and age', async () => {
    server.use(
      http.get(`${API}/executions/:id`, () =>
        HttpResponse.json(execution({ status: 'running', startedAt: '2026-10-14T14:00:00.000Z' })),
      ),
    );
    render();
    expect(
      await screen.findByText('showing run started 14 Oct 2026 15:00 Europe/London (running, 1h ago)'),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'The latest run is running; these results may be partial.',
    );
  });

  it('a run older than the refresh cycle is labelled stale', async () => {
    server.use(
      http.get(`${API}/executions/:id`, () =>
        HttpResponse.json(
          execution({
            status: 'completed',
            startedAt: '2026-10-01T00:00:00.000Z',
            finishedAt: '2026-10-01T01:00:00.000Z',
          }),
        ),
      ),
    );
    render();
    expect(await screen.findByText('Every row here is older than one refresh cycle.')).toBeInTheDocument();
  });

  it('View D sums: six buckets that do not add up to the cell count are flagged, never hidden', async () => {
    const first = coverageResponse().perStage[0];
    if (first === undefined) throw new Error('fixture');
    server.use(
      http.get(`${API}/definitions/:id/coverage`, () =>
        HttpResponse.json(withStage({ buckets: { ...first.buckets, not_run: 9 } })),
      ),
    );
    render();
    expect(await screen.findByRole('alert')).toHaveTextContent('buckets sum to 125, not 126; report this');
  });

  it('no sum alert when the six buckets add up', async () => {
    render();
    await screen.findByRole('table', { name: 'Coverage' });
    expect(screen.queryByText(/buckets sum to/)).toBeNull();
  });

  it('an empty state when no run exists yet', async () => {
    server.use(
      http.get(`${API}/definitions/:id/coverage`, () =>
        HttpResponse.json(coverageResponse({ perStage: [], selectedNotReached: [], errors: [] })),
      ),
    );
    render();
    expect(await screen.findByText('No run yet, so nothing has been searched.')).toBeInTheDocument();
    expect(screen.getByText('Every selected cell was reached.')).toBeInTheDocument();
    expect(screen.getByText('No errors.')).toBeInTheDocument();
  });

  it('says why the browser provider left cells for the next scheduled run, in each detail’s own text (spec §3 rev 36)', async () => {
    server.use(
      http.get(`${API}/definitions/:id/coverage`, () =>
        HttpResponse.json(
          coverageResponse({
            scheduledOnly: [
              { stage: 'discovery', providerId: 'camoufox', detail: 'catch-up-no-browser', cells: 1 },
              { stage: 'discovery', providerId: 'camoufox', detail: 'outside-browser-window', cells: 12 },
            ],
          }),
        ),
      ),
    );
    render();
    const list = await screen.findByRole('list', { name: 'Left for the next scheduled run' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      `${COPY.provider.camoufox} (${COPY.stageName.discovery}): 1 cell left: a catch-up loads no browser pages`,
      `${COPY.provider.camoufox} (${COPY.stageName.discovery}): 12 cells left: outside this run's browser window`,
    ]);
  });

  it.each([
    ['next-run', 'Left for your next run of this search'],
    ['no-longer-used', 'Not fetched: this search no longer uses the browser provider'],
  ] as const)(
    'the list is headed by who fetches the cells as the api reads it now (%s; R12, S6)',
    async (leftFor, heading) => {
      server.use(
        http.get(`${API}/definitions/:id/coverage`, () =>
          HttpResponse.json(
            coverageResponse({
              scheduledOnly: [
                { stage: 'discovery', providerId: 'camoufox', detail: 'outside-browser-window', cells: 3 },
              ],
              browserLeftFor: leftFor,
            }),
          ),
        ),
      );
      render();
      expect(await screen.findByRole('list', { name: heading })).toBeInTheDocument();
      expect(screen.queryByRole('list', { name: 'Left for the next scheduled run' })).toBeNull();
    },
  );

  it('S8: a skipped firing as the latest run: the header names its firing and why it was not caught up, as History does', async () => {
    server.use(
      http.get(`${API}/executions/:id`, () =>
        HttpResponse.json(
          execution({
            status: 'skipped_missed',
            startedAt: null,
            finishedAt: '2027-03-07T05:30:00.000Z',
            trigger: 'schedule',
            scheduledFor: '2027-03-01T06:00:00.000Z',
            skipCode: 'half-cadence',
          }),
        ),
      ),
    );
    render();
    expect(
      await screen.findByText(
        'showing run scheduled for 1 Mar 2027 06:00 Europe/London (skipped: missed and not caught up: the next scheduled run was less than half the gap away)',
      ),
    ).toBeInTheDocument();
  });

  it('shows no scheduled-run list when no cell was left for it', async () => {
    render();
    await screen.findByRole('table', { name: 'Coverage' });
    expect(screen.queryByRole('list', { name: 'Left for the next scheduled run' })).toBeNull();
  });

  it('maps both selected-but-not-reached reasons to words', async () => {
    const base = coverageResponse();
    const first = base.selectedNotReached[0];
    if (first === undefined) throw new Error('fixture');
    server.use(
      http.get(`${API}/definitions/:id/coverage`, () =>
        HttpResponse.json({
          ...base,
          selectedNotReached: [
            first,
            { ...first, cell: { ...first.cell, departureDate: '2027-03-22' }, reason: 'not_run' },
          ],
        }),
      ),
    );
    render();
    const list = await screen.findByRole('list', { name: 'Selected but not reached' });
    expect(within(list).getByText('LHR → JFK 22 Mar 2027 to 1 Apr 2027: not searched')).toBeInTheDocument();
    expect(
      within(list).getByText('LHR → JFK 20 Mar 2027 to 1 Apr 2027: skipped: budget'),
    ).toBeInTheDocument();
  });

  it('overrun and parity flags appear on their stage row only when set; reused cells are noted', async () => {
    const { unmount } = render();
    await screen.findByRole('table', { name: 'Coverage' });
    expect(screen.queryByText(/Overrun/)).toBeNull();
    expect(screen.queryByText(/Parity break/)).toBeNull();
    unmount();
    const flagged = withStage({ overrun: true, parityBreak: true });
    server.use(
      http.get(`${API}/definitions/:id/coverage`, () =>
        HttpResponse.json({ ...flagged, summary: { ...flagged.summary, reused: 4 } }),
      ),
    );
    render();
    // why: withStage patches the discovery row only, so the flags must sit in that row and in no other
    const table = await screen.findByRole('table', { name: 'Coverage' });
    const [discovery, itinerary] = within(table).getAllByRole('row').slice(1);
    if (discovery === undefined || itinerary === undefined) throw new Error('two stage rows');
    expect(discovery).toHaveTextContent('Overrun: tiles requested exceed the plan by more than 10%.');
    expect(discovery).toHaveTextContent('Parity break: tile requests differ from the plan.');
    expect(itinerary).not.toHaveTextContent(/Overrun|Parity break/);
    expect(screen.getByText('(4 reused from earlier runs)')).toBeInTheDocument();
  });

  it('lists errors and retries the retryable ones through POST /api/executions/:id/resume', async () => {
    const resumed: string[] = [];
    server.use(
      http.post(`${API}/executions/:id/resume`, ({ params }) => {
        resumed.push(String(params.id));
        return HttpResponse.json(execution());
      }),
    );
    const { user } = render();
    const errors = await screen.findByRole('list', { name: 'Errors' });
    expect(within(errors).getByRole('listitem')).toHaveTextContent(
      'LGW → EWR 21 Mar 2027 to 2 Apr 2027: rate-limit after 3 attempts (HTTP 429)',
    );
    await user.click(screen.getByRole('button', { name: 'Retry errors' }));
    await expect.poll(() => resumed).toEqual(['exec-0001']);
  });

  it('no Retry button when no error is retryable', async () => {
    const base = coverageResponse();
    server.use(
      http.get(`${API}/definitions/:id/coverage`, () =>
        HttpResponse.json({
          ...base,
          errors: base.errors.map((e) => ({ ...e, retryable: false, lastError: null })),
        }),
      ),
    );
    render();
    await screen.findByRole('list', { name: 'Errors' });
    expect(screen.queryByRole('button', { name: 'Retry errors' })).toBeNull();
  });

  it('an error with no recorded reason says so instead of printing nothing (contract: reason is nullable)', async () => {
    const base = coverageResponse();
    server.use(
      http.get(`${API}/definitions/:id/coverage`, () =>
        HttpResponse.json({ ...base, errors: base.errors.map((e) => ({ ...e, reason: null })) }),
      ),
    );
    render();
    const errors = await screen.findByRole('list', { name: 'Errors' });
    expect(within(errors).getByRole('listitem')).toHaveTextContent('no reason recorded after 3 attempts');
  });

  it('a failed load of the run the counts come from shows the reason and a retry, never counts without their run (CodeRabbit batch 3)', async () => {
    let fail = true;
    server.use(
      http.get(`${API}/executions/:id`, () =>
        fail
          ? HttpResponse.json({ error: { code: 'internal', message: 'run boom' } }, { status: 500 })
          : HttpResponse.json(execution({ status: 'completed' })),
      ),
    );
    const { user } = render();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load: run boom');
    expect(screen.queryByRole('table', { name: COPY.coverageHeading })).not.toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('table', { name: COPY.coverageHeading })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a failed load shows the reason and a retry', async () => {
    server.use(
      http.get(`${API}/definitions/:id/coverage`, () =>
        HttpResponse.json({ error: { code: 'internal', message: 'boom' } }, { status: 500 }),
      ),
    );
    render();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load: boom');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
