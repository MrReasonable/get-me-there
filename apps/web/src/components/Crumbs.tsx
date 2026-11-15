import { COPY } from '../copy.js';
import { hrefWith, navigateToQuery } from '../state/urlState.js';
import { navPatch } from '../state/view.js';

/** One step of the trail: a link (`href`, as `hrefWith` writes it) or, with none, plain text. */
export interface CrumbItem {
  label: string;
  href?: string;
  /** `data-testid` of the link, for the tests that follow it. */
  testId?: string;
}

/** "Trips": the list of searches, which names no search (`def=` and `edit=` dropped), keeping the other parameters. */
export const tripsCrumb = (): CrumbItem => ({
  label: COPY.crumbs.trips,
  href: hrefWith({ ...navPatch('searches'), def: null, edit: null }),
});

/** A search's own name, linking to its page (Edit and History step back to it). */
export const searchCrumb = (search: { id: string; name: string }): CrumbItem => ({
  label: search.name,
  href: hrefWith({ view: 'dates', def: search.id, edit: null }),
});

/**
 * Ruling 12: the one breadcrumb, a nav named "Breadcrumb" holding an ordered list with decorative separators. The last
 * item is the page itself: `aria-current="page"`, never a link. Every other item with an `href` is a real link that
 * navigates in place to exactly that address (so a filter an `href` keeps travels with the click).
 */
export function Crumbs({ items }: { items: readonly CrumbItem[] }) {
  const last = items.length - 1;
  return (
    <nav aria-label={COPY.crumbsLabel} className="crumbs">
      <ol>
        {items.map((item, i) => (
          // why: labels are unique within one trail (a search's name never equals "Trips" and its own page's name)
          <li key={`${i}-${item.label}`}>
            {i === last ? (
              <span aria-current="page">{item.label}</span>
            ) : item.href === undefined ? (
              <span>{item.label}</span>
            ) : (
              <a
                href={item.href}
                onClick={navigateToQuery(item.href.slice(item.href.indexOf('?')))}
                data-testid={item.testId}
              >
                {item.label}
              </a>
            )}
            {i === last ? null : <span aria-hidden="true"> › </span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}
