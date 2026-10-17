import { asIsoDateTime, effectiveAge, formatAgeCompact, formatAgeFull, provenanceSchema } from '@gmt/core';
import { screen, within } from '@testing-library/react';
import { Component, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { PriceBoundary } from '../../src/components/PriceBoundary.js';
import { PriceCell } from '../../src/components/PriceCell.js';
import { assertProvenance, MissingProvenanceError, Provenance } from '../../src/components/Provenance.js';
import { expectConsoleErrors } from '../guards.js';
import { NOW, type ProvenanceInput, renderWithProviders } from '../render.js';

/** SearchApi itinerary price: provider age 'unknown' (spec rev 15, decision 24). */
const searchProvenance: ProvenanceInput = {
  providerId: 'searchapi',
  sourceKind: 'scraped-search',
  fetchedAt: '2026-10-14T10:00:00.000Z',
  maxAgeHours: 'unknown',
  fx: { converted: false },
  pointOfSale: 'GB',
  cabin: 'economy',
};
const calendarProvenance: ProvenanceInput = {
  providerId: 'travelpayouts',
  sourceKind: 'authorised-cached',
  fetchedAt: '2026-10-14T13:00:00.000Z',
  maxAgeHours: 48,
  fx: { converted: true, rateNano: 790_000_000, rateDate: '2026-10-13', source: 'frankfurter' },
  pointOfSale: 'unknown',
  cabin: 'economy',
};
const syntheticProvenance: ProvenanceInput = {
  providerId: 'fixture',
  sourceKind: 'synthetic',
  fetchedAt: '2026-10-14T13:00:00.000Z',
  maxAgeHours: 0,
  fx: { converted: false },
  pointOfSale: 'unknown',
  cabin: 'economy',
};

/** The age labels core computes for a provenance at the tests' NOW: the oracle the DOM is compared with (review tsr-008). */
const ages = (p: ProvenanceInput) => {
  const a = effectiveAge(provenanceSchema.parse(p), NOW);
  return { compact: formatAgeCompact(a), full: formatAgeFull(a) };
};

/** Records the error a child threw so the test can assert its class without relying on render() rethrowing. */
class Catch extends Component<{ children: ReactNode; onError: (e: unknown) => void }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown) {
    this.props.onError(error);
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

describe('a price without provenance fails to render (spec §9 item 6; WP9 first failing test)', () => {
  it('PriceCell inside PriceBoundary shows the withheld message and never the number', () => {
    expectConsoleErrors(/price withheld|price rendered without valid provenance/);
    renderWithProviders(
      <PriceBoundary>
        <PriceCell pricePence={41200} provenance={undefined} calendar={false} stale={false} />
      </PriceBoundary>,
    );
    expect(screen.queryByText(/412/)).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('price withheld: provenance missing');
  });

  it('a provenance missing fetchedAt is treated exactly like no provenance (nothing is defaulted)', () => {
    expectConsoleErrors(/price withheld|price rendered without valid provenance/);
    const { fetchedAt: _drop, ...partial } = searchProvenance;
    renderWithProviders(
      <PriceBoundary>
        <PriceCell pricePence={41200} provenance={partial} calendar={false} stale={false} />
      </PriceBoundary>,
    );
    expect(screen.queryByText(/412/)).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('price withheld: provenance missing');
  });

  it('Provenance on its own throws MissingProvenanceError', () => {
    expectConsoleErrors(/price withheld|price rendered without valid provenance/);
    const errors: unknown[] = [];
    renderWithProviders(
      <Catch onError={(e) => errors.push(e)}>
        <Provenance provenance={undefined} calendar={false} />
      </Catch>,
    );
    expect(errors[0]).toBeInstanceOf(MissingProvenanceError);
  });

  it('the fixture provider and the synthetic source kind only ever appear together (spec §5.5)', () => {
    expect(() => assertProvenance({ ...syntheticProvenance, sourceKind: 'scraped-search' })).toThrow(
      MissingProvenanceError,
    );
    expect(() => assertProvenance({ ...searchProvenance, sourceKind: 'synthetic' })).toThrow(
      MissingProvenanceError,
    );
    expect(assertProvenance(syntheticProvenance).providerId).toBe('fixture');
  });

  it('a valid price inside PriceBoundary renders normally', () => {
    renderWithProviders(
      <PriceBoundary>
        <PriceCell pricePence={41200} provenance={searchProvenance} calendar={false} stale={false} />
      </PriceBoundary>,
    );
    expect(screen.getByText('£412')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('Provenance shows source and age without hover (spec §11)', () => {
  it('itinerary price: badge, source in words, compact age with the full form as title; an unknown age says so', () => {
    renderWithProviders(
      <PriceCell
        pricePence={41200}
        provenance={searchProvenance}
        calendar={false}
        stale={false}
        destination="JFK"
        destinationNote={null}
      />,
    );
    expect(screen.getByText('£412')).toBeInTheDocument();
    expect(screen.getByText('SearchApi')).toBeInTheDocument();
    expect(screen.getByText('Google Flights via SearchApi')).toBeInTheDocument();
    const { compact, full } = ages(searchProvenance);
    expect(compact).toBe('5h ago · age unknown'); // canary: one literal per format
    expect(full).toBe("fetched 5h ago · vendor's cache age unknown");
    expect(screen.getByText(compact)).toHaveAttribute('title', full);
    expect(screen.queryByText('constraints not checked')).toBeNull();
    expect(screen.queryByText('≈')).toBeNull();
  });

  it('calendar price: dashed outline, "constraints not checked", ≈ on the amount for FX, destination and note', () => {
    renderWithProviders(
      <PriceCell
        pricePence={39950}
        provenance={calendarProvenance}
        calendar
        stale
        destination="EWR"
        destinationNote="onward leg not included"
      />,
    );
    const cell = screen.getByTestId('price-cell');
    expect(cell.firstElementChild?.textContent).toMatch(/^≈.*£399\.50/);
    expect(screen.getByText('≈')).toHaveAttribute(
      'title',
      'converted to GBP at the 2026-10-13 rate (frankfurter)',
    );
    expect(
      screen.getByText('approximately (converted to GBP at the 2026-10-13 rate (frankfurter))'),
    ).toHaveClass('sr-only');
    expect(screen.getByText('stale')).toBeInTheDocument();
    expect(screen.getByTestId('provenance').className).toContain('border-dashed');
    expect(screen.getByText('constraints not checked')).toBeInTheDocument();
    expect(screen.getByText('Aviasales cache')).toBeInTheDocument();
    const { compact, full } = ages(calendarProvenance);
    expect(compact).toBe('2h ago · ≤2d');
    expect(screen.getByText(compact)).toHaveAttribute('title', full);
    expect(screen.getByText('EWR')).toBeInTheDocument();
    expect(screen.getByText('onward leg not included')).toBeInTheDocument();
  });

  it('a calendar source kind gets the calendar marker even when the caller passes calendar={false}', () => {
    renderWithProviders(
      <PriceCell pricePence={39950} provenance={calendarProvenance} calendar={false} stale={false} />,
    );
    expect(screen.getByText('constraints not checked')).toBeInTheDocument();
    expect(screen.getByTestId('provenance').className).toContain('border-dashed');
  });

  it('a synthetic price says "Fixture" and "synthetic fixture data" (spec §5.5)', () => {
    renderWithProviders(
      <PriceCell pricePence={10000} provenance={syntheticProvenance} calendar={false} stale={false} />,
    );
    expect(screen.getByText('Fixture')).toBeInTheDocument();
    expect(screen.getByText('synthetic fixture data')).toBeInTheDocument();
  });

  it('truncated, not seen in the latest search, and a qualifier are each stated in words', () => {
    renderWithProviders(
      <PriceCell
        pricePence={45000}
        provenance={calendarProvenance}
        calendar
        stale={false}
        truncated
        notSeenInLatestHours="unknown"
        qualifier="incl. operator-entered onward cost"
      />,
    );
    expect(screen.getByText('cheapest of the rows read')).toBeInTheDocument();
    expect(screen.getByText('not seen in latest search (age unknown)')).toBeInTheDocument();
    expect(screen.getByText('incl. operator-entered onward cost')).toBeInTheDocument();
  });

  it('a superseded price says so in words, beside the price, and is still shown (decision 57; controller-directed)', () => {
    renderWithProviders(
      <PriceCell pricePence={45000} provenance={calendarProvenance} calendar stale={false} superseded />,
    );
    expect(screen.getByText('superseded by a later search')).toBeInTheDocument();
    expect(screen.getByText(/450/)).toBeInTheDocument();
  });

  it('a current price carries no superseded mark', () => {
    renderWithProviders(
      <PriceCell pricePence={45000} provenance={calendarProvenance} calendar stale={false} />,
    );
    expect(screen.queryByText('superseded by a later search')).toBeNull();
  });

  it('beside the table columns the line drops provider and destination; a header shows the full age', () => {
    const { unmount } = renderWithProviders(
      <PriceCell
        pricePence={41200}
        provenance={searchProvenance}
        calendar={false}
        stale={false}
        destination="JFK"
        notSeenInLatestHours={72}
        besideColumns
      />,
    );
    const line = screen.getByTestId('provenance');
    expect(within(line).queryByText('SearchApi')).toBeNull();
    expect(within(line).queryByText('JFK')).toBeNull();
    expect(screen.getByText('not seen in latest search (3d ago)')).toBeInTheDocument();
    unmount();
    renderWithProviders(
      <PriceCell pricePence={41200} provenance={searchProvenance} calendar={false} stale={false} fullAge />,
    );
    expect(screen.getByText(ages(searchProvenance).full)).toBeInTheDocument();
  });

  it('an unknown vendor age is labelled "vendor\'s cache age unknown", and the price is not called stale (decision 44)', () => {
    renderWithProviders(
      <PriceCell pricePence={41200} provenance={searchProvenance} calendar={false} stale={false} />,
    );
    expect(screen.getByText("vendor's cache age unknown")).toBeInTheDocument();
    expect(screen.queryByText('stale')).toBeNull();
  });

  it('a stale price with a known age says "stale" and carries no unknown-age label', () => {
    renderWithProviders(<PriceCell pricePence={39950} provenance={calendarProvenance} calendar stale />);
    expect(screen.getByText('stale')).toBeInTheDocument();
    expect(screen.queryByText("vendor's cache age unknown")).toBeNull();
  });

  it('an unconfirmed price says so first, beside the amount, before any other mark (decision 44)', () => {
    renderWithProviders(
      <PriceCell pricePence={41200} provenance={searchProvenance} calendar={false} stale unconfirmed />,
    );
    const amount = screen.getByTestId('price-cell').firstElementChild;
    const marks = [...(amount?.querySelectorAll('span') ?? [])].map((m) => m.textContent);
    expect(marks.slice(0, 2)).toEqual(['price not confirmed by the final step', 'stale']);
  });

  it('compact (ruling 3): amount with "≈", provider badge, destination, marks and a visible age line; the long form in the title', () => {
    renderWithProviders(
      <PriceCell
        pricePence={39950}
        provenance={calendarProvenance}
        calendar
        stale
        truncated
        unconfirmed
        destination="EWR"
        destinationNote="onward leg not included"
        compact
      />,
    );
    const cell = screen.getByTestId('price-cell');
    expect(cell).toHaveTextContent('≈');
    expect(within(cell).getByText('TP')).toBeInTheDocument();
    expect(within(cell).getByText('EWR')).toBeInTheDocument();
    expect(within(cell).getByText('stale')).toBeInTheDocument();
    expect(within(cell).getByText('cheapest of the rows read')).toBeInTheDocument();
    expect(within(cell).getByText('price not confirmed by the final step')).toBeInTheDocument();
    expect(within(cell).queryByText('Aviasales cache')).toBeNull();
    expect(within(cell).queryByText('onward leg not included')).toBeNull();
    expect(screen.queryByTestId('provenance')).toBeNull();
    // why: provenance without hover (spec §11, ruling 3): the age and "not checked" are on the face, not only the title.
    expect(within(cell).getByTestId('face-age')).toHaveTextContent('≤2d old · not checked');
    const { full } = ages(calendarProvenance);
    expect(cell.getAttribute('title')).toBe(
      `Travelpayouts · Aviasales cache · ${full} · constraints not checked · onward leg not included`,
    );
    expect(cell.className).toContain('border-dashed');
  });

  it('compact itinerary price without a destination or note: badge only, title without the calendar words', () => {
    renderWithProviders(
      <PriceCell pricePence={41200} provenance={searchProvenance} calendar={false} stale={false} compact />,
    );
    const cell = screen.getByTestId('price-cell');
    expect(within(cell).getByText('SA')).toBeInTheDocument();
    // why: the unknown age is the visible badge; the face adds no second "age unknown" and no "not checked".
    expect(within(cell).getByText("vendor's cache age unknown")).toBeInTheDocument();
    expect(within(cell).queryByTestId('face-age')).toBeNull();
    expect(cell.getAttribute('title')).toBe(
      `SearchApi · Google Flights via SearchApi · ${ages(searchProvenance).full}`,
    );
    expect(cell.className).not.toContain('border-dashed');
  });

  it('a vendor-dated calendar price shows its observed age on the compact face (F3: "5d old")', () => {
    renderWithProviders(
      <PriceCell
        pricePence={47900}
        provenance={{ ...calendarProvenance, providerObservedAt: '2026-10-09T15:00:00.000Z' }}
        calendar
        stale={false}
        destination="JFK"
        compact
      />,
    );
    expect(within(screen.getByTestId('price-cell')).getByTestId('face-age')).toHaveTextContent(
      '5d old · not checked',
    );
  });

  it('the tests clock is the fixed NOW', () => {
    expect(NOW).toBe(asIsoDateTime('2026-10-14T15:00:00.000Z'));
  });
});
