import type { BookingTarget } from '@gmt/core';
import type { ReactNode } from 'react';
import { COPY } from '../copy.js';
import { BookingForm, safeVendorUrl } from './BookingAction.js';

const T = COPY.trip;

/** The words of a target that links out (design 2026-11-08 §5.3); "Book" only where a booking page or seller is known. */
function wordsOf(target: Exclude<BookingTarget, { kind: 'none' }>): string {
  switch (target.kind) {
    case 'seller':
      return T.bookOn(target.booking.host);
    case 'booking-page':
      return T.bookOnGoogle;
    case 'search':
      return T.findOnGoogle;
  }
}

/** The address a target links to and the source whose allowlist it is checked against. */
function addressOf(target: Exclude<BookingTarget, { kind: 'none' }>): string | null {
  if (target.kind === 'seller') return safeVendorUrl(target.booking.url, target.booking.host, 'searchapi');
  // why: the booking page and the Google Flights search are the browser worker's own pages (google.com only)
  return safeVendorUrl(target.url, target.host, 'camoufox');
}

/**
 * Design 2026-11-08 §5.3 and Ruling 10: a price and its booking text as one link, one tab stop ("£412 · Book on Google
 * Flights ↗"), opening the best target in a new tab; its spoken name adds `label` (what the price is for, such as its
 * flights' times) and that it opens a new tab. A seller's POST booking is the same words in a form button. The address
 * is checked again here (`safeVendorUrl` with the target's own host), so one that fails, and a `none` target (a
 * synthetic price is never linked out), show the price without a link.
 */
export function BookLink({
  target,
  price,
  label,
  className = 'book-link',
}: {
  target: BookingTarget;
  price?: ReactNode;
  label?: string;
  className?: string;
}) {
  const href = target.kind === 'none' ? null : addressOf(target);
  if (target.kind === 'none' || href === null)
    return price === undefined ? null : <span className="book-price">{price}</span>;
  const body = (
    <>
      {price === undefined ? null : (
        <>
          {price}
          {T.priceJoin}
        </>
      )}
      {wordsOf(target)}
      <span className="sr-only">
        {label === undefined ? null : T.nameContext(label)}
        {T.newTab}
      </span>
    </>
  );
  if (target.kind === 'seller' && target.booking.kind === 'post')
    return (
      <BookingForm href={href} postData={target.booking.postData} className={className}>
        {body}
      </BookingForm>
    );
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {body}
    </a>
  );
}
