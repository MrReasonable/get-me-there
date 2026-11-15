import { COPY } from '../../copy.js';
import { datesPatch } from '../../state/datesState.js';
import { hrefWith, navigateTo } from '../../state/urlState.js';

/**
 * Mockup 02's run line under the header: "Searched today 16:40–17:02 · calendar prices for 2,146 of 2,184 dates · 23
 * dates with flights read · what was searched" (`stateLines.ts`'s `runLine`), the last words a link that opens the
 * coverage section (until Task 10 folds it into "What was searched").
 */
export function SearchedLine({ text }: { text: string }) {
  const openCoverage = datesPatch({ coverageOpen: true });
  return (
    <p className="search-run" data-testid="dates-run">
      {text}
      {' · '}
      <a href={hrefWith(openCoverage)} onClick={navigateTo(openCoverage)}>
        {COPY.searchPage.whatWasSearched}
      </a>
    </p>
  );
}
