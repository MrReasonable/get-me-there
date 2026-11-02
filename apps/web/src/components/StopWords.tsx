import { NO_STOP_CAUSE_TEXT } from '@gmt/core';
import type { ExecutionResponse } from '../api/types.js';

/** A stopped run's words: one full sentence and a fix or none (spec rev 55 §8.1 "Stop causes", §10 `stop`). */
export type StopWords = NonNullable<ExecutionResponse['stop']>;

/**
 * The stop to print for a run that has stopped: the api's `stop`, or, for a stopped row the read gave none (a stale
 * read), `NO_STOP_CAUSE_TEXT`. Never a stored status word or error text: "paused: error" is not a sentence (Review
 * Focus 4, ruling 20.2 R1).
 */
export function stopOrNone(stop: StopWords | null | undefined): StopWords {
  return stop ?? NO_STOP_CAUSE_TEXT;
}

/**
 * True when the stop's fix offers Resume: core's structured `fix.resume` flag (never matched on words), so a fix that
 * offers a fresh search instead (a browser page limit, a row with no cause) hides the Resume button.
 */
export function fixNamesResume(stop: StopWords): boolean {
  return stop.fix?.resume === true;
}

/**
 * The sentence as-is, then its fix as a line, with the command (native mode only) as code. No prefix is added: the
 * sentence is whole (`stopText` never starts "Stopped:" or "Paused:").
 */
export function StopSentence({ stop, className }: { stop: StopWords; className?: string }) {
  return (
    <span className={className}>
      <span data-testid="stop-sentence">{stop.sentence}</span>
      {stop.fix === null ? null : (
        <span data-testid="stop-fix" className="ml-1">
          {stop.fix.text}
          {stop.fix.command === null ? null : (
            <>
              {' '}
              <code>{stop.fix.command}</code>
            </>
          )}
        </span>
      )}
    </span>
  );
}
