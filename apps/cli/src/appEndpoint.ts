/**
 * The one answer to "where is this machine's app, and how does the CLI authenticate to it" (spec §13; W1: the app in
 * Docker with the worker on this machine is a supported mode). `gmt status` reads its report through it, and any command
 * that must ask the running app something (an active-run guard) does the same. The password is read, never printed: it
 * travels only in the Authorization header of an in-process request to 127.0.0.1.
 *
 * - The native app: app.env's port and basic auth.
 * - The app in Docker, when there is no native install: the host port compose publishes for the container's 3000
 *   (docker-compose.yml fixes the container's PORT, so a PORT line in .env is not it) and the basic auth in the
 *   checkout's .env. With no published port known nothing is read or sent: a guessed port could be another program's.
 * - Otherwise none, with the reason.
 */
import { join } from 'node:path/posix';
import { type AppCreds, appUrl, authHeaders, credsFrom } from './appClient.js';
import type { Deps } from './deps.js';
import { appEnvPath } from './services/specs.js';
import { readEnvText } from './setup/appEnv.js';
import { compose, composeServicesRead } from './setup/docker.js';

export type AppEndpoint =
  | {
      kind: 'native' | 'docker';
      /** `http://127.0.0.1:<port>`, with no trailing slash. */
      baseUrl: string;
      port: number;
      creds: AppCreds | null;
      /** The Authorization header when there are credentials, else none. */
      headers: Record<string, string>;
    }
  | { kind: 'none'; reason: string };

const ready = (kind: 'native' | 'docker', port: number, creds: AppCreds | null): AppEndpoint => ({
  kind,
  baseUrl: appUrl(port, ''),
  port,
  creds,
  headers: creds === null ? {} : authHeaders(creds),
});

/** The native app, from app.env: its port and, when app.env has them, the credentials. */
export function nativeEndpoint(deps: Deps): AppEndpoint {
  let text: string | null;
  try {
    text = deps.files.read(appEnvPath(deps.platform.paths));
  } catch {
    return {
      kind: 'none',
      reason: 'app.env could not be read: check that it is yours and readable (chmod 600)',
    };
  }
  if (text === null) return { kind: 'none', reason: 'there is no app.env yet: run pnpm gmt setup' };
  const record = readEnvText(text);
  const creds = credsFrom(record);
  const port =
    creds?.port ?? (record.PORT !== undefined && /^\d+$/.test(record.PORT) ? Number(record.PORT) : 3000);
  return ready('native', port, creds);
}

/**
 * The compose project's `app` (spec §13): running, stopped, absent, `unknown` when docker answered but its compose state
 * could not be read (`docker compose ps` failed, or printed what is not compose's JSON), or null with no docker command.
 */
export type DockerAppState = 'running' | 'stopped' | 'absent' | 'unknown' | null;

export async function dockerAppState(deps: Deps): Promise<DockerAppState> {
  const run = (argv: string[]) => deps.run(argv, { cwd: deps.checkout, timeoutMs: 20_000 });
  if ((await run(['docker', '--version'])).code !== 0) return null;
  const ps = await run(compose('ps', '-a', '--format', 'json'));
  // why: ca-b1-011: one parser for compose's NDJSON or array output
  const services = ps.code === 0 ? composeServicesRead(ps.stdout) : null;
  if (services === null) return 'unknown';
  const app = services.find((s) => s.Service === 'app');
  if (app === undefined) return 'absent';
  return app.State === 'running' ? 'running' : 'stopped';
}

/** The Docker app, given its compose state (read it with dockerAppState). */
export async function dockerEndpoint(deps: Deps, state: DockerAppState): Promise<AppEndpoint> {
  if (state === 'unknown')
    return {
      kind: 'none',
      reason: 'there is no native install, and Docker’s compose state could not be read',
    };
  if (state !== 'running') return { kind: 'none', reason: 'the Docker app is not running' };
  const published = await deps.run(compose('port', 'app', '3000'), { cwd: deps.checkout, timeoutMs: 20_000 });
  const m =
    published.code === 0
      ? /^(?:127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|::):(\d+)$/.exec(published.stdout.trim())
      : null;
  const port = m?.[1] === undefined ? null : Number(m[1]);
  if (port === null || port < 1 || port > 65535)
    return { kind: 'none', reason: 'compose did not say which host port the Docker app publishes' };
  let text: string | null;
  try {
    text = deps.files.read(join(deps.checkout, '.env'));
  } catch {
    return {
      kind: 'none',
      reason: 'the checkout’s .env could not be read: check that it is yours and readable (chmod 600)',
    };
  }
  const creds = text === null ? null : credsFrom(readEnvText(text));
  return ready('docker', port, creds === null ? null : { ...creds, port });
}

/**
 * This machine's app: the native one when there is a native install (by default: app.env is there; a caller that has
 * read the service units passes its own answer), else the Docker app, else none with the reason.
 */
export async function appEndpoint(deps: Deps, opts: { native?: boolean } = {}): Promise<AppEndpoint> {
  const native = opts.native ?? deps.files.mode(appEnvPath(deps.platform.paths)) !== null;
  if (native) return nativeEndpoint(deps);
  const state = await dockerAppState(deps);
  if (state === null || state === 'absent')
    return { kind: 'none', reason: 'there is no app.env yet: run pnpm gmt setup' };
  return dockerEndpoint(deps, state);
}
