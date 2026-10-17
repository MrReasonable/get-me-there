import { type AlertEventPayload, BANNED_WORD_ALLOWLIST, CONSTRAINT_LABELS, findBannedWords } from '@gmt/core';
import { screen, within } from '@testing-library/react';
import { HttpResponse, http, type JsonBodyType } from 'msw';
import { describe, expect, it } from 'vitest';
import { COPY } from '../../../src/copy.js';
import { AlertsView, describeRule } from '../../../src/views/Alerts/index.js';
import { API, provCalendar, provSearch } from '../../fixtures.js';
import { server } from '../../msw/server.js';
import { renderWithProviders } from '../../render.js';

const C = COPY.alertsView;
const rules = [
  {
    id: 'r1',
    definitionId: 'def-1',
    type: 'absolute',
    thresholdPence: 45000,
    pct: null,
    basis: 'calendar',
    requireAllVerified: null,
    cooldownHours: 336,
    enabled: true,
  },
  {
    id: 'r2',
    definitionId: 'def-1',
    type: 'dropPct',
    thresholdPence: null,
    pct: 10,
    basis: 'verified',
    requireAllVerified: false,
    cooldownHours: 336,
    enabled: true,
  },
] as const;
/** Core's payload shape (decision 56), in its wire form. */
const payload = (
  pricePence: number,
  provenance: unknown,
  extra: Partial<Record<keyof AlertEventPayload, unknown>> = {},
) => ({
  digestId: 'd1',
  executionId: 'ex-1',
  pricePence,
  provenance,
  previous: null,
  isNew: false,
  route: 'LHR→JFK 14 Mar–28 Mar (14n)',
  verdictClass: 'unchecked',
  unverified: [],
  reason: { kind: 'threshold', gapHours: null },
  staleThresholdHours: 216,
  truncated: false,
  notSeenInLatest: null,
  ...extra,
});
const events = [
  {
    id: 1,
    ruleId: 'r1',
    identityKey: 'r1|x',
    observationId: null,
    calendarPriceId: 5,
    dedupKey: 'r1|x|412',
    firedAt: '2026-10-14T05:12:00.000Z',
    status: 'notified',
    reason: '£412 is at or below the £450 threshold',
    payload: payload(41200, provCalendar, { truncated: true }),
  },
  {
    id: 2,
    ruleId: 'r1',
    identityKey: 'r1|x',
    observationId: null,
    calendarPriceId: 6,
    dedupKey: 'r1|x|412',
    firedAt: '2026-10-21T05:10:00.000Z',
    status: 'suppressed',
    reason: 'same price band alerted 7d (168h) ago; cooldown 2w (336h)',
    payload: payload(41250, provCalendar),
  },
  {
    id: 3,
    ruleId: 'r2',
    identityKey: 'r2|y',
    observationId: 9,
    calendarPriceId: null,
    dedupKey: 'r2|y|412',
    firedAt: '2026-10-21T05:11:00.000Z',
    status: 'queued',
    reason: 'down £56 (11%) from £468 fetched 7d (168h) earlier; not delivered: email: connection refused',
    payload: payload(41200, provSearch, {
      verdictClass: 'partially-verified',
      unverified: ['checkedBagRequired'],
      previous: { pricePence: 46800, provenance: provSearch },
      reason: { kind: 'drop', gapHours: 168 },
      staleThresholdHours: 192,
    }),
  },
  {
    id: 4,
    ruleId: 'other-definition-rule',
    identityKey: 'z',
    observationId: null,
    calendarPriceId: 7,
    dedupKey: 'z|1',
    firedAt: '2026-10-21T05:11:00.000Z',
    status: 'notified',
    reason: 'not this definition',
    payload: payload(100, provCalendar),
  },
];

function withData(r: JsonBodyType = rules, e: readonly { ruleId: string }[] = events) {
  server.use(
    http.get(`${API}/alerts`, () => HttpResponse.json(r)),
    // the server filters by definition (alertEventsQuerySchema.definitionId); this handler proves the view asks for it
    http.get(`${API}/alerts/events`, ({ request }) =>
      HttpResponse.json(
        new URL(request.url).searchParams.get('definitionId') === 'def-1'
          ? e.filter((x) => x.ruleId !== 'other-definition-rule')
          : e,
      ),
    ),
  );
}

describe('Alerts at 375 px (spec §11 Accessibility; UI-009)', () => {
  it('the eight-column events table scrolls sideways in its own labelled region, and every button is a 44 px target', async () => {
    withData();
    renderWithProviders(<AlertsView definitionId="def-1" />);
    const table = await screen.findByRole('table', { name: C.eventsTable });
    const region = table.closest('section');
    expect(region).toHaveClass('overflow-x-auto');
    expect(region?.getAttribute('aria-label')).toMatch(/scrolls sideways on a narrow screen/);
    for (const b of screen.getAllByRole('button')) expect(b).toHaveClass('min-h-11');
  });
});

