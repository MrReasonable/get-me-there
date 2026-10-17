/**
 * Gate for tests that read the committed worked-example recordings. The recordings (`fixtures/recorded/**\/*.json`
 * except the tracked `params-*.json`) are gitignored and local-only (plan decisions 61 and 64), so a fresh checkout has
 * none; the suites that need them skip visibly instead of failing or passing vacuously.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Appended to a skipped suite's title so the reporter shows why it did not run. */
export const SKIP_SUFFIX = ' (skipped: recordings not present, local-only, decision 61)';

const isRecording = (name: string): boolean =>
  name.endsWith('.json') && !name.endsWith('.raw.json') && !name.startsWith('params-');

function hasRecording(dir: string): boolean {
  // why: only a missing tree means "not recorded yet"; an unreadable one (EACCES …) still throws as itself.
  if (!existsSync(dir)) return false;
  return readdirSync(dir, { withFileTypes: true }).some((e) =>
    e.isDirectory() ? hasRecording(join(dir, e.name)) : isRecording(e.name),
  );
}

/** True when at least one non-params recording exists under `root`. */
export function recordingsPresent(root: string): boolean {
  return hasRecording(root);
}

/** The suite title, suffixed with the skip reason only when the suite is skipped. */
export const skipTitle = (title: string, present: boolean): string =>
  present ? title : `${title}${SKIP_SUFFIX}`;
