import type { StartRefusalCode } from '@gmt/core';
import { useExecutionActions } from '../../api/queries.js';
import type { DefinitionResponse } from '../../api/types.js';
import { RunProgress, type RunProgressRun } from '../../components/RunProgress.js';
import { COPY } from '../../copy.js';
import { NeverRun, Refused } from './States.js';
import type { StateLine } from './stateLines.js';

const P = COPY.searchPage;
/** The kinds `RunProgress` words: a run going, and one that stopped. */
const RUN_KINDS: ReadonlySet<StateLine['kind']> = new Set(['searching', 'reading', 'checking', 'stopped']);

/**
 * Spec rev 55 §11 "State line", Ruling 11: what a search's page says about its latest run under the run line. A refused
 * Search now (while the search has no run); the never-run state with Search now, or the way to set up a source; "Dates
 * changed since this was last searched"; and, while a run goes or once it stopped, `RunProgress`: the bar, "Reading the
 * calendar …", "Reading flights for the cheapest dates …", Cancel, the stop's sentence and fix, and Resume. A hidden
 * polite status says only the kind of state, so a poll that moves a count announces nothing new (the stop's sentence
 * is announced by `RunProgress` itself).
 */
export function PageState({
  definition,
  line,
  refused,
  progress,
}: {
  definition: DefinitionResponse;
  line: StateLine | null;
  refused: StartRefusalCode | null;
  /** The latest run as `RunProgress` shows it, once the run's own read is in; null before then and without a run. */
  progress: RunProgressRun | null;
}) {
  const { cancel, resume } = useExecutionActions();
  const pending = cancel.isPending ? 'cancel' : resume.isPending ? 'resume' : null;
  const said =
    refused !== null ? null : line === null ? '' : line.kind === 'never' ? line.text : P.stateKind[line.kind];
  return (
    <>
      <div data-testid="state-line" className="state-line">
        {refused !== null ? (
          <Refused definitionId={definition.id} code={refused} />
        ) : line === null ? null : line.kind === 'never' ? (
          <NeverRun definition={definition} line={line} />
        ) : line.kind === 'changed' ? (
          <p className="search-state">{line.text}</p>
        ) : progress !== null && RUN_KINDS.has(line.kind) ? (
          <RunProgress
            run={progress}
            onCancel={() => cancel.mutate(progress.id)}
            onResume={() => resume.mutate(progress.id)}
            pending={pending}
            failure={cancel.error?.message ?? resume.error?.message ?? null}
          />
        ) : null}
      </div>
      {said === null ? null : (
        <p role="status" aria-label={P.stateLabel} className="sr-only">
          {said}
        </p>
      )}
    </>
  );
}
