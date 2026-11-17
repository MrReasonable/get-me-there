import { COPY } from '../copy.js';
import { hrefWith, navigateTo } from '../state/urlState.js';
import { NAV_ITEMS, NAV_VIEW, type NavItem, navPatch } from '../state/view.js';

/** A nav link's patch: its view's, and for Trips (which names no search) with `def=` dropped (ruling R-bar). */
const patchFor = (item: NavItem) =>
  item === 'trips' ? { ...navPatch(NAV_VIEW.trips), def: null } : navPatch(NAV_VIEW[item]);

/**
 * The nav (design 2026-11-08 Ruling 9): two real links, Trips and Settings, in one row at every width (no menu). Every
 * other view sits under one of them (`navItemOf`), which carries `aria-current="page"` there; a link is 44 px tall.
 * The current item has a thick bar drawn in currentColor, so the cue survives forced colours and greyscale (spec
 * §11: no colour-only meaning).
 */
export function Nav({ current }: { current: NavItem }) {
  return (
    <nav aria-label={COPY.navLabel} className="nav">
      <ul className="flex gap-0.5 whitespace-nowrap">
        {NAV_ITEMS.map((item) => (
          <li key={item}>
            <a
              href={hrefWith(patchFor(item))}
              onClick={navigateTo(patchFor(item))}
              aria-current={item === current ? 'page' : undefined}
              className={`nav-link min-h-11 ${item === current ? 'border-b-4 border-current font-bold' : ''}`}
            >
              {COPY.nav[item]}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
