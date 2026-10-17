import { CONSTRAINT_LABELS, effectiveAge, formatAgo, formatFetchedAgo, searchLinkFor } from '@gmt/core';
import { screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { BookingAction, SearchLink, safeVendorUrl } from '../../../src/components/BookingAction.js';
import { ExpandedRow } from '../../../src/views/Results/ExpandedRow.js';
import { API, calendarRow, failedRow, fxConverted, provSearch, verifiedRow } from '../../fixtures.js';
import { server } from '../../msw/server.js';
import { NOW, renderWithProviders } from '../../render.js';

const render = (
  row: Parameters<typeof ExpandedRow>[0]['row'],
  verificationConfigured = true,
  extras = false,
) =>
  renderWithProviders(
    <ExpandedRow
      row={row}
      extras={extras}
      verificationConfigured={verificationConfigured}
      definitionId="def-0001"
    />,
  );
const L = CONSTRAINT_LABELS;
const provenanceOf = () => verifiedRow().provenance;

describe('verdicts: distinct text for pass / fail / unverified (spec §9 item 6)', () => {
  it('each verdict has its own glyph and word, in core constraint order, and its own style', () => {
    render(failedRow());
    const items = within(screen.getByRole('list', { name: 'Constraint verdicts' })).getAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toEqual([
      `✓ ${L.cabin}: pass`,
      `✗ ${L.arrivalWindowLocal}: fail`,
      `? ${L.checkedBagRequired}: unverified`,
    ]);
    expect(items.map((i) => i.getAttribute('aria-label'))).toEqual([null, null, null]);
    expect(new Set(items.map((i) => i.className)).size).toBe(3);
  });

  it('an unconfirmed price reads as its label alone, never "…: unverified" (decision 44)', () => {
    render(
      verifiedRow({
        verdictClass: 'partially-verified',
        verdicts: { cabin: 'pass', priceConfirmed: 'unverified' },
        unverified: ['priceConfirmed'],
      }),
    );
    const items = within(screen.getByRole('list', { name: 'Constraint verdicts' })).getAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toEqual([
      `✓ ${L.cabin}: pass`,
      '? price not confirmed by the final step',
    ]);
  });

  it('a constraint listed as unverified but missing from verdicts is shown unverified, never dropped (review tsr-014)', () => {
    render(verifiedRow({ verdicts: {}, unverified: ['checkedBagRequired'] }));
    const items = within(screen.getByRole('list', { name: 'Constraint verdicts' })).getAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toEqual([`? ${L.checkedBagRequired}: unverified`]);
    expect(screen.queryByText('No constraints evaluated for this row.')).toBeNull();
  });
});

describe('booking links (spec §5.2, §9 item 6)', () => {
  it('GET: a new-tab link with rel="noopener noreferrer" and the host shown', () => {
    render(verifiedRow());
    const link = screen.getByRole('link', { name: 'open on www.google.com' });
    expect(link).toHaveAttribute('href', 'https://www.google.com/travel/clk/f?id=1');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('POST: a form button carrying postData, never submitted on render', () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => undefined);
    const requestSubmit = vi
      .spyOn(HTMLFormElement.prototype, 'requestSubmit')
      .mockImplementation(() => undefined);
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(failedRow());
    const form = screen
      .getByRole('button', { name: 'continue on www.google.com (sends a form)' })
      .closest('form');
    if (form === null) throw new Error('no form');
    expect(form).toHaveAttribute('method', 'post');
    expect(form).toHaveAttribute('action', 'https://www.google.com/travel/clk/f');
    expect(form).toHaveAttribute('rel', 'noopener noreferrer');
    expect(form).toHaveAttribute('target', '_blank');
    const hidden = [...form.querySelectorAll('input[type="hidden"]')].map(
      (i) => `${i.getAttribute('name')}=${i.getAttribute('value')}`,
    );
    expect(hidden).toEqual(['u=abc', 'tfu=xyz']);
    expect([submit, requestSubmit, open].map((s) => s.mock.calls.length)).toEqual([0, 0, 0]);
  });

  it('none: "no link", plus the provider search link with the API label and its host', () => {
    render(calendarRow());
    expect(screen.getByText('no link')).toBeInTheDocument();
    const search = screen.getByRole('link', { name: 'search link, not a fare link' });
    expect(search).toHaveAttribute('rel', 'noopener noreferrer');
    expect(search.getAttribute('href')).toMatch(/^https:\/\/search\.aviasales\.com\/flights\//);
    expect(screen.getByText('(search.aviasales.com)')).toBeInTheDocument();
  });

  it("the search link shows core's label as sent, so a premium-economy caveat reaches the operator (review arch-008)", () => {
    const link = searchLinkFor('travelpayouts', calendarRow().cell, 'premium_economy');
    render(calendarRow({ searchLink: link }));
    expect(
      screen.getByRole('link', { name: 'search link, not a fare link; cabin not prefilled' }),
    ).toBeInTheDocument();
  });

  it('a synthetic row has no search link and says so', () => {
    render(calendarRow({ searchLink: null }));
    expect(screen.getByText('no search link')).toBeInTheDocument();
  });

  it("core's vendor validator plus the stated host: anything else is no link", () => {
    expect(safeVendorUrl('https://www.google.com/x', 'www.google.com', 'searchapi')).toBe(
      'https://www.google.com/x',
    );
    for (const [url, host] of [
      ['http://www.google.com/x', 'www.google.com'],
      ['https://u:p@www.google.com/x', 'www.google.com'],
      ['https://www.google.com:8443/x', 'www.google.com'],
      ['https://evil.example/x', 'evil.example'],
      ['https://www.google.com/x', 'maps.google.com'],
      ['javascript:alert(1)', 'www.google.com'],
    ]) {
      expect(safeVendorUrl(url ?? '', host ?? '', 'searchapi')).toBeNull();
    }
    expect(safeVendorUrl('https://www.aviasales.com/x', 'www.aviasales.com', 'searchapi')).toBeNull();
    renderWithProviders(
      <BookingAction
        booking={{ kind: 'get', url: 'https://evil.example/x', host: 'www.google.com' }}
        providerId="searchapi"
      />,
    );
    expect(screen.getByText('no link')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('a POST booking or search link that fails validation is no link too', () => {
    renderWithProviders(
      <>
        <BookingAction
          booking={{ kind: 'post', url: 'https://evil.example/f', postData: 'a=1', host: 'evil.example' }}
          providerId="searchapi"
        />
        <SearchLink
          link={{
            url: 'https://evil.example/s',
            host: 'evil.example',
            label: 'search link, not a fare link',
          }}
          providerId="searchapi"
        />
      </>,
    );
    expect(screen.getByText('no link')).toBeInTheDocument();
    expect(screen.getByText('no search link')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('itinerary detail (spec §11 expanded row)', () => {
  it('one labelled region per row, segments, layovers, baggage and conditions', () => {
    render(verifiedRow());
    expect(screen.getAllByRole('region')).toHaveLength(1);
    expect(
      screen.getByRole('region', { name: 'Details for JFK 14 Mar 2027 to 28 Mar 2027' }),
    ).toBeInTheDocument();
    expect(screen.getByText('ZZ 117 LHR 14 Mar 10:25 → BBB 14 Mar 12:00')).toBeInTheDocument();
    expect(screen.getByText('ZZ 178 JFK 28 Mar 19:00 → LHR 29 Mar 07:00')).toBeInTheDocument();
    expect(screen.getByText('BBB: 1h 30m')).toBeInTheDocument();
    expect(screen.getByText('cabin bag included')).toBeInTheDocument();
    expect(screen.getByText('1 checked bag')).toBeInTheDocument();
    expect(screen.getByText('not refundable')).toBeInTheDocument();
    expect(screen.getByText('changeable')).toBeInTheDocument();
    expect(screen.getByText('sold by Example Travel')).toBeInTheDocument();
  });

  it('an overnight layover, an airport change and a self-transfer are named', () => {
    render(
      verifiedRow({
        layovers: [{ at: 'BBB', minutes: 540, overnight: true, airportChange: true }],
        selfTransfer: true,
      }),
    );
    expect(screen.getByText('BBB: 9h 00m')).toBeInTheDocument();
    expect(screen.getByText('overnight')).toBeInTheDocument();
    expect(screen.getByText('airport change')).toBeInTheDocument();
    expect(
      screen.getByText('self-transfer: you re-check bags and the airlines do not protect the connection'),
    ).toBeInTheDocument();
  });

  it('missing baggage and conditions say "not stated", never a default', () => {
    render(failedRow());
    expect(screen.getByText('cabin bag not stated')).toBeInTheDocument();
    expect(screen.getByText('checked bags not stated')).toBeInTheDocument();
    expect(screen.getByText('refunds not stated')).toBeInTheDocument();
  });

  it('other sellers render through PriceCell with their class, unverified names and not-seen-in-latest (review prov-008)', () => {
    render(
      verifiedRow({
        otherOffers: [
          {
            seller: 'Second Seller',
            pricePence: 42000,
            provenance: provSearch,
            booking: { kind: 'none' },
            stale: false,
            ageHours: 'unknown',
            verdictClass: 'partially-verified',
            unverified: ['checkedBagRequired', 'priceConfirmed'],
            notSeenInLatest: { ageHours: 72 },
          },
        ],
      }),
    );
    const others = screen.getByRole('list', { name: 'Other sellers for this itinerary' });
    expect(within(others).getByText('£420')).toBeInTheDocument();
    expect(within(others).getByText('Google Flights via SearchApi')).toBeInTheDocument();
    expect(within(others).getByTestId('class-badge')).toHaveTextContent('partially verified');
    expect(within(others).getByText(`unverified: ${L.checkedBagRequired}`)).toBeInTheDocument();
    expect(within(others).getByText(`not seen in latest search (${formatAgo(72)})`)).toBeInTheDocument();
    expect(formatAgo(72)).toBe('3d ago');
    // why: an other seller whose price the final step did not confirm says so beside its price (decision 44).
    expect(
      within(within(others).getByTestId('price-cell')).getByText('price not confirmed by the final step'),
    ).toBeInTheDocument();
  });

  it('at 375px the summary repeats the moved columns, the adjusted price through PriceCell with "≈" and "stale" (review prov-009)', () => {
    render(
      verifiedRow({ adjustedPence: 45000, stale: true, provenance: { ...provSearch, fx: fxConverted } }),
      true,
      true,
    );
    expect(screen.getByRole('heading', { name: 'Summary' })).toBeInTheDocument();
    const adjusted = screen
      .getByText('incl. operator-entered onward cost')
      .closest('[data-testid="price-cell"]');
    if (adjusted === null) throw new Error('adjusted price not in a PriceCell');
    expect(adjusted).toHaveTextContent('≈');
    expect(adjusted).toHaveTextContent('£450');
    expect(adjusted).toHaveTextContent('stale');
    expect(screen.getByText(formatFetchedAgo(effectiveAge(provenanceOf(), NOW)))).toBeInTheDocument();
  });
});

describe('calendar rows (spec §6.9)', () => {
  it('say there is no itinerary and name the constraints not applied', () => {
    render(calendarRow());
    expect(screen.getAllByText('calendar price, no itinerary')).toHaveLength(2);
    expect(
      screen.getByText(`not applied: ${L.arrivalWindowLocal}, ${L.maxJourneyMinutes}, ${L.maxStops}`),
    ).toBeInTheDocument();
  });

  it('per-cell verify is offered only with a verification provider, names its cost, and posts the cell', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API}/cells/verify`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ executionId: 'exec-child-1' });
      }),
    );
    const { user, unmount } = render(calendarRow());
    await user.click(
      screen.getByRole('button', { name: 'Search this cell for itineraries (uses billed calls)' }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Itinerary search started for this cell; the status bar follows it.',
    );
    expect(bodies).toEqual([
      {
        definitionId: 'def-0001',
        cell: { origin: 'LHR', destination: 'EWR', departureDate: '2027-04-02', returnDate: '2027-04-16' },
      },
    ]);
    unmount();
    render(calendarRow(), false);
    expect(screen.queryByRole('button', { name: /Search this cell/ })).toBeNull();
  });
});
