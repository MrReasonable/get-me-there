import { effectiveAge, formatAgeFull, provenanceSchema } from '@gmt/core';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PriceBoundary } from '../../src/components/PriceBoundary.js';
import { PriceLabel } from '../../src/components/PriceLabel.js';
import { COPY } from '../../src/copy.js';
import { provCalendar, provSearch } from '../fixtures.js';
import { expectConsoleErrors } from '../guards.js';
import { NOW, renderWithProviders } from '../render.js';

// Design 2026-11-08 §5.1 (trip-page plan Task 7): one label per price, `Kind · age`, its detail one tap down.

const T = COPY.trip;
const detail = T.labelDetail.calendar;

function label(over: Partial<Parameters<typeof PriceLabel>[0]> = {}) {
  return renderWithProviders(
    <PriceBoundary>
      <PriceLabel
        kind="calendar"
        ageHours={3}
        stale={false}
        provenance={provCalendar}
        detail={detail}
        {...over}
      />
    </PriceBoundary>,
  );
}

const summaryOf = () => {
  const s = screen.getByTestId('price-label').querySelector('summary');
  if (s === null) throw new Error('no summary');
  return s;
};

describe('PriceLabel', () => {
  it.each([
    ['seller', 'Seller · 3h'],
    ['google-price', 'Google price · 3h'],
    ['google-list', 'Google list · 3h'],
    ['calendar', 'Calendar · 3h'],
    ['cached', 'Cached · 3h'],
    ['not-seen-again', 'Not seen again · 3h'],
  ] as const)('%s reads "%s"', (kind, text) => {
    label({ kind });
    expect(summaryOf()).toHaveTextContent(text);
  });

  it('formats the age as the board does: days past 47h, "just now" under an hour, an unknown age said', () => {
    const { unmount } = label({ ageHours: 50 });
    expect(summaryOf()).toHaveTextContent('Calendar · 2d');
    unmount();
    const again = label({ ageHours: 0 });
    expect(summaryOf()).toHaveTextContent('Calendar · just now');
    again.unmount();
    label({ ageHours: 'unknown' });
    expect(summaryOf()).toHaveTextContent('Calendar · age unknown');
  });

  it('is a closed disclosure whose detail says what the price is and its full age', () => {
    label({ provenance: provSearch });
    const d = screen.getByTestId('price-label');
    expect(d.tagName).toBe('DETAILS');
    expect(d).not.toHaveAttribute('open');
    const full = formatAgeFull(effectiveAge(provenanceSchema.parse(provSearch), NOW));
    expect(full).toContain("vendor's cache age unknown");
    expect(d).toHaveTextContent(detail);
    expect(d).toHaveTextContent(full);
  });

  it('a fresh price has a plain age and no extra spoken words', () => {
    label();
    expect(summaryOf()).not.toHaveAttribute('aria-label');
    expect(summaryOf().querySelector('.price-label-stale')).toBeNull();
  });

  it("a stale price's age is amber and its spoken name says it is older than this search's refresh", () => {
    label({ stale: 'refresh' });
    expect(summaryOf()).toHaveAccessibleName("Calendar · 3h, older than this search's refresh");
    expect(summaryOf().querySelector('.price-label-stale')).toHaveTextContent('3h');
  });

  // why: jsdom does not activate a summary from the keyboard (browsers do; e2e/trip.spec.ts tabs to it), so it is opened
  // by a click here and closed from the keyboard
  it('takes focus from the keyboard, opens, and Escape closes it, focus back on the label', async () => {
    const { user } = label();
    const d = screen.getByTestId('price-label');
    await user.tab();
    expect(summaryOf()).toHaveFocus();
    await user.click(summaryOf());
    expect(d).toHaveAttribute('open');
    await user.keyboard('{Escape}');
    expect(d).not.toHaveAttribute('open');
    expect(summaryOf()).toHaveFocus();
  });

  it('Escape on a closed label does nothing', async () => {
    const { user } = label();
    await user.tab();
    await user.keyboard('{Escape}');
    expect(screen.getByTestId('price-label')).not.toHaveAttribute('open');
  });

  it('a provenance that is not one withholds the label alone, inside its own boundary', () => {
    expectConsoleErrors(/price withheld|price rendered without valid provenance/);
    renderWithProviders(
      <p>
        <span>before</span>
        <PriceLabel
          kind="calendar"
          ageHours={3}
          stale={false}
          provenance={{ ...provCalendar, providerId: 'fixture' }}
          detail={detail}
        />
        <span>after</span>
      </p>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(COPY.priceWithheld);
    expect(screen.queryByTestId('price-label')).toBeNull();
    expect(screen.getByText('before')).toBeInTheDocument();
    expect(screen.getByText('after')).toBeInTheDocument();
  });

  it('Escape closes an open detail even when its label does not hold focus, and focus returns to the label', async () => {
    const { user } = label();
    const d = screen.getByTestId('price-label');
    if (!(d instanceof HTMLDetailsElement)) throw new Error('not a details element');
    // why: a clicked summary takes no focus in some browsers; opened with focus left on the page
    d.open = true;
    expect(document.activeElement).toBe(document.body);
    await user.keyboard('{Escape}');
    expect(d).not.toHaveAttribute('open');
    expect(summaryOf()).toHaveFocus();
  });

  it('Escape leaves focus where it is when it is elsewhere on the page', async () => {
    const { user } = renderWithProviders(
      <>
        <button type="button">elsewhere</button>
        <PriceLabel kind="calendar" ageHours={3} stale={false} provenance={provCalendar} detail={detail} />
      </>,
    );
    const d = screen.getByTestId('price-label');
    if (!(d instanceof HTMLDetailsElement)) throw new Error('not a details element');
    d.open = true;
    screen.getByRole('button', { name: 'elsewhere' }).focus();
    await user.keyboard('{Escape}');
    expect(d).not.toHaveAttribute('open');
    expect(screen.getByRole('button', { name: 'elsewhere' })).toHaveFocus();
  });
});
