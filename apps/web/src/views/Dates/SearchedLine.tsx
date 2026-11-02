import { datesPatch } from '../../state/datesState.js';
import { hrefWith, navigateTo } from '../../state/urlState.js';

/**
 * Spec rev 55 §11 "Header" (WP20 Task 20.6): the search's one plain line from its latest parent run ("Searched today
 * 09:12–11:41 · 300 of 405 date pairs priced, … · the browser worker", `stateLines.ts`'s `searchedLine`), linking to the
 * coverage section, where the six buckets and the set-up terms stay; with a filter set, the scope it covers ("· 2 of 4
 * airport pairs · 10–14 nights"), and the six buckets under the count. It replaces the coverage line on the main path.
 */
export function SearchedLine({
  text,
  scope,
  buckets,
}: {
  text: string;
  scope: readonly string[];
  /** The six buckets under the count (spec rev 55 §3): "by airport pair: 11 priced, 4 no fares, …". */
  buckets: string;
}) {
  const openCoverage = datesPatch({ coverageOpen: true });
  return (
    <div className="space-y-0.5">
      <p className="run-line text-[15px]" data-testid="dates-run">
        <a href={hrefWith(openCoverage)} onClick={navigateTo(openCoverage)} className="underline">
          {text}
        </a>
        {scope.length > 0 ? (
          <span className="ml-1 font-bold text-fg">{` · ${scope.join(' · ')}`}</span>
        ) : null}
      </p>
      <p className="text-sm text-fg-2" data-testid="dates-run-buckets">
        {buckets}
      </p>
    </div>
  );
}
