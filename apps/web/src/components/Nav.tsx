import { COPY } from '../copy.js';
import { hrefWith, navigateTo } from '../state/urlState.js';
import { VIEWS, type ViewId } from '../state/view.js';

/**
 * Spec §11: nav for all views, owned by WP9. Links are real links, so they work with the keyboard
 * and new tabs; each is at least 44 px tall (touch target, review UI-15).
 */
export function Nav({ current }: { current: ViewId }) {
  return (
    // why: eight links scroll sideways on a phone instead of wrapping into three 44px rows (UI-15).
    <nav aria-label={COPY.navLabel} className="max-w-full overflow-x-auto">
      <ul className="flex gap-1 whitespace-nowrap">
        {VIEWS.map((v) => (
          <li key={v}>
            <a
              href={hrefWith({ view: v })}
              onClick={navigateTo({ view: v })}
              aria-current={v === current ? 'page' : undefined}
              className={`inline-flex min-h-11 items-center rounded px-3 text-sm ${v === current ? 'bg-slate-900 text-white' : 'text-slate-800 underline'}`}
            >
              {COPY.nav[v]}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
