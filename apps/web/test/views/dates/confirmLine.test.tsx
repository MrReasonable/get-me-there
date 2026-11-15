import type { ConfirmSummary } from '@gmt/core';
import { render, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { COPY } from '../../../src/copy.js';
import { ConfirmLine } from '../../../src/views/Dates/ConfirmLine.js';
import { workedDates } from '../../fixtures.dates.js';
import { API, execution } from '../../fixtures.js';
import { server } from '../../msw/server.js';
import { findTrips, renderDates } from './render.js';

// Design 2026-11-08 §5.5, Ruling 22: how reading flights ended, the stopping sentence after "Cheapest trips"' lead. The
// exact copy is pinned in logic/confirmWords.test.ts; here the component renders it, and the page puts it in the
// section's lead, never in the run line.

const summary = (over: Partial<ConfirmSummary> = {}): ConfirmSummary => ({
  mode: 'confirm',
  confirmed: 7,
  unread: 0,
  uncheckedCheaper: 31,
  stop: 'patience',
  ...over,
});
const input = (over: Partial<Parameters<typeof ConfirmLine>[0]['input'] & object> = {}) => ({
  confirm: summary(),
  ended: null,
  stopCause: null,
  running: false,
  planned: 18,
  theseFive: false,
  ...over,
});
const LEAD = COPY.searchPage.cheapestLead;

describe('ConfirmLine', () => {
  it('the lead, then the sentence as plain text', () => {
    render(<ConfirmLine lead={LEAD} input={input()} />);
    expect(screen.getByText(LEAD, { exact: false })).toHaveTextContent(
      "Flights read for these dates. Checked 18 dates; 7 trips with flights read. Reading stopped after 12 reads in a row found nothing cheaper than the five cheapest. 31 dates look cheaper on the calendar but weren't checked.",
    );
  });

  it('the lead alone for a run with no summary (a run before the change, or one that never reached the step)', () => {
    const { container } = render(<ConfirmLine lead={LEAD} input={input({ confirm: null })} />);
    expect(container).toHaveTextContent(/^Flights read for these dates\.$/);
    expect(screen.queryByTestId('confirm-line')).toBeNull();
    render(<ConfirmLine lead={LEAD} input={null} />);
    expect(screen.queryByTestId('confirm-line')).toBeNull();
  });

  it('while the step runs, the running words', () => {
    render(
      <ConfirmLine
        lead={LEAD}
        input={input({ confirm: summary({ confirmed: 3, stop: null }), running: true, planned: 9 })}
      />,
    );
    expect(screen.getByTestId('confirm-line')).toHaveTextContent(
      'Checking flights: 9 dates so far; 3 trips with flights read.',
    );
  });
});

const serveRun = (over: Parameters<typeof execution>[0]) =>
  server.use(http.get(`${API}/executions/:id`, () => HttpResponse.json(execution(over))));
const flights = (over: Partial<NonNullable<ReturnType<typeof execution>['flights']>> = {}) => ({
  planned: 18,
  read: 18,
  reused: 0,
  failed: 0,
  ended: null,
  confirm: summary(),
  stopCause: null,
  ...over,
});

describe('the search page', () => {
  it('puts the sentence in Cheapest trips’ lead; the run line says only the dates with flights read', async () => {
    serveRun({ status: 'completed', flights: flights() });
    renderDates({ body: workedDates() });
    const trips = await findTrips();
    const line = await within(trips).findByTestId('confirm-line');
    expect(line).toHaveTextContent('Checked 18 dates; 7 trips with flights read.');
    const run = await screen.findByTestId('dates-run');
    expect(run).not.toHaveTextContent(/Checked|flights read for/);
    expect(run.contains(line)).toBe(false);
  });

  it('a pending run with a step still going does not say it is checking flights', async () => {
    serveRun({
      status: 'pending',
      flights: flights({ planned: 9, read: 4, reused: 1, confirm: summary({ confirmed: 3, stop: null }) }),
    });
    renderDates({ body: workedDates() });
    const line = await within(await findTrips()).findByTestId('confirm-line');
    expect(line).toHaveTextContent('3 trips with flights read');
    expect(line).not.toHaveTextContent(/Checking flights/);
  });

  it('a run stored before the change has no sentence', async () => {
    serveRun({ status: 'completed', flights: flights({ confirm: null }) });
    renderDates({ body: workedDates() });
    const trips = await findTrips();
    await waitFor(() => expect(screen.getByTestId('dates-run')).toBeInTheDocument());
    expect(within(trips).queryByTestId('confirm-line')).toBeNull();
  });
});
