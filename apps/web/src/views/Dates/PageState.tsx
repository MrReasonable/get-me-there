import type { StartRefusalCode } from '@gmt/core';
import type { DefinitionResponse } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { NeverRun, Refused, RunningLine } from './States.js';
import { StoppedLine } from './StoppedLine.js';
import type { StateLine } from './stateLines.js';

const P = COPY.searchPage;

/**
 * Spec rev 55 §11 "State line" (WP20 Task 20.6), in its polite status region: the visible line is not live, since its
 * counts move on every poll; a hidden status says only the kind of state, or the stop's sentence, so a poll that moves a
 * count announces nothing new. What it shows: a refused Search now (while the search has no run); the never-run state
 * with Search now, or the way to set up a source; a stopped run's sentence, fix and Resume; "Dates changed …"; the
 * searching, reading and checking lines with Cancel. A searched run's line is the header line above it, in its one
 * place; the status still says "Searched". The running, reading and stopped lines count the whole search (ruling
 * R-scope), so their buckets are the whole search's, or none when the page's read is narrowed to some airport pairs.
 */
export function PageState({
  definition,
  line,
  refused,
  executionId,
  resumable,
  buckets,
}: {
  definition: DefinitionResponse;
  line: StateLine | null;
  refused: StartRefusalCode | null;
  executionId: string | null;
  /** The latest run's status is one the api resumes (core's `RESUMABLE_ACTIVE_STATUSES`). */
  resumable: boolean;
  /** The whole search's six buckets under the count, or null when the read covers some airport pairs only. */
  buckets: string | null;
}) {
  const said =
    refused !== null
      ? null
      : line === null
        ? ''
        : line.kind === 'stopped' || line.kind === 'never'
          ? line.text
          : P.stateKind[line.kind];
  return (
    <>
      <div data-testid="state-line" className="state-line">
        {refused !== null ? (
          <Refused definitionId={definition.id} code={refused} />
        ) : line === null ? null : line.kind === 'never' ? (
          <NeverRun definition={definition} line={line} />
        ) : line.kind === 'stopped' ? (
          executionId === null ? null : (
            <StoppedLine
              executionId={executionId}
              stop={line.stop}
              noneSearched={line.noneSearched}
              resumable={resumable}
              buckets={buckets}
            />
          )
        ) : line.kind === 'searched' ? null : line.kind === 'changed' ? (
          <p className="plate notice font-bold">{line.text}</p>
        ) : executionId === null ? null : (
          <RunningLine
            text={line.text}
            executionId={executionId}
            buckets={line.kind === 'searching' ? buckets : null}
          />
        )}
      </div>
      {said === null ? null : (
        <p role="status" aria-label={P.stateLabel} className="sr-only">
          {said}
        </p>
      )}
    </>
  );
}
