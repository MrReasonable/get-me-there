import { useId } from 'react';
import { COPY } from '../copy.js';
import { hrefWith, navigateTo } from '../state/urlState.js';
import { NAV_TIERS, navPatch, type ViewId } from '../state/view.js';

/**
 * Spec §11 layout (revision 48, WP19 Task 19.7): one nav for all views in two labelled tiers, Decide (Dates, History)
 * and Set up (Searches, Providers, Alerts, Status). Each tier is a list of real links headed by its name in text, so
 * they work with the keyboard and new tabs; every link is at least 44 px tall (review UI-15). The current view carries
 * `aria-current="page"` and a cue that is not colour alone. Every link keeps the URL's filters (`navPatch`).
 */
export function Nav({ current }: { current: ViewId }) {
  const id = useId();
  return (
    // why: UI-011: a sideways scroll once hid views at 375 px with no affordance; on a phone each tier is its own row,
    // its name first (spec §11), and the phone e2e measures it
    <nav aria-label={COPY.navLabel} className="flex max-w-full flex-col gap-1 sm:flex-row sm:gap-4">
      {NAV_TIERS.map((tier) => {
        const labelId = `${id}-${tier.id}`;
        return (
          <div key={tier.id} className="flex items-center gap-1">
            <span id={labelId} className="pr-1 text-xs font-semibold uppercase text-slate-700">
              {COPY.navTier[tier.id]}
            </span>
            <ul aria-labelledby={labelId} className="flex gap-1 whitespace-nowrap">
              {tier.views.map((v) => (
                <li key={v}>
                  <a
                    href={hrefWith(navPatch(v))}
                    onClick={navigateTo(navPatch(v))}
                    aria-current={v === current ? 'page' : undefined}
                    // why: the current entry's thick bar is drawn in currentColor, so the cue survives forced colours
                    // and greyscale; the others are underlined links (spec §11: no colour-only meaning)
                    className={`inline-flex min-h-11 items-center px-2 text-sm sm:px-3 ${v === current ? 'border-b-4 border-current font-bold text-slate-900' : 'text-slate-800 underline'}`}
                  >
                    {COPY.nav[v]}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
