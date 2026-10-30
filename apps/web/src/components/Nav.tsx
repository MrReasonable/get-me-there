import { type ReactNode, useEffect, useId, useState } from 'react';
import { COPY } from '../copy.js';
import { PHONE_QUERY, useMediaQuery } from '../hooks/useMediaQuery.js';
import { hrefWith, navigateTo } from '../state/urlState.js';
import { NAV_TIERS, navPatch, type ViewId } from '../state/view.js';

/** The tier a view sits in, or null for the date pair detail (in neither, spec §11). */
const tierOf = (v: ViewId) => NAV_TIERS.find((t) => t.views.includes(v)) ?? null;

/** Both tiers: each a list of real links headed by its name in text. */
function Tiers({ current, labelPrefix }: { current: ViewId; labelPrefix: string }) {
  return NAV_TIERS.map((tier) => {
    const labelId = `${labelPrefix}-${tier.id}`;
    return (
      <div key={tier.id} className="flex flex-wrap items-center gap-1">
        <span id={labelId} className="nav-tier-name">
          {COPY.navTier[tier.id]}
        </span>
        <ul aria-labelledby={labelId} className="flex flex-wrap gap-0.5 whitespace-nowrap">
          {tier.views.map((v) => (
            <li key={v}>
              <a
                href={hrefWith(navPatch(v))}
                onClick={navigateTo(navPatch(v))}
                aria-current={v === current ? 'page' : undefined}
                // why: the current entry is an inverted flap tile with a thick bar drawn in currentColor, so the cue
                // survives forced colours and greyscale (spec §11: no colour-only meaning)
                className={`nav-link min-h-11 ${v === current ? 'border-b-4 border-current font-bold' : ''}`}
              >
                {COPY.nav[v]}
              </a>
            </li>
          ))}
        </ul>
      </div>
    );
  });
}

/**
 * Spec §11 layout (revision 48, WP19 Task 19.7): one nav for all views in two labelled tiers, Decide (Dates, History)
 * and Set up (Searches, Providers, Alerts, Status). Each tier is a list of real links headed by its name in text, so
 * they work with the keyboard and new tabs; every link is at least 44 px tall (review UI-15). The current view carries
 * `aria-current="page"` and a cue that is not colour alone. Every link keeps the URL's filters (`navPatch`).
 *
 * Below 900 px the nav is one row (the departure board, Ian 2026-10-27: the board must start in a phone's first
 * screen): the current tier and view, and "All views", which opens both tiers and `menu` (the search selector).
 */
export function Nav({ current, menu }: { current: ViewId; menu?: ReactNode }) {
  const id = useId();
  const phone = useMediaQuery(PHONE_QUERY);
  const [open, setOpen] = useState(false);
  // why: following a link closes the menu, so the new view starts with its board in view
  useEffect(() => setOpen(false), [current]);
  if (!phone)
    return (
      <nav aria-label={COPY.navLabel} className="flex max-w-full flex-wrap items-center gap-x-6 gap-y-1">
        <Tiers current={current} labelPrefix={id} />
      </nav>
    );
  const tier = tierOf(current);
  return (
    <nav
      aria-label={COPY.navLabel}
      className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          setOpen(false);
          document.getElementById(`${id}-menu`)?.focus();
        }
      }}
    >
      {tier !== null ? (
        <span className="flex min-w-0 items-center gap-1">
          <span className="nav-tier-name">{COPY.navTier[tier.id]}</span>
          <span className="nav-link border-b-4 border-current font-bold nav-here">{COPY.nav[current]}</span>
        </span>
      ) : null}
      <button
        id={`${id}-menu`}
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        className="btn btn-quiet btn-sm ml-auto nav-menu-button"
        onClick={() => setOpen((o) => !o)}
      >
        {COPY.navMenu}
        <span aria-hidden="true">{open ? '▲' : '▼'}</span>
      </button>
      <div id={`${id}-panel`} hidden={!open} className="nav-panel w-full">
        <Tiers current={current} labelPrefix={id} />
        {menu}
      </div>
    </nav>
  );
}