describe('Alerts events list (spec §11; decisions 52, 55, 56)', () => {
  it("shows this definition's events: status in words, the trip, the fare through PriceCell, the reason as a quote", async () => {
    withData();
    renderWithProviders(<AlertsView definitionId="def-1" />);
    const table = await screen.findByRole('table', { name: C.eventsTable });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    const [first, second, third] = rows;
    if (first === undefined || second === undefined || third === undefined) throw new Error('rows');
    expect(within(first).getByText(describeRule({ ...rules[0] }))).toBeInTheDocument();
    expect(within(first).getByText('LHR→JFK 14 Mar–28 Mar (14n)')).toBeInTheDocument();
    expect(within(first).getByTestId('price-cell')).toHaveTextContent('£412');
    // the Constraints column; PriceCell's own detail also says the calendar price is unchecked
    expect(within(first).getAllByRole('cell')[6]).toHaveTextContent(C.classUnchecked);
    expect(within(second).getByText(C.status.suppressed)).toBeInTheDocument();
    expect(
      within(second)
        .getByText('same price band alerted 7d (168h) ago; cooldown 2w (336h)')
        .closest('[data-quote]'),
    ).not.toBeNull();
    expect(screen.queryByText('not this definition')).toBeNull();
  });

  it('the intro promises at most one email per rule each time a run stops, not one per run (review prov-3)', async () => {
    withData();
    renderWithProviders(<AlertsView definitionId="def-1" />);
    expect(await screen.findByText(C.intro)).toHaveTextContent(/each time a run stops/);
    expect(C.intro).not.toMatch(/per run/);
  });

  it('a partially-verified firing names its unverified constraint and shows the previous price through PriceCell too (review PA-3, PA-4)', async () => {
    withData();
    renderWithProviders(<AlertsView definitionId="def-1" />);
    const table = await screen.findByRole('table', { name: C.eventsTable });
    const third = within(table).getAllByRole('row')[3];
    if (third === undefined) throw new Error('row');
    expect(within(third).getByText(C.status.queued)).toBeInTheDocument();
    expect(within(third).getByText(C.classPartial(CONSTRAINT_LABELS.checkedBagRequired))).toBeInTheDocument();
    const prices = within(third).getAllByTestId('price-cell');
    expect(prices.map((p) => p.textContent?.match(/£\d+/)?.[0])).toEqual(['£412', '£468']);
  });

  it('a payload of another shape shows an invalid-record error, no price, and withholds the reason that quotes one', async () => {
    const [sent] = events;
    if (sent === undefined) throw new Error('events');
    const oldShape = { ...sent, payload: { label: 'old shape' } };
    withData(rules, [oldShape]);
    renderWithProviders(<AlertsView definitionId="def-1" />);
    const table = await screen.findByRole('table', { name: C.eventsTable });
    expect(within(table).getAllByText(C.payloadInvalid)).toHaveLength(4);
    expect(within(table).getByText(C.reasonWithheld)).toBeInTheDocument();
    expect(within(table).queryByText(sent.reason)).toBeNull();
    expect(within(table).queryByTestId('price-cell')).toBeNull();
  });

  it('a failed rules load shows the error and a retry, never "no rules"', async () => {
    withData();
    server.use(http.get(`${API}/alerts`, () => HttpResponse.json({ error: 'boom' }, { status: 500 })));
    const { user } = renderWithProviders(<AlertsView definitionId="def-1" />);
    const alert = await screen.findByText(/^Could not load:/);
    expect(alert).toBeInTheDocument();
    expect(screen.queryByText(C.noRules)).toBeNull();
    server.use(http.get(`${API}/alerts`, () => HttpResponse.json(rules)));
    await user.click(screen.getByRole('button', { name: COPY.retryLoad }));
    expect((await screen.findAllByText(describeRule({ ...rules[0] }))).length).toBeGreaterThan(0);
  });

  it('a failed events load shows the error and a retry, never "no alerts have fired"', async () => {
    withData();
    server.use(http.get(`${API}/alerts/events`, () => HttpResponse.json({ error: 'boom' }, { status: 500 })));
    renderWithProviders(<AlertsView definitionId="def-1" />);
    expect(await screen.findByText(/^Could not load:/)).toBeInTheDocument();
    expect(screen.queryByText(C.noEvents)).toBeNull();
    expect(screen.getByRole('button', { name: COPY.retryLoad })).toBeInTheDocument();
  });

  it('a delete that failed is announced and the rule stays listed', async () => {
    withData();
    server.use(http.delete(`${API}/alerts/:id`, () => HttpResponse.json({ error: 'nope' }, { status: 500 })));
    const { user } = renderWithProviders(<AlertsView definitionId="def-1" />);
    const [first] = await screen.findAllByRole('button', { name: C.deleteRule });
    if (first === undefined) throw new Error('delete button');
    await user.click(first);
    expect(await screen.findByText(/^That did not work:/)).toBeInTheDocument();
    expect(screen.getAllByText(describeRule({ ...rules[0] })).length).toBeGreaterThan(0);
  });

  it('empty states', async () => {
    withData([], []);
    renderWithProviders(<AlertsView definitionId="def-1" />);
    expect(await screen.findByText(C.noRules)).toBeInTheDocument();
    expect(await screen.findByText(C.noEvents)).toBeInTheDocument();
  });

  it('no banned word anywhere in the rendered view (spec §11)', async () => {
    withData();
    const { container } = renderWithProviders(<AlertsView definitionId="def-1" />);
    await screen.findByRole('table', { name: C.eventsTable });
    expect(findBannedWords(container.textContent ?? '', BANNED_WORD_ALLOWLIST)).toEqual([]);
  });
});
