import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RECORDED_BY, type RecordingKind, RecordingRefused } from './recordArgs.js';

/**
 * What the recorder writes and the fail-closed scan before every write (brief Task 14.2 rule 6; split from record.ts in
 * fix round 1, arch M15). Recordings are local-only and gitignored (decision 61); they hold landing URLs with their
 * queries, so each file is written 0600 in a 0700 directory, like the rest of the worker's state (fix round 1, sec M6).
 */
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
/** Rule 6: nothing is written when the recording holds the key, the SOCS value, an account name or an e-mail address. */
export function assertClean(text: string, secrets: readonly string[]): void {
  for (const s of secrets)
    if (s !== '' && text.includes(s))
      throw new RecordingRefused('the recording holds a secret; nothing written');
  if (text.includes('Google Account:'))
    throw new RecordingRefused('the recording holds an account name; nothing written');
  if (EMAIL.test(text)) throw new RecordingRefused('the recording holds an e-mail address; nothing written');
}

function nextIndex(dir: string): number {
  if (!existsSync(dir)) return 1;
  const used = readdirSync(dir)
    .map((f) => /^(\d+)\.meta\.json$/.exec(f)?.[1])
    .filter((x): x is string => x !== undefined)
    .map(Number);
  return used.length === 0 ? 1 : Math.max(...used) + 1;
}

export interface PageRecording {
  facts: unknown;
  meta: Record<string, unknown>;
}

/** Writes one recording pair after the fail-closed scan; returns the facts path. */
export function writeRecording(
  root: string,
  kind: RecordingKind,
  day: string,
  rec: PageRecording,
  secrets: readonly string[],
): string {
  const factsText = `${JSON.stringify(rec.facts, null, 2)}\n`;
  const contentSha256 = createHash('sha256').update(factsText).digest('hex');
  const metaText = `${JSON.stringify({ ...rec.meta, contentSha256 }, null, 2)}\n`;
  assertClean(factsText + metaText, secrets);
  const dir = join(root, kind, day);
  mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  const n = nextIndex(dir);
  writeFileSync(join(dir, `${n}.facts.json`), factsText, { mode: FILE_MODE });
  writeFileSync(join(dir, `${n}.meta.json`), metaText, { mode: FILE_MODE });
  return join(dir, `${n}.facts.json`);
}

export function writeUnrecorded(
  root: string,
  day: string,
  facts: { data: Record<string, unknown> },
  secrets: readonly string[],
): void {
  const text = `${JSON.stringify({ recordedAt: day, recordedBy: RECORDED_BY, appeared: facts.data }, null, 2)}\n`;
  assertClean(text, secrets);
  mkdirSync(join(root, 'no-flights'), { recursive: true, mode: DIR_MODE });
  const file = join(root, 'no-flights', 'unrecorded.meta.json');
  writeFileSync(file, text, { mode: FILE_MODE });
  // why: a second run overwrites the file, whose mode writeFileSync leaves as it was
  chmodSync(file, FILE_MODE);
}

export function stripQuery(u: string): string {
  try {
    const x = new URL(u);
    return `${x.origin}${x.pathname}`;
  } catch {
    return 'unparsable';
  }
}
