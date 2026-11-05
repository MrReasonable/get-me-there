import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PriceCell } from '../../src/components/PriceCell.js';
import { COPY } from '../../src/copy.js';
import { fxConverted, provSearch } from '../fixtures.js';
import { renderWithProviders } from '../render.js';

// The compact face at phone width: one inline box (amount, marks, provider mark, short age) that sits in its sentence,
// and, where a line nearby already says the stale mark's words (`staleSaid`), the stale glyph in place of the words.

const WORDS = "older than this search's refresh";

const compact = (staleSaid?: boolean, stale: false | 'refresh' = 'refresh') =>
  renderWithProviders(
    <p>
      from{' '}
      <PriceCell
        compact
        pricePence={8600}
        provenance={provSearch}
        calendar
        stale={stale}
        {...(staleSaid === undefined ? {} : { staleSaid })}
      />{' '}
      round trip
    </p>,
  );

describe('PriceCell compact face', () => {
  it('is an inline box, so the sentence around it stays one sentence', () => {
    compact();
    const cell = screen.getByTestId('price-cell');
    expect(cell.className).toContain('inline-flex');
    expect(cell.className).not.toContain('flex-col');
    expect(cell.parentElement).toHaveTextContent(/^from £86/);
  });

  it('says the stale mark in words when nothing nearby says it', () => {
    compact();
    const cell = screen.getByTestId('price-cell');
    expect(cell.querySelector('.tag-warn')).toHaveTextContent(WORDS);
    expect(within(cell).queryByTestId('stale-glyph')).toBeNull();
  });

  it('with staleSaid shows the stale glyph, the words kept for screen readers and in the title', () => {
    compact(true);
    const cell = screen.getByTestId('price-cell');
    expect(cell.querySelector('.tag-warn')).toBeNull();
    const glyph = within(cell).getByTestId('stale-glyph');
    expect(glyph).toHaveTextContent(COPY.priceMarkGlyph.stale);
    expect(glyph).toHaveAttribute('aria-hidden', 'true');
    expect(within(cell).getByText(WORDS)).toHaveClass('sr-only');
    expect(cell.getAttribute('title')?.startsWith(WORDS)).toBe(true);
  });

  it('with staleSaid on a fresh price shows no stale mark at all', () => {
    compact(true, false);
    const cell = screen.getByTestId('price-cell');
    expect(within(cell).queryByTestId('stale-glyph')).toBeNull();
    expect(cell).not.toHaveTextContent('older than');
  });
});

describe('PriceCell compact face: every mark stays in the box', () => {
  it('a qualifier, the unconfirmed badge, superseded, truncated and not-seen all show beside the amount', () => {
    renderWithProviders(
      <PriceCell
        compact
        pricePence={8600}
        provenance={provSearch}
        calendar={false}
        stale={false}
        qualifier="incl. onward cost"
        unconfirmed
        superseded
        truncated
        notSeenInLatestHours={30}
      />,
    );
    const cell = screen.getByTestId('price-cell');
    expect(cell).toHaveTextContent('incl. onward cost');
    expect(cell.querySelector('.tag-bad')).toHaveTextContent(COPY.priceNotConfirmed);
    expect(cell).toHaveTextContent(COPY.superseded);
    expect(cell).toHaveTextContent(COPY.truncatedNote);
    expect(cell).toHaveTextContent(COPY.notSeenInLatest(COPY.agoOf(30)));
  });
});

describe('PriceCell compact face: a converted price', () => {
  it('keeps "≈" and the amount in one unbreakable group, so the amount never reads as exact on its own', () => {
    renderWithProviders(
      <PriceCell
        compact
        pricePence={8600}
        provenance={{ ...provSearch, fx: fxConverted }}
        calendar={false}
        stale={false}
      />,
    );
    const amount = screen.getByTestId('compact-amount');
    expect(amount).toHaveClass('whitespace-nowrap');
    expect(amount).toHaveTextContent(new RegExp(`^${COPY.fxApprox}.*£86$`));
  });
});
