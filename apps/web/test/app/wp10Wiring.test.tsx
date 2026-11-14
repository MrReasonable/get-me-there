import { BANNED_WORD_ALLOWLIST, findBannedWords } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/App.js';
import { poundsOutsidePrices, renderedCopy } from '../guards.js';
import { renderWithProviders } from '../render.js';

// why: WP9's sweep collectors, shared through test/guards.ts (review arch2-012), never a second copy here.
const swept = () => ({
  banned: findBannedWords(renderedCopy(), BANNED_WORD_ALLOWLIST),
  pounds: poundsOutsidePrices(),
});

// The default msw handlers (test/msw/wp10Handlers.ts) serve every WP10 route, so these views render real content.
describe('WP10 views in the shell: real content, no banned word (spec §11, §9 item 6)', () => {
  // why: WP19 Task 19.7: ?view=calendar and ?view=duration land on Dates (test/state/landing.test.ts and the shell
  // test hold that rule); the Calendar and Duration views are reached by no URL until Task 19.8 deletes them.
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
});
