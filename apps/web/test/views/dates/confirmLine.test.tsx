import type { ConfirmSummary } from '@gmt/core';
import { render, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { ConfirmLine } from '../../../src/views/Dates/ConfirmLine.js';
import { workedDates } from '../../fixtures.dates.js';
import { API, execution } from '../../fixtures.js';
import { server } from '../../msw/server.js';
import { findBoard, renderDates } from './render.js';

// Design 2026-11-08 §5.5: how checking flights ended, in one line under the board. The exact copy is pinned in
// logic/confirmWords.test.ts; here the component renders it, and the search page puts it under the board and in its
// state line.

const summary = (over: Partial<ConfirmSummary> = {}): ConfirmSummary => ({
  mode: 'confirm',
  confirmed: 7,
  unread: 0,
  uncheckedCheaper: 31,
  stop: 'patience',
  ...over,
});

describe('ConfirmLine', () => {
  it('renders the line as plain text', () => {
    render(<ConfirmLine confirm={summary()} ended={null} stopCause={null} running={false} planned={18} />);
    expect(screen.getByTestId('confirm-line')).toHaveTextContent(
      "Checked 18 dates; 7 trips with flights read. 31 dates look cheaper on the calendar but weren't checked.",
    );
  });

  it('renders nothing for a run with no summary (a run before the change, or one that never reached the step)', () => {
    const { container } = render(
      <ConfirmLine confirm={null} ended={null} stopCause={null} running={false} planned={0} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('while the step runs, the running words', () => {
    render(
      <ConfirmLine
        confirm={summary({ confirmed: 3, stop: null })}
        ended={null}
        stopCause={null}
        running
        planned={9}
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
  it('shows the line under the board, and the header line adds no flights clause of its own', async () => {
    serveRun({ status: 'completed', flights: flights() });
    renderDates({ body: workedDates() });
    const table = await findBoard();
    const line = await screen.findByTestId('confirm-line');
    expect(line).toHaveTextContent('Checked 18 dates; 7 trips with flights read.');
    // under the table, not inside it
    expect(table.contains(line)).toBe(false);
    expect(table.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId('dates-run')).not.toHaveTextContent(/flights read for/);
  });

  it('shows an ending page by the stop detail the api reports', async () => {
    serveRun({
      status: 'completed',
      flights: flights({
        planned: 3,
        read: 3,
        ended: 'stopped',
        confirm: summary({ confirmed: 1, uncheckedCheaper: 120, stop: null }),
        stopCause: { kind: 'detail', detail: 'quota' },
      }),
    });
    renderDates({ body: workedDates() });
    expect(await screen.findByTestId('confirm-line')).toHaveTextContent(
      "Stopped checking flights after 3 dates because the browser worker's plan has no calls left; 1 trip with flights read. 120 dates weren't checked.",
    );
  });

  it('shows no line for a run stored before the change', async () => {
    serveRun({ status: 'completed', flights: flights({ confirm: null }) });
    renderDates({ body: workedDates() });
    await findBoard();
    await waitFor(() => expect(screen.getByTestId('dates-run')).toBeInTheDocument());
    expect(screen.queryByTestId('confirm-line')).toBeNull();
  });

  it('while the step runs, the state line and the line under the board say it in the same words', async () => {
    serveRun({
      status: 'running',
      stage: 'discovery',
      flights: flights({ planned: 9, read: 4, reused: 1, confirm: summary({ confirmed: 3, stop: null }) }),
    });
    renderDates({ body: workedDates() });
    const words = 'Checking flights: 9 dates so far; 3 trips with flights read.';
    expect(await screen.findByTestId('confirm-line')).toHaveTextContent(words);
    await waitFor(() => expect(screen.getByTestId('state-line')).toHaveTextContent(words.replace(/\.$/, '')));
    expect(screen.getByTestId('state-line')).not.toHaveTextContent(/ of \d+/);
  });
});
