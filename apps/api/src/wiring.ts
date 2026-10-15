/**
 * The wiring helper (part 1 of 2; Task 3 completes the file): one config parse and one port construction shared by the app bootstrap (WP8)
 * and the tool bootstrap (this package). Spec §4 (both bootstraps are built on this helper and parse the
 * environment once through the core schema), §5.5, §7, §12.
 *
 * This module never reads the process environment: the bootstraps pass it in (the boundary script enforces it).
 */
import { lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { type Config, type ConfigError, parseConfig } from '@gmt/core';

/** Thrown by loadConfigFromEnv; the message names every failing field and never a value (spec §12). */
export class InvalidConfigError extends Error {
  readonly errors: readonly ConfigError[];
  constructor(errors: readonly ConfigError[]) {
    super(`invalid configuration: ${errors.map((e) => `${e.field}: ${e.message}`).join('; ')}`);
    this.name = 'InvalidConfigError';
    this.errors = errors;
  }
}

function errnoCode(e: unknown): string | undefined {
  return e instanceof Error && 'code' in e && typeof e.code === 'string' ? e.code : undefined;
}

/**
 * realpath that tolerates a database file that does not exist yet by resolving its directory
 * (plan Config contract). Spec §5.5: the synthetic gate's suffix checks run on the resolved path.
 * A dangling symlink is refused: its own name could pass the `.fixture.db` suffix check while
 * SQLite would create the file it points at (prov-wp04b-001).
 */
export function tolerantRealpath(p: string): string {
  if (p === ':memory:') return p;
  try {
    return realpathSync(p);
  } catch (e) {
    if (errnoCode(e) !== 'ENOENT') throw e;
    let dangling = false;
    try {
      dangling = lstatSync(p).isSymbolicLink();
    } catch {
      // why: lstat ENOENT means nothing exists at p, the first-boot case handled below.
    }
    if (dangling)
      throw new Error(`${p} is a symbolic link to a file that does not exist; refusing (spec §5.5)`);
    // why: a first boot has no DB file yet; a missing *directory* still fails, as it should.
    return join(realpathSync(dirname(p)), basename(p));
  }
}

/**
 * Parses the environment once through the core schema (spec §12). Throws InvalidConfigError naming
 * every bad field; a DATABASE_PATH that cannot be resolved is reported as that field, never a value.
 */
export function loadConfigFromEnv(env: NodeJS.ProcessEnv): Config {
  let result: ReturnType<typeof parseConfig>;
  try {
    result = parseConfig(env, { realpath: tolerantRealpath });
  } catch (e) {
    throw new InvalidConfigError([
      {
        field: 'DATABASE_PATH',
        message: `cannot be resolved (${errnoCode(e) ?? (e instanceof Error ? e.message : 'error')})`,
      },
    ]);
  }
  if (!result.ok) throw new InvalidConfigError(result.errors);
  return result.config;
}
