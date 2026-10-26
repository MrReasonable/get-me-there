import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BlockedPage } from '@gmt/core';
import type { PageFacts } from './classify.js';
import type { SettleFacts } from './driver.js';
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
  kind: 'no-flights' | 'landing',
  day: string,
  facts: { data: Record<string, unknown> },
  secrets: readonly string[],
): void {
  const text = `${JSON.stringify({ recordedAt: day, recordedBy: RECORDED_BY, appeared: facts.data }, null, 2)}\n`;
  assertClean(text, secrets);
  mkdirSync(join(root, kind), { recursive: true, mode: DIR_MODE });
  const file = join(root, kind, 'unrecorded.meta.json');
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

/**
 * Fix round 2 (re-review N4): tightens what an earlier recording left under `root`: every directory below it 0700 and
 * every file 0600, so recordings made before the modes above were applied are no longer readable by others. Symbolic
 * links are left alone (never followed). `root` itself is the checkout's tracked directory and keeps its mode.
 */
export function tightenRecordings(root: string): void {
  if (!existsSync(root)) return;
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = lstatSync(p);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        chmodSync(p, DIR_MODE);
        walk(p);
      } else if (st.isFile()) chmodSync(p, FILE_MODE);
    }
  };
  walk(root);
}

/** The facts a stop record takes from the classifier's last read (diagnostics of 2026-10-18). */
export interface StopFacts {
  page: PageFacts;
  settle: SettleFacts;
}

/** A URL as host and path only: no scheme, port, user or query (never a query string in a stop record). */
export function hostPath(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.hostname}${u.pathname}`;
  } catch {
    return 'unparsable';
  }
}

/**
 * A stop record: the facts the classifier received, every URL reduced to host and path, the rule that fired, what was
 * clicked and the page's headings. Never page HTML, never a query string.
 */
export function stopRecord(o: {
  cause: BlockedPage;
  rule: string;
  kind: RecordingKind;
  landing: string;
  hops: readonly string[];
  socsReadBack: string;
  recordedAt: string;
  facts: StopFacts | null;
  clicked: readonly string[];
  headings: readonly string[];
}): Record<string, unknown> {
  const p = o.facts?.page ?? null;
  return {
    recordedAt: o.recordedAt,
    recordedBy: RECORDED_BY,
    kind: o.kind,
    cause: o.cause,
    rule: o.rule,
    url: hostPath(p?.url ?? o.landing),
    hops: (p?.hops ?? o.hops).map(hostPath),
    frameUrls: (p?.frameUrls ?? []).map(hostPath),
    text: p?.text ?? null,
    accountControl: p?.accountControl ?? null,
    cheapestTabs: p?.cheapestTabs ?? null,
    dateGridButtons: p?.dateGridButtons ?? null,
    resultLinks: p?.resultLinks ?? null,
    settle: o.facts?.settle ?? null,
    clicked: [...o.clicked],
    headings: [...o.headings],
    socsReadBack: o.socsReadBack,
  };
}

/** Writes a stop record to `<root>/stopped/<day>/<n>.facts.json`, 0600 in 0700 directories, after the fail-closed scan. */
export function writeStopRecord(
  root: string,
  day: string,
  rec: Record<string, unknown>,
  secrets: readonly string[],
): string {
  const text = `${JSON.stringify(rec, null, 2)}\n`;
  assertClean(text, secrets);
  const dir = join(root, 'stopped', day);
  mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  const n = nextFactsIndex(dir);
  const file = join(dir, `${n}.facts.json`);
  writeFileSync(file, text, { mode: FILE_MODE });
  return file;
}

function nextFactsIndex(dir: string): number {
  const used = readdirSync(dir)
    .map((f) => /^(\d+)\.facts\.json$/.exec(f)?.[1])
    .filter((x): x is string => x !== undefined)
    .map(Number);
  return used.length === 0 ? 1 : Math.max(...used) + 1;
}

/** An absolute URL that still carries a query string (the graph exploration's last check before writing). */
const URL_WITH_QUERY = /\bhttps?:\/\/[^\s"'<>?]*\?/;

/**
 * Writes one Price graph exploration to `<root>/graph-explore/<day>/<n>.json`, 0600 in 0700 directories, after the
 * fail-closed scan (the key, the SOCS value, an account name or an e-mail address anywhere, the snapshot included) and
 * a check that no URL in it still carries a query string. Exploration only: nothing reads these files yet.
 */
export function writeGraphExplore(
  root: string,
  day: string,
  rec: Record<string, unknown>,
  secrets: readonly string[],
): string {
  return writeExploration(root, 'graph-explore', day, rec, secrets);
}

/** The same write for a `--grid` recording (`<root>/grid/<day>/<n>.json`, WP15 Task 15.1). */
export function writeExploration(
  root: string,
  kind: 'graph-explore' | 'grid',
  day: string,
  rec: Record<string, unknown>,
  secrets: readonly string[],
): string {
  const text = `${JSON.stringify(rec, null, 2)}\n`;
  assertClean(text, secrets);
  if (URL_WITH_QUERY.test(text))
    throw new RecordingRefused('the exploration holds a query string; nothing written');
  const dir = join(root, kind, day);
  mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  chmodSync(join(root, kind), DIR_MODE);
  chmodSync(dir, DIR_MODE);
  const used = readdirSync(dir)
    .map((f) => /^(\d+)\.json$/.exec(f)?.[1])
    .filter((x): x is string => x !== undefined)
    .map(Number);
  const file = join(dir, `${used.length === 0 ? 1 : Math.max(...used) + 1}.json`);
  writeFileSync(file, text, { mode: FILE_MODE });
  return file;
}
