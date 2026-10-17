import { COPY } from '../src/copy.js';

/**
 * What the Playwright smoke looks for in the calendar, shared with the jsdom test that proves each one matches the
 * markup (test/e2e/selectors.test.tsx; review arch2-001, ui-r2-002): the smoke needs a running api, so it cannot run in
 * `pnpm test`, but its selectors can never drift from the component again.
 */
export const SMOKE = {
  /** Each month is a table captioned by its month name ("Mar 2027"; plan decision 51). */
  monthTable: /^[A-Z][a-z]{2} \d{4}$/,
  /** The roving tab stop: exactly one day button carries tabindex 0. */
  dayTabStop: 'button[data-date][tabindex="0"]',
  /** Every day button. */
  dayButton: 'button[data-date]',
  /** A priced day on a desktop, with WP9's compact PriceCell inside. */
  pricedDay: '[data-testid="day-price-block"]',
  /** A priced day at phone width: PriceCell's face (plan decision 52). */
  pricedDayPhone: '[data-testid="day-price-face"]',
  nextMonth: COPY.calendarView.nextMonth,
} as const;
