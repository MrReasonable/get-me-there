import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App.js';
import { COPY } from '../../src/copy.js';
import { expectConsoleErrors } from '../guards.js';
import { renderWithProviders } from '../render.js';

// why: CodeRabbit batch 3 — the boundary began inside <main>, so a render error in the header (Nav, the definition
// selector), the status bar or the banners still blanked the whole page. A shell part that throws here stands in for
// any of them; its own file, because vi.mock replaces the module for every test in the file.
vi.mock('../../src/components/Nav.js', () => ({
  Nav: (): never => {
    throw new Error('nav render failed');
  },
}));

describe('the page never blanks, even when the shell itself fails to render (review tsr-002)', () => {
  it('a render error in the header shows the page-failed message instead of an empty page', () => {
    expectConsoleErrors(/nav render failed/);
    renderWithProviders(<App />, { search: '?view=results&def=def-0001' });
    expect(screen.getByRole('alert')).toHaveTextContent(COPY.appFailed);
  });
});
