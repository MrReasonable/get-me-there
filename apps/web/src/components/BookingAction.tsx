import { type Booking, LINK_ALLOWLIST, type ProviderId, validateVendorUrl } from '@gmt/core';
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

/** GET link with host, POST as a form button (never auto-submitted), or "no link" (spec §11). */
export function BookingAction({ booking, providerId }: { booking: Booking; providerId: ProviderId }) {
  if (booking.kind === 'none') return <span>{COPY.noLink}</span>;
  const href = safeVendorUrl(booking.url, booking.host, providerId);
  if (href === null) return <span>{COPY.noLink}</span>;
  if (booking.kind === 'get') {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center underline"
      >
        {COPY.openOn(booking.host)}
      </a>
    );
  }
  const fields = [...new URLSearchParams(booking.postData).entries()];
  return (
    <form method="post" action={href} target="_blank" rel="noopener noreferrer">
      {fields.map(([name, value], i) => (
        <input key={`${name}-${i}`} type="hidden" name={name} value={value} />
      ))}
      <button type="submit" className="min-h-11 rounded border border-slate-500 px-3 underline">
        {COPY.continueOnForm(booking.host)}
      </button>
    </form>
  );
}

/**
 * Spec §6.9: the provider's own search link, with core's label as the API sent it (it carries
 * caveats such as "cabin not prefilled"), the host shown; null for synthetic rows.
 */
export function SearchLink({
  link,
  providerId,
}: {
  link: { url: string; host: string; label: string } | null;
  providerId: ProviderId;
}) {
  const href = link === null ? null : safeVendorUrl(link.url, link.host, providerId);
  if (link === null || href === null) return <span>{COPY.noSearchLink}</span>;
  return (
    <span className="flex flex-wrap items-center gap-1">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center underline"
      >
        {link.label}
      </a>
      <span>{COPY.hostShown(link.host)}</span>
    </span>
  );
}
