import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { COPY } from '../../../src/copy.js';
import { AlertsView } from '../../../src/views/Alerts/index.js';
import { API } from '../../fixtures.js';
import { server } from '../../msw/server.js';
import { renderWithProviders } from '../../render.js';

const C = COPY.alertsView;
let posted: Array<{ body: unknown; xrw: string | null; ct: string | null }> = [];

beforeEach(() => {
  posted = [];
  server.use(
    http.post(`${API}/alerts`, async ({ request }) => {
      const body = await request.json();
      posted.push({
        body,
        xrw: request.headers.get('X-Requested-With'),
        ct: request.headers.get('Content-Type'),
      });
      const rule = {
        id: `rule-${posted.length}`,
        ...(typeof body === 'object' && body !== null ? body : {}),
      };
      return HttpResponse.json(rule, { status: 201 });
    }),
  );
});

describe('Alerts rule form (spec §6.8, §11)', () => {
  it('defaults: absolute rule, itinerary-search basis, cooldown 336 h; deleting keeps history', async () => {
    renderWithProviders(<AlertsView definitionId="def-1" />);
    expect(await screen.findByLabelText(C.cooldown)).toHaveValue(336);
    expect(screen.getByText(C.deleteKeepsHistory)).toBeInTheDocument();
    expect(screen.getByLabelText(C.ruleType)).toHaveValue('absolute');
    expect(screen.getByLabelText(C.basis)).toHaveValue('verified');
    expect(screen.getByLabelText(C.requireAll)).toBeEnabled();
  });

  it('requireAllVerified is disabled on the calendar basis and never sent', async () => {
    const { user } = renderWithProviders(<AlertsView definitionId="def-1" />);
    await user.click(await screen.findByLabelText(C.requireAll));
    await user.selectOptions(screen.getByLabelText(C.basis), 'calendar');
    expect(screen.getByLabelText(C.requireAll)).toBeDisabled();
    await user.type(screen.getByLabelText(C.threshold), '450');
    await user.click(screen.getByRole('button', { name: C.addRule }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({
      body: {
        definitionId: 'def-1',
        type: 'absolute',
        thresholdPence: 45000,
        pct: null,
        basis: 'calendar',
        requireAllVerified: null,
        cooldownHours: 336,
        enabled: true,
      },
      xrw: 'get-me-there',
      ct: 'application/json',
    });
  });

  it('a percentage drop sends pct; pounds with pence convert without floats', async () => {
    const { user } = renderWithProviders(<AlertsView definitionId="def-1" />);
    await user.selectOptions(await screen.findByLabelText(C.ruleType), 'dropPct');
    await user.type(screen.getByLabelText(C.dropPct), '12');
    await user.click(screen.getByRole('button', { name: C.addRule }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]?.body).toEqual({
      definitionId: 'def-1',
      type: 'dropPct',
      thresholdPence: null,
      pct: 12,
      basis: 'verified',
      requireAllVerified: false,
      cooldownHours: 336,
      enabled: true,
    });

    await user.selectOptions(screen.getByLabelText(C.ruleType), 'dropAbs');
    await user.type(screen.getByLabelText(C.threshold), '4.35');
    await user.click(screen.getByRole('button', { name: C.addRule }));
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1]?.body).toMatchObject({ type: 'dropAbs', thresholdPence: 435, pct: null });
  });

  it('invalid input is rejected by alertRuleInputSchema with a field message and nothing is sent', async () => {
    const { user } = renderWithProviders(<AlertsView definitionId="def-1" />);
    await user.type(await screen.findByLabelText(C.threshold), 'abc');
    await user.click(screen.getByRole('button', { name: C.addRule }));
    expect(await screen.findByRole('alert')).toHaveTextContent(C.threshold);
    expect(posted).toHaveLength(0);
  });
});
