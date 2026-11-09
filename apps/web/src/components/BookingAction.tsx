import { type Booking, LINK_ALLOWLIST, type ProviderId, validateVendorUrl } from '@gmt/core';
import type { ReactNode } from 'react';
import { COPY } from '../copy.js';

/**
 * Defence in depth over the API's validation: core's spec §5.2 validator (`https:` only, no userinfo,
 * no port, length cap, host inside the provider's allowlist) and, on top, the URL's host must equal
 * the host the API states, which is what the operator is shown. Anything else is no link.
 */
export function safeVendorUrl(url: string, statedHost: string, providerId: ProviderId): string | null {
  const v = validateVendorUrl(url, LINK_ALLOWLIST[providerId]);
  return v.kind === 'get' && v.host === statedHost ? v.url : null;
}

/**
 * A POST booking as a form whose one button opens the seller's page in a new tab (spec §11): its fields hidden, never
 * submitted on render. `href` must already have passed `safeVendorUrl`. The Trip page's booking link uses it for a
 * seller's POST booking (design 2026-11-08 §5.3), with its own words in the button.
 */
export function BookingForm({
  href,
  postData,
  className = 'btn btn-sm min-h-11',
  children,
}: {
  href: string;
  postData: string;
  className?: string;
  children: ReactNode;
}) {
  const fields = [...new URLSearchParams(postData).entries()];
  return (
    <form method="post" action={href} target="_blank" rel="noopener noreferrer">
      {fields.map(([name, value], i) => (
        <input key={`${name}-${i}`} type="hidden" name={name} value={value} />
      ))}
      <button type="submit" className={className}>
        {children}
      </button>
    </form>
  );
}

/** GET link with host, POST as a form button (never auto-submitted), or "no link" (spec §11). */
export function BookingAction({ booking, providerId }: { booking: Booking; providerId: ProviderId }) {
  if (booking.kind === 'none') return <span>{COPY.noLink}</span>;
  const href = safeVendorUrl(booking.url, booking.host, providerId);
  if (href === null) return <span>{COPY.noLink}</span>;
  if (booking.kind === 'get') {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="link">
        {COPY.openOn(booking.host)}
      </a>
    );
  }
  return (
    <BookingForm href={href} postData={booking.postData}>
      {COPY.continueOnForm(booking.host)}
    </BookingForm>
  );
}
