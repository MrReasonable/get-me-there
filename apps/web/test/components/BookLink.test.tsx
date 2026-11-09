import { SYNTHETIC_BOOKING_URL } from '@gmt/core/testing';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BookLink } from '../../src/components/BookLink.js';
import { renderWithProviders } from '../render.js';

// Design 2026-11-08 §5.3 and Ruling 10 (trip-page plan Task 7): the price and its booking text as one link.

const SEARCH = 'https://www.google.com/travel/flights?q=Flights+from+LHR+to+JFK&hl=en-GB&gl=GB';
const price = <span>£412</span>;

describe('BookLink', () => {
  it('the booking page: one new-tab link holding the price and "Book on Google Flights ↗", named as opening a new tab', () => {
    renderWithProviders(
      <BookLink
        target={{ kind: 'booking-page', url: SYNTHETIC_BOOKING_URL, host: 'www.google.com' }}
        price={price}
      />,
    );
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    const link = links[0];
    expect(link).toHaveAttribute('href', SYNTHETIC_BOOKING_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveTextContent('£412 · Book on Google Flights ↗');
    expect(link).toHaveAccessibleName('£412 · Book on Google Flights ↗, opens in a new tab');
  });

  it('a search link says "Find", never "Book", and its spoken name carries the label', () => {
    renderWithProviders(
      <BookLink
        target={{ kind: 'search', url: SEARCH, host: 'www.google.com' }}
        price={price}
        label="Back 21:10 JFK → 09:15 LHR"
      />,
    );
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', SEARCH);
    expect(link).toHaveAccessibleName(
      '£412 · Find on Google Flights ↗, Back 21:10 JFK → 09:15 LHR, opens in a new tab',
    );
    expect(screen.queryByText(/Book/)).toBeNull();
  });

  it("a seller's GET booking says its host", () => {
    renderWithProviders(
      <BookLink
        target={{
          kind: 'seller',
          booking: { kind: 'get', url: 'https://www.google.com/travel/clk/f?id=1', host: 'www.google.com' },
        }}
      />,
    );
    expect(screen.getByRole('link')).toHaveAccessibleName('Book on www.google.com ↗, opens in a new tab');
  });

  it("a seller's POST booking is the same words in a form button, never submitted on render", () => {
    renderWithProviders(
      <BookLink
        target={{
          kind: 'seller',
          booking: {
            kind: 'post',
            url: 'https://www.google.com/travel/clk/f',
            postData: 'u=abc&tfu=xyz',
            host: 'www.google.com',
          },
        }}
        price={price}
      />,
    );
    const button = screen.getByRole('button', {
      name: '£412 · Book on www.google.com ↗, opens in a new tab',
    });
    const form = button.closest('form');
    expect(form).toHaveAttribute('method', 'post');
    expect(form).toHaveAttribute('action', 'https://www.google.com/travel/clk/f');
    expect(form).toHaveAttribute('target', '_blank');
    expect(form).toHaveAttribute('rel', 'noopener noreferrer');
    expect(
      [...(form?.querySelectorAll('input[type="hidden"]') ?? [])].map((i) => i.getAttribute('name')),
    ).toEqual(['u', 'tfu']);
  });

  it('none: the price alone, no link', () => {
    renderWithProviders(<BookLink target={{ kind: 'none' }} price={price} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('£412')).toBeInTheDocument();
  });

  it('none without a price renders nothing', () => {
    const { container } = renderWithProviders(<BookLink target={{ kind: 'none' }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('an address that fails the check against its own host is no link (defence in depth)', () => {
    renderWithProviders(
      <>
        <BookLink target={{ kind: 'booking-page', url: SYNTHETIC_BOOKING_URL, host: 'maps.google.com' }} />
        <BookLink target={{ kind: 'search', url: 'https://evil.example/s', host: 'evil.example' }} />
        <BookLink
          target={{
            kind: 'seller',
            booking: { kind: 'get', url: 'https://evil.example/x', host: 'evil.example' },
          }}
          price={price}
        />
      </>,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('£412')).toBeInTheDocument();
  });
});
