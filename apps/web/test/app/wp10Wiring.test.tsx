import { BANNED_WORD_ALLOWLIST, findBannedWords } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/App.js';
import { ExpandedRow } from '../../src/views/Results/ExpandedRow.js';
import { calendarRow, verifiedRow } from '../fixtures.js';
import { poundsOutsidePrices, renderedCopy } from '../guards.js';
import { renderWithProviders } from '../render.js';

// why: WP9's sweep collectors, shared through test/guards.ts (review arch2-012), never a second copy here.
const swept = () => ({
  banned: findBannedWords(renderedCopy(), BANNED_WORD_ALLOWLIST),
  pounds: poundsOutsidePrices(),
});

// The default msw handlers (test/msw/wp10Handlers.ts) serve every WP10 route, so these views render real content.
describe('WP10 views in the shell: real content, no banned word (spec §11, §9 item 6)', () => {
  it('?view=calendar renders the calendar grid, legend and a priced day', async () => {
    const { findByRole, getByTestId } = renderWithProviders(<App />, {
      search: '?view=calendar&def=def-0001',
    });
    expect(await findByRole('table', { name: 'Mar 2027' })).toBeInTheDocument();
    expect(getByTestId('calendar-legend')).toBeInTheDocument();
    expect(getByTestId('day-price-block')).toHaveTextContent('£412');
    expect(swept()).toEqual({ banned: [], pounds: [] });
  });

  it('?view=duration renders the chart figure and the table', async () => {
    const { findByRole, getByRole } = renderWithProviders(<App />, {
      search: '?view=duration&def=def-0001',
    });
    expect(await findByRole('figure', { name: 'Cheapest found by stay length' })).toBeInTheDocument();
    expect(
      getByRole('table', { name: 'Cheapest found per stay length, with provenance' }),
    ).toBeInTheDocument();
    expect(swept()).toEqual({ banned: [], pounds: [] });
  });

  it('?view=history renders both charts and their tables', async () => {
    const { findByRole, getByRole } = renderWithProviders(<App />, {
      search: '?view=history&def=def-0001',
    });
    expect(await findByRole('figure', { name: 'Price by fetch date' })).toBeInTheDocument();
    expect(
      getByRole('figure', { name: 'Vendor price history for a searched trip (indicative): price by date' }),
    ).toBeInTheDocument();
    expect(swept()).toEqual({ banned: [], pounds: [] });
  });

  it('an expanded Results row with an itinerary links to its history; a calendar row does not', () => {
    const first = renderWithProviders(
      <ExpandedRow
        row={verifiedRow({ itineraryHash: 'abc123' })}
        extras={false}
        verificationConfigured
        definitionId="def-0001"
      />,
      {
        search: '?view=results&def=def-0001',
      },
    );
    const href = first.getByRole('link', { name: 'price history' }).getAttribute('href') ?? '';
    const params = new URLSearchParams(href.split('?')[1]);
    expect([params.get('view'), params.get('hash'), params.get('def')]).toEqual([
      'history',
      'abc123',
      'def-0001',
    ]);
    first.unmount();
    const second = renderWithProviders(
      <ExpandedRow row={calendarRow()} extras={false} verificationConfigured definitionId="def-0001" />,
    );
    expect(second.queryByRole('link', { name: 'price history' })).toBeNull();
  });
});
