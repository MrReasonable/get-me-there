import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Secret } from '@gmt/core';
import { loadRecordedFixture } from '../http/recorder.js';
import { containsSecret } from '../http/scrub.js';
import { loadParamsAllowlist } from '../params/allowlist.js';
import { isRecord } from '../util.js';

// The fixture-tree verifier (spec §9 item 2 fixture-tree rules), exported for WP4b's record tool and tests and used
// by this package's own tree test. Each function returns the problems it found; an empty list means clean.

/** A recording's request must target its provider's real host (prov-003 cross-check); vendor hosts, not airports. */
const PROVIDER_HOST: Readonly<Record<string, string>> = {
  searchapi: 'www.searchapi.io',
  travelpayouts: 'api.travelpayouts.com',
};

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

const skipped = (f: string): boolean => f.endsWith('.gitkeep') || f.endsWith('.raw.json');

/**
 * Problems with one file of a recorded tree: a `params-*.json` must load through loadParamsAllowlist, anything else
 * through loadRecordedFixture (hash, recordedBy, recordedAt, session, location, file name, response headers) with its
 * request host in its provider's allowlist; no secret may appear in any form.
 */
export function verifyRecordedFile(
  path: string,
  recordedRoot: string,
  secrets: readonly Secret[] = [],
): string[] {
  const problems: string[] = [];
  if (!path.endsWith('.json')) return ['not a JSON file'];
  if (containsSecret(readFileSync(path, 'utf8'), secrets)) problems.push('holds a secret');
  try {
    if ((path.split(sep).at(-1) ?? '').startsWith('params-')) loadParamsAllowlist(path, recordedRoot);
    else {
      const rec = loadRecordedFixture(path, recordedRoot);
      if (new URL(rec.request.url).hostname !== PROVIDER_HOST[rec.providerId])
        problems.push(`request host is not ${rec.providerId}'s`);
    }
  } catch (e) {
    problems.push(e instanceof Error ? e.message : String(e));
  }
  return problems;
}

/** Every problem under a recorded root (`…/fixtures/recorded`), each prefixed with the file's relative path. */
export function verifyRecordedTree(recordedRoot: string, secrets: readonly Secret[] = []): string[] {
  return walk(recordedRoot)
    .filter((f) => !skipped(f))
    .flatMap((f) =>
      verifyRecordedFile(f, recordedRoot, secrets).map((p) => `${relative(recordedRoot, f)}: ${p}`),
    );
}

/**
 * Every problem in a whole fixtures root (`…/fixtures`): files live only under synthetic/fixture/ or recorded/ and
 * are JSON; synthetic files carry `synthetic: true` and no recording fields; recorded files pass verifyRecordedFile;
 * no file holds a secret. Paths are relative to the fixtures root.
 */
export function verifyFixturesTree(root: string, secrets: readonly Secret[] = []): string[] {
  const problems: string[] = [];
  const recordedRoot = join(root, 'recorded');
  for (const f of walk(root).filter((x) => !skipped(x))) {
    const rel = relative(root, f);
    const fail = (why: string): void => {
      problems.push(`${rel}: ${why}`);
    };
    if (rel.startsWith(`recorded${sep}`)) {
      for (const p of verifyRecordedFile(f, recordedRoot, secrets)) fail(p);
      continue;
    }
    if (!f.endsWith('.json')) {
      fail('not a JSON file');
      continue;
    }
    const text = readFileSync(f, 'utf8');
    if (containsSecret(text, secrets)) fail('holds a secret');
    if (rel.startsWith(`synthetic${sep}fixture${sep}`)) {
      const parsed: unknown = JSON.parse(text);
      if (!isRecord(parsed) || parsed.synthetic !== true) fail('synthetic file without "synthetic": true');
      else if ('recordedAt' in parsed || 'contentSha256' in parsed)
        fail('synthetic file with recording fields');
    } else fail('outside synthetic/fixture and recorded');
  }
  return problems;
}
