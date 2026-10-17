// Readers for the repository-level files WP12 ships (Dockerfile, compose, .env.example, docs), shared by the deploy
// tests. They live in apps/api's test tree because the image runs this app: the tests type-check with its
// tsconfig.test.json, pass `pnpm casts` and resolve workspace packages through its Vitest aliases.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root, resolved from this file so the tests run from any cwd. */
export const REPO = fileURLToPath(new URL('../../../../', import.meta.url));

export const SPEC_PATH = 'docs/superpowers/specs/2026-10-14-flight-price-optimiser-design.md';

/** A repository file as UTF-8. */
export function read(relativePath: string): string {
  return readFileSync(join(REPO, relativePath), 'utf8');
}

/** Text strictly between the first `start` marker and the next `end` marker; throws if either is missing. */
export function between(text: string, start: string, end: string): string {
  const i = text.indexOf(start);
  if (i < 0) throw new Error(`marker not found: ${start}`);
  const j = text.indexOf(end, i + start.length);
  if (j < 0) throw new Error(`marker not found: ${end}`);
  return text.slice(i + start.length, j);
}

export interface DockerStage {
  from: string;
  instructions: string[];
}

/**
 * A Dockerfile split into stages of logical instructions: backslash continuations joined, comments and blank lines
 * dropped, whitespace collapsed. Enough for assertions on our own Dockerfile; not a general parser.
 */
export function dockerfileStages(text: string): DockerStage[] {
  const logical: string[] = [];
  let current = '';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (current === '' && (line === '' || line.startsWith('#'))) continue;
    if (line.endsWith('\\')) {
      current += `${line.slice(0, -1).trim()} `;
      continue;
    }
    logical.push(`${current}${line}`.replace(/\s+/g, ' ').trim());
    current = '';
  }
  const stages: DockerStage[] = [];
  for (const instruction of logical) {
    if (instruction.startsWith('FROM ')) stages.push({ from: instruction, instructions: [] });
    else stages.at(-1)?.instructions.push(instruction);
  }
  return stages;
}

/**
 * Every variable name a spec §12 style block defines: `NAME=` lines plus the names in each
 * `# overrides: FULL_NAME, _SUFFIX, …` comment (a suffix takes the first name's prefix). Commented assignments
 * (`# IN_CONTAINER=1`) are not operator variables and are skipped.
 */
export function envExampleVariables(text: string): string[] {
  const names = new Set<string>();
  for (const line of text.split('\n')) {
    const assign = /^([A-Z][A-Z0-9_]*)=/.exec(line);
    if (assign?.[1]) names.add(assign[1]);
    const overrides = /^# overrides: (.+)$/.exec(line);
    if (overrides?.[1]) {
      const items = overrides[1].split(',').map((s) => s.trim());
      const first = items[0] ?? '';
      const prefix = first.slice(0, first.indexOf('_'));
      for (const item of items) names.add(item.startsWith('_') ? `${prefix}${item}` : item);
    }
  }
  return [...names].sort();
}

/** The fenced block that follows the "## 12. Configuration" heading of the spec. */
export function specEnvBlock(): string {
  const section = read(SPEC_PATH).split('## 12. Configuration')[1] ?? '';
  return between(section, '```\n', '\n```');
}
