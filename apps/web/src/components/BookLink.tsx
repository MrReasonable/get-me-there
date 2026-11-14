import { type BookingTarget, LINK_ALLOWLIST, type ProviderId, validateVendorUrl } from '@gmt/core';
import type { ReactNode } from 'react';
import { COPY } from '../copy.js';

const T = COPY.trip;

/**
 * Defence in depth over the API's validation: core's spec §5.2 validator (`https:` only, no userinfo, no port, length
 * cap, host inside the provider's allowlist) and, on top, the URL's host must equal the host the API states, which is
 * what the operator is shown. Anything else is no link.
 */
export function safeVendorUrl(url: string, statedHost: string, providerId: ProviderId): string | null {
  const v = validateVendorUrl(url, LINK_ALLOWLIST[providerId]);
  return v.kind === 'get' && v.host === statedHost ? v.url : null;
}

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

/**
 * The spoken name of a target's link where the price beside it is a whole cell of its own words (a board row's): the
 * amount, the target's words and that it opens in a new tab, with nothing between them but the join.
 */
export function bookLinkName(target: Exclude<BookingTarget, { kind: 'none' }>, amount: string): string {
  return `${amount}${T.priceJoin}${wordsOf(target)}${T.newTab}`;
}

/** The address a target links to, checked against its source's allowlist and its own stated host. */
function addressOf(target: Exclude<BookingTarget, { kind: 'none' }>): string | null {
  if (target.kind === 'seller') return safeVendorUrl(target.booking.url, target.booking.host, 'searchapi');
  // why: the booking page and the Google Flights search are the browser worker's own pages (google.com only)
  return safeVendorUrl(target.url, target.host, 'camoufox');
}

/**
 * Design 2026-11-08 §5.3 and Ruling 10: a price and its booking words as one link, one tab stop, opening the best target
 * in a new tab. The price and the words sit on their own lines; the " · " between them is in the link's spoken name
 * ("£412 · Book on Google Flights ↗, opens in a new tab") and drawn at no size (trip.css), so a wrapped line never
 * starts with it. `label` (what the price is for, such as its flights' times) is spoken too. A seller's POST booking is
 * the same words in a form button, its fields hidden, never submitted on render. The address is checked again here, so
 * one that fails, and a `none` target (a synthetic price is never linked out), show the price without a link.
 */
export function BookLink({
  target,
  price,
  label,
  name,
  className = 'book-link',
}: {
  target: BookingTarget;
  price?: ReactNode;
  label?: string;
  /** The link's whole spoken name (`bookLinkName`), for a price whose own words are too many to be read as the name. */
  name?: string;
  className?: string;
}) {
  const href = target.kind === 'none' ? null : addressOf(target);
  if (target.kind === 'none' || href === null)
    return price === undefined ? null : <span className="book-price">{price}</span>;
  // why: the join is a text node of the link itself, so the spoken name keeps its spaces (an element's own text is
  // trimmed when the name is computed)
  const body = (
    <>
      {price === undefined ? null : (
        <>
          <span className="book-amount">{price}</span>
          {T.priceJoin}
        </>
      )}
      <span className="book-words">{wordsOf(target)}</span>
      {name === undefined ? (
        <span className="sr-only">
          {label === undefined ? null : T.nameContext(label)}
          {T.newTab}
        </span>
      ) : null}
    </>
  );
  if (target.kind === 'seller' && target.booking.kind === 'post') {
    const fields = [...new URLSearchParams(target.booking.postData).entries()];
    return (
      <form method="post" action={href} target="_blank" rel="noopener noreferrer">
        {fields.map(([name, value], i) => (
          <input key={`${name}-${i}`} type="hidden" name={name} value={value} />
        ))}
        <button type="submit" className={className} aria-label={name}>
          {body}
        </button>
      </form>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className} aria-label={name}>
      {body}
    </a>
  );
}
