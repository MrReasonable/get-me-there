import type { ReducedMark } from '@gmt/core';
import type { DefinitionResponse, SearchCard } from '../../../api/types.js';
import { COPY } from '../../../copy.js';
import { isThinCoverage } from '../../../lib/thinCoverage.js';
import { CoverageSection } from '../CoverageSection.js';
import { Fold } from './Fold.js';

const F = COPY.searchPage.folds;
/** The five marks in the order the rows give them: found first, then what went wrong, then what was never tried. */
const MARKS: readonly ReducedMark[] = [
  'priced',
  'no-price-shown',
  'couldnt-read',
  'not-reached',
  'not-searched',
];

/**
 * Ruling 19, "What was searched": the latest run's five marks over its whole space (they sum to the total the summary
 * names), then the dates with flights read (Ruling 6, across every search so far), the thin-coverage line when it
 * applies, and "Full search log", which opens the coverage section beneath.
 */
export function WhatWasSearched({
  definition,
  card,
  readDates,
  coverageOpen,
  requested,
  onHandled,
}: {
  definition: DefinitionResponse;
  card: SearchCard | null;
  readDates: number;
  coverageOpen: boolean;
  requested: boolean;
  onHandled: () => void;
}) {
  const run = card?.latestRun ?? null;
  const marks = run?.marks ?? null;
  const searched = marks === null ? 0 : marks.priced + marks['no-price-shown'];
  return (
    <Fold
      id="what-was-searched"
      title={F.searched}
      state={run === null ? null : F.searchedSummary(run.marks.priced, run.datePairs)}
      requested={requested}
      onHandled={onHandled}
    >
      {marks === null ? (
        <p>{F.searchedNone}</p>
      ) : (
        <table className="sfold-table">
          <tbody>
            {MARKS.map((m) => (
              <tr key={m}>
                <th scope="row">{F.marks[m]}</th>
                <td className="sfold-count">{F.count(marks[m])}</td>
                <td className="sfold-why">{F.markNotes[m]}</td>
              </tr>
            ))}
            <tr>
              <th scope="row">{F.flightsRead}</th>
              <td className="sfold-count">{F.flightsReadValue(readDates)}</td>
              <td className="sfold-why">{F.flightsReadNote}</td>
            </tr>
          </tbody>
        </table>
      )}
      {marks !== null && isThinCoverage(marks['no-price-shown'], searched) ? (
        <p className="sfold-note">{F.thin}</p>
      ) : null}
      <CoverageSection definition={definition} open={coverageOpen} />
    </Fold>
  );
}
