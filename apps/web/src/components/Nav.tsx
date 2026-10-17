import { COPY } from '../copy.js';
import { hrefWith, navigateTo } from '../state/urlState.js';
import { VIEWS, type ViewId } from '../state/view.js';

/**
 * Spec §11: nav for all views, owned by WP9. Links are real links, so they work with the keyboard
 * and new tabs; each is at least 44 px tall (touch target, review UI-15).
 */
export function Nav({ current }: { current: ViewId }) {
  return (
    // why: UI-011: a sideways scroll hid three views at 375 px with no affordance; with the phone padding the eight
    // links wrap into two 44 px rows (UI-15's worry was three), every view in sight.
    <nav aria-label={COPY.navLabel} className="max-w-full">
      <ul className="flex flex-wrap gap-1 whitespace-nowrap">
        {VIEWS.map((v) => (
          <li key={v}>
            <a
              href={hrefWith({ view: v })}
              onClick={navigateTo({ view: v })}
              aria-current={v === current ? 'page' : undefined}
              className={`inline-flex min-h-11 items-center rounded px-2 text-sm sm:px-3 ${v === current ? 'bg-slate-900 text-white' : 'text-slate-800 underline'}`}
            >
              {COPY.nav[v]}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
