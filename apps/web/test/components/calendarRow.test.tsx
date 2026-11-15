import { asIata, asIsoDate } from '@gmt/core';
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CalendarRow } from '../../src/components/rows/CalendarRow.js';
import { COPY } from '../../src/copy.js';
import { airportPairIndex, calendarFig, provCached } from '../fixtures.dates.js';
import { renderWithProviders } from '../render.js';

// Ruling 20 and Ruling 5 (Trips and Search plan): one calendar price, never a link, with what is known of its flights.

const pair = { departureDate: asIsoDate('2026-11-17'), returnDate: asIsoDate('2026-11-27'), nights: 10 };
const search = { id: 'd1', cabin: 'economy', multiAirport: false, pointOfSale: 'GB' } as const;

describe('CalendarRow', () => {
  it('is a list item: the price (not a link) with its label, the dates, the nights and its read state', () => {
    renderWithProviders(
      <ul>
        <CalendarRow figure={calendarFig()} search={search} pair={pair} onRead={null} />
      </ul>,
    );
    const row = screen.getByRole('listitem');
    expect(row).toHaveTextContent('£312');
    expect(screen.getByTestId('price-label')).toHaveTextContent('Calendar');
    expect(row).toHaveTextContent('Tue 17 Nov → Fri 27 Nov');
    expect(row).toHaveTextContent('Nights 10');
    expect(row).toHaveTextContent('Flights not read');
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says a cached price is Cached, and a failed read\'s reason, never "not read"', () => {
    renderWithProviders(
      <ul>
        <CalendarRow
          figure={calendarFig({
            price: { ...calendarFig().price, provenance: provCached() },
            pairingRead: 'list-failed',
            listReason: 'network',
          })}
          search={search}
          pair={pair}
          onRead={null}
        />
      </ul>,
    );
    expect(screen.getByTestId('price-label')).toHaveTextContent('Cached');
    const row = screen.getByRole('listitem');
    expect(row).toHaveTextContent("Flights couldn't be read:");
    expect(row).not.toHaveTextContent(/not read/);
  });

  it('"Read flights" calls onRead once with the dates and airports', async () => {
    const onRead = vi.fn();
    const { user } = renderWithProviders(
      <ul>
        <CalendarRow
          figure={calendarFig({ origin: asIata('LGW'), airportPair: airportPairIndex('LGW', 'JFK') })}
          search={{ ...search, multiAirport: true }}
          pair={pair}
          onRead={onRead}
        />
      </ul>,
    );
    await user.click(
      screen.getByRole('button', { name: 'Read flights for LGW → JFK, Tue 17 Nov → Fri 27 Nov' }),
    );
    expect(onRead).toHaveBeenCalledTimes(1);
    expect(onRead).toHaveBeenCalledWith({
      departureDate: '2026-11-17',
      returnDate: '2026-11-27',
      origin: 'LGW',
      destination: 'JFK',
    });
  });

  it('while its read goes the button stays, says "Reading flights…" and is not pressed again; another row\'s read disables it', async () => {
    const onRead = vi.fn();
    const r = renderWithProviders(
      <ul>
        <CalendarRow figure={calendarFig()} search={search} pair={pair} onRead={onRead} reading="this" />
      </ul>,
    );
    const reading = screen.getByRole('button', { name: COPY.flights.reading });
    expect(reading).toHaveAttribute('aria-disabled', 'true');
    expect(reading).toBeEnabled();
    await r.user.click(reading);
    expect(onRead).not.toHaveBeenCalled();
    r.unmount();
    renderWithProviders(
      <ul>
        <CalendarRow figure={calendarFig()} search={search} pair={pair} onRead={onRead} reading="other" />
      </ul>,
    );
    expect(screen.getByRole('button', { name: 'Read flights for Tue 17 Nov → Fri 27 Nov' })).toBeDisabled();
  });

  it('a search with several airports prefixes the row with its pair; one airport does not', () => {
    const multi = renderWithProviders(
      <ul>
        <CalendarRow
          figure={calendarFig()}
          search={{ ...search, multiAirport: true }}
          pair={pair}
          onRead={null}
        />
      </ul>,
    );
    expect(screen.getByTestId('row-airports')).toHaveTextContent('LHR → JFK');
    multi.unmount();
    renderWithProviders(
      <ul>
        <CalendarRow figure={calendarFig()} search={search} pair={pair} onRead={null} />
      </ul>,
    );
    expect(screen.queryByTestId('row-airports')).toBeNull();
  });

  it('a read button without a handler is not shown; "Read flights" is its plain name on one airport pair', () => {
    renderWithProviders(
      <ul>
        <CalendarRow figure={calendarFig()} search={search} pair={pair} onRead={() => undefined} />
      </ul>,
    );
    expect(screen.getByRole('button')).toHaveAccessibleName('Read flights for Tue 17 Nov → Fri 27 Nov');
    expect(screen.getByRole('button')).toHaveTextContent('Read flights');
  });
});
