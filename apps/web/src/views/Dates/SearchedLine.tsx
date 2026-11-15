import { COPY } from '../../copy.js';
import { DATES_PARAMS } from '../../state/datesState.js';
import { hrefWith, navigateTo } from '../../state/urlState.js';

/**
 * Mockup 02's run line under the header: "Searched today 16:40–17:02 · calendar prices for 2,146 of 2,184 dates · 23
 * dates with flights read · what was searched" (`stateLines.ts`'s `runLine`), the last words a link that opens the
 * "What was searched" fold under the calendar (Ruling 19).
 */
export function SearchedLine({ text }: { text: string }) {
  const openFold = { [DATES_PARAMS.fold]: 'searched' };
  return (
    <p className="search-run" data-testid="dates-run">
      {text}
      {' · '}
      <a href={hrefWith(openFold)} onClick={navigateTo(openFold)}>
        {COPY.searchPage.whatWasSearched}
      </a>
    </p>
  );
}
