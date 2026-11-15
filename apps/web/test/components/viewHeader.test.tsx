import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ViewHeader } from '../../src/components/ViewHeader.js';
import { summary } from '../fixtures.js';
import { renderWithProviders } from '../render.js';

describe('view header (spec §11)', () => {
  it('names the runs by start time with status and age, unknown ages included, and banners a parent run not completed', () => {
    renderWithProviders(
      <ViewHeader
        title="Results"
        stale
        executions={[
          summary({ status: 'running', ageHours: 0, finishedAt: null }),
          summary({ id: 'exec-0000', startedAt: '2026-10-07T12:00:00.000Z', ageHours: 'unknown' }),
        ]}
      />,
    );
    expect(
      screen.getByText(
        'showing run started 14 Oct 2026 13:00 Europe/London (running, just now), run started 7 Oct 2026 13:00 Europe/London (completed, age unknown)',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'The latest run is running; these results may be partial.',
    );
    expect(screen.getByText('stale')).toBeInTheDocument();
  });

  it('no banner when the latest parent run completed, whatever a child run is doing', () => {
    renderWithProviders(
      <ViewHeader
        title="Results"
        stale={false}
        executions={[summary({ id: 'c1', isChild: true, status: 'pending', startedAt: null }), summary()]}
      />,
    );
    expect(screen.queryByRole('status')).toBeNull();
    // why: a run with no start has no age to give (review prov-r2-011).
    expect(
      screen.getByText(/itinerary search for one cell, not started yet \(pending\), run started/),
    ).toBeInTheDocument();
  });

  it('a missed firing recorded as skipped names the firing it stands for and the reason recorded with it (R17)', () => {
    renderWithProviders(
      <ViewHeader
        title="History"
        stale={false}
        variant="span"
        executions={[
          summary({
            id: 'skip',
            status: 'skipped_missed',
            startedAt: null,
            finishedAt: null,
            scheduledFor: '2026-10-19T04:00:00.000Z',
            skipCode: 'half-cadence',
          }),
          summary({
            id: 'old-skip',
            status: 'skipped_missed',
            startedAt: null,
            finishedAt: null,
            scheduledFor: null,
            skipCode: null,
          }),
        ]}
      />,
    );
    expect(
      screen.getByText(
        'showing run scheduled for 19 Oct 2026 05:00 Europe/London (skipped: missed and not caught up: the next scheduled run was less than half the gap away), run not started yet (skipped: missed and not caught up)',
      ),
    ).toBeInTheDocument();
  });

  it('the cross-execution variant states that no single run status applies, with no banner (decision 38)', () => {
    renderWithProviders(
      <ViewHeader
        title="History"
        stale={false}
        variant="span"
        executions={[summary({ status: 'running' }), summary({ id: 'e0' })]}
      />,
    );
    expect(screen.getByText('across 2 runs; no single run status applies')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('no run yet', () => {
    renderWithProviders(<ViewHeader title="Results" stale={false} executions={[]} />);
    expect(screen.getByText('No run yet for this search.')).toBeInTheDocument();
  });
});
