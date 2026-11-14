import { SYNTHETIC_BOOKING_URL } from '@gmt/core/testing';
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BookLink, safeVendorUrl } from '../../src/components/BookLink.js';
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
    // why: CodeRabbit PR #58 finding 15: each field's name and value, so an empty or swapped value fails
    expect(
      [...(form?.querySelectorAll('input[type="hidden"]') ?? [])].map((i) => [
        i.getAttribute('name'),
        i.getAttribute('value'),
      ]),
    ).toEqual([
      ['u', 'abc'],
      ['tfu', 'xyz'],
    ]);
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

  it('the price and the words are on their own lines; the join between them is the link’s own text, never a line’s start', () => {
    renderWithProviders(
      <BookLink
        target={{ kind: 'booking-page', url: SYNTHETIC_BOOKING_URL, host: 'www.google.com' }}
        price={price}
      />,
    );
    const link = screen.getByRole('link');
    expect(link.querySelector('.book-amount')).toHaveTextContent('£412');
    expect(link.querySelector('.book-words')).toHaveTextContent(/^Book on Google Flights ↗$/);
    const joins = [...link.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent);
    expect(joins).toEqual([' · ']);
  });

  it('a POST booking is never submitted on render', () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => undefined);
    const requestSubmit = vi
      .spyOn(HTMLFormElement.prototype, 'requestSubmit')
      .mockImplementation(() => undefined);
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderWithProviders(
      <BookLink
        target={{
          kind: 'seller',
          booking: {
            kind: 'post',
            url: 'https://www.google.com/travel/clk/f',
            postData: 'u=abc',
            host: 'www.google.com',
          },
        }}
      />,
    );
    expect(screen.getByRole('button')).toBeInTheDocument();
    expect([submit, requestSubmit, open].map((s) => s.mock.calls.length)).toEqual([0, 0, 0]);
  });
});

describe('safeVendorUrl: core’s vendor validator plus the stated host (spec §5.2)', () => {
  it('passes an https address on the allowlist whose host is the one stated, and nothing else', () => {
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
    ])
      expect(safeVendorUrl(url ?? '', host ?? '', 'searchapi')).toBeNull();
    expect(safeVendorUrl('https://www.aviasales.com/x', 'www.aviasales.com', 'searchapi')).toBeNull();
  });
});
