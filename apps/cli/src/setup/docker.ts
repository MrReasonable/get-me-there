import type { Deps } from '../deps.js';
import type { Problem } from './prereqs.js';

/** The compose project and volume names a Docker install of this repository has (docker-compose.yml `name:`). */
export const COMPOSE_PROJECT = 'get-me-there';
export const COMPOSE_VOLUME = 'get-me-there_gmt-data';
export const compose = (...args: string[]): string[] => ['docker', 'compose', '-p', COMPOSE_PROJECT, ...args];

/** What `docker` says about an earlier install (spec §13 "One app per ledger"). */
export interface DockerFacts {
  command: boolean;
  daemon: boolean;
  /** A compose project `get-me-there` exists, running or stopped. */
  project: boolean;
  volume: boolean;
}

/** Reads the facts: stops after a missing command or a daemon that does not answer. */
export async function gatherDocker(deps: Deps): Promise<DockerFacts> {
  const run = (argv: string[]) => deps.run(argv, { cwd: deps.checkout, timeoutMs: 20_000 });
  const none: DockerFacts = { command: false, daemon: false, project: false, volume: false };
  if ((await run(['docker', '--version'])).code !== 0) return none;
  if ((await run(['docker', 'info', '--format', '{{.ServerVersion}}'])).code !== 0)
    return { ...none, command: true };
  const ps = await run(compose('ps', '-a', '--format', 'json'));
  const volume = await run(['docker', 'volume', 'inspect', COMPOSE_VOLUME]);
  return {
    command: true,
    daemon: true,
    project: ps.code === 0 && ps.stdout.trim() !== '',
    volume: volume.code === 0,
  };
}

/**
 * The refusals, pure. With no native install yet, an earlier compose project or its volume refuses unless the operator
 * says to move it (`--import-docker`) or mark it moved (`--ignore-docker`); a daemon that does not answer refuses,
 * because nothing could then be checked or marked. A re-run over a native install does not re-judge the old volume.
 */
export function judgeDocker(
  f: DockerFacts,
  flags: { importDocker: boolean; ignoreDocker: boolean; nativeInstalled: boolean },
): Problem[] {
  const p = (message: string): Problem[] => [{ check: 'docker', message, fix: null }];
  const exists = f.project || f.volume;
  if (flags.importDocker) {
    if (f.command && !f.daemon) return p('start Docker so setup can read the compose app to import it');
    return exists
      ? []
      : p(
          `there is no Docker install (no compose project ${COMPOSE_PROJECT} and no volume ${COMPOSE_VOLUME}) to import`,
        );
  }
  if (flags.ignoreDocker) {
    if (f.command && !f.daemon)
      return p(
        'the Docker daemon does not answer, so the compose volume cannot be marked moved: start Docker and run setup again',
      );
    return [];
  }
  if (flags.nativeInstalled || !f.command) return [];
  if (!f.daemon)
    return p('start Docker so setup can check for an existing compose app, or pass --ignore-docker');
  return exists
    ? p(
        'an earlier Docker install exists: use --import-docker to move its data, or --ignore-docker to start fresh (the Docker database is then marked moved)',
      )
    : [];
}
