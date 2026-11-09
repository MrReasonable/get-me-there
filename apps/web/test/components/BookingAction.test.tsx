import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BookingAction, safeVendorUrl } from '../../src/components/BookingAction.js';
import { renderWithProviders } from '../render.js';

// Spec §5.2, §9 item 6: a booking link, re-checked in the browser. Moved from the retired Results view's tests (trip-page
// plan Task 7), now rendering the component itself.

describe('booking links (spec §5.2, §9 item 6)', () => {
  it('GET: a new-tab link with rel="noopener noreferrer" and the host shown', () => {
    renderWithProviders(
      <BookingAction
        booking={{ kind: 'get', url: 'https://www.google.com/travel/clk/f?id=1', host: 'www.google.com' }}
        providerId="searchapi"
      />,
    );
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
    renderWithProviders(
      <BookingAction
        booking={{
          kind: 'post',
          url: 'https://www.google.com/travel/clk/f',
          postData: 'u=abc&tfu=xyz',
          host: 'www.google.com',
        }}
        providerId="searchapi"
      />,
    );
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

  it('none: "no link"', () => {
    renderWithProviders(<BookingAction booking={{ kind: 'none' }} providerId="searchapi" />);
    expect(screen.getByText('no link')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
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

  it('a POST booking that fails validation is no link too', () => {
    renderWithProviders(
      <BookingAction
        booking={{ kind: 'post', url: 'https://evil.example/f', postData: 'a=1', host: 'evil.example' }}
        providerId="searchapi"
      />,
    );
    expect(screen.getByText('no link')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
