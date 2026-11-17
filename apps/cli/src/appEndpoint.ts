/**
 * The one answer to "where is this machine's app, and how does the CLI authenticate to it" (spec §13; W1: the app in
 * Docker with the worker on this machine is a supported mode). `gmt status` reads its report through it, and any command
 * that must ask the running app something (an active-run guard) does the same. The password is read, never printed: it
 * travels only in the Authorization header of an in-process request to 127.0.0.1. With no password in the settings
 * (spec §4: only this machine can reach the app) the app is asked all the same, with no Authorization header.
 *
 * - The native app: app.env's port and basic auth, if any.
 * - The app in Docker, when there is no native install: the host port compose publishes for the container's 3000
 *   (docker-compose.yml fixes the container's PORT, so a PORT line in .env is not it) and the basic auth in the
 *   checkout's .env, if any. With no published port known nothing is read or sent: a guessed port could be another
 *   program's.
 * - Otherwise none, with the reason.
 */
import { isIP } from 'node:net';
import { join } from 'node:path/posix';
import { z } from 'zod';
import { type AppTarget, appUrl, authHeaders, targetFrom } from './appClient.js';
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
      target: AppTarget;
      /** The Authorization header when the app has a password, else none. */
      headers: Record<string, string>;
    }
  | { kind: 'none'; reason: string };

const ready = (kind: 'native' | 'docker', target: AppTarget): AppEndpoint => ({
  kind,
  baseUrl: appUrl(target.port, '', target.host),
  port: target.port,
  target,
  headers: authHeaders(target),
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
  return ready('native', targetFrom(readEnvText(text)));
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

const V4_LOCAL: ReadonlySet<string> = new Set(['127.0.0.1', '0.0.0.0']);
const V6_LOCAL: ReadonlySet<string> = new Set(['::1', '::']);

/**
 * An address as compose wrote it, without brackets and in canonical form (compose prints the host text as written, so
 * 0:0:0:0:0:0:0:1 must read as ::1; URL writes the canonical form), or null when it is no IP address.
 */
function ipAddress(text: string): string | null {
  const raw = text.replace(/^\[|\]$/g, '');
  const kind = isIP(raw);
  if (kind === 0) return null;
  return kind === 6 ? new URL(`http://[${raw}]`).hostname.replace(/^\[|\]$/g, '') : raw;
}

/**
 * The host address and port compose publishes for the running container's 3000 (`docker compose port app 3000`), or
 * null when compose does not say. It prints one mapping only, even when the app has two (Docker Compose 5.5, checked
 * 2026-11-17), so it says where to ask the app, never everywhere it is published: composeConfigPublications says that.
 * Addresses have no brackets (`::1`, not `[::1]`). Inside the container the app binds 0.0.0.0.
 */
export async function dockerPublications(deps: Deps): Promise<{ address: string; port: number }[] | null> {
  const r = await deps.run(compose('port', 'app', '3000'), { cwd: deps.checkout, timeoutMs: 20_000 });
  if (r.code !== 0) return null;
  const out: { address: string; port: number }[] = [];
  for (const line of r.stdout.split('\n')) {
    // why: any valid IP, so status can judge a LAN address; dockerEndpoint alone limits where credentials may go
    const m = /^(.+):(\d+)$/.exec(line.trim());
    const address = m?.[1] === undefined ? null : ipAddress(m[1]);
    if (address !== null && m?.[2] !== undefined) out.push({ address, port: Number(m[2]) });
  }
  return out.length === 0 ? null : out;
}

/** The part of `docker compose config --format json` read here: the app's `ports`, nothing else. */
const configPortsSchema = z.looseObject({
  services: z.looseObject({
    app: z.looseObject({
      ports: z
        .array(
          z.looseObject({
            host_ip: z.string().optional(),
            published: z.union([z.string(), z.number()]).optional(),
          }),
        )
        .optional(),
    }),
  }),
});

/**
 * Every host address the app is published on by compose's effective configuration, every compose file and override
 * included (spec §4: the app trusts PUBLISHED_ADDRESS, which an extra `ports:` mapping leaves behind), or null when
 * compose does not say. The JSON holds the interpolated environment, secrets included, so it is parsed here, in process,
 * and only `ports` is taken; it is never printed, logged or written. A mapping with no host address publishes on every
 * interface (0.0.0.0).
 */
export async function composeConfigPublications(
  deps: Deps,
): Promise<{ address: string; port: number }[] | null> {
  const r = await deps.run(compose('config', '--format', 'json'), { cwd: deps.checkout, timeoutMs: 20_000 });
  if (r.code !== 0) return null;
  let json: unknown;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    return null;
  }
  const parsed = configPortsSchema.safeParse(json);
  if (!parsed.success) return null;
  const out: { address: string; port: number }[] = [];
  for (const p of parsed.data.services.app.ports ?? []) {
    const address = p.host_ip === undefined || p.host_ip === '' ? '0.0.0.0' : ipAddress(p.host_ip);
    // why: a host address that is no IP (a name) is not loopback, so it is judged as written
    out.push({ address: address ?? p.host_ip ?? '', port: Number(p.published ?? 0) });
  }
  return out;
}

/** Where the Docker app may be asked on this machine, from what compose publishes, or why it may not be. */
export type LoopbackPublication = { ok: true; port: number; host: string } | { ok: false; reason: string };

/**
 * The one choice of where to ask the Docker app (appEndpoint and the import's guard): its published port in the loopback
 * family compose published (IPv4 first when both; 0.0.0.0 and :: include loopback), never another address.
 */
export function loopbackPublication(
  published: ReadonlyArray<{ address: string; port: number }> | null,
): LoopbackPublication {
  const list = published ?? [];
  // why: the basic auth is sent only to this machine's loopback, in the family compose published (IPv4 first when both):
  // a port published on another address, or on a family that was not, could belong to another program on 127.0.0.1
  const v4 = list.find((p) => V4_LOCAL.has(p.address));
  const v6 = list.find((p) => V6_LOCAL.has(p.address));
  const chosen = v4 ?? v6;
  const unsaid = 'compose did not say which host port the Docker app publishes';
  if (chosen === undefined)
    return {
      ok: false,
      reason:
        list[0] === undefined
          ? unsaid
          : `compose publishes the Docker app on ${list[0].address}, not on this machine’s loopback`,
    };
  if (chosen.port < 1 || chosen.port > 65535) return { ok: false, reason: unsaid };
  return { ok: true, port: chosen.port, host: v4 === undefined ? '[::1]' : '127.0.0.1' };
}

/** The Docker app, given its compose state (read it with dockerAppState). */
export async function dockerEndpoint(deps: Deps, state: DockerAppState): Promise<AppEndpoint> {
  if (state === 'unknown')
    return {
      kind: 'none',
      reason: 'there is no native install, and Docker’s compose state could not be read',
    };
  if (state !== 'running') return { kind: 'none', reason: 'the Docker app is not running' };
  const where = loopbackPublication(await dockerPublications(deps));
  if (!where.ok) return { kind: 'none', reason: where.reason };
  const { port, host } = where;
  let text: string | null;
  try {
    text = deps.files.read(join(deps.checkout, '.env'));
  } catch {
    return {
      kind: 'none',
      reason: 'the checkout’s .env could not be read: check that it is yours and readable (chmod 600)',
    };
  }
  // why: no .env (or no auth lines in it) is an app with no password, asked without an Authorization header
  return ready('docker', { ...targetFrom(readEnvText(text ?? '')), port, host });
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
