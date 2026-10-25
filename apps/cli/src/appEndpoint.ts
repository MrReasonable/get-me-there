import { join } from 'node:path/posix';
import { type AppCreds, appUrl, credsFrom } from './appClient.js';
import type { Deps } from './deps.js';
import { factOf, factsOf, serviceSet } from './services/set.js';
import { appEnvPath } from './services/specs.js';
import { readEnvText } from './setup/appEnv.js';
import { appRunningIn, compose } from './setup/docker.js';

/**
 * Where this machine's app answers (review X4): the native app's port and basic auth from app.env while its service
 * runs; else the Docker app's host port, as compose publishes it for the container's 3000, and the basic auth in the
 * checkout's `.env`, read and never printed; else none, saying why. `unknown` when Docker answered but whether its app
 * runs could not be read (compose failed or printed what is not its JSON), so a caller that must not interrupt a run
 * can refuse rather than guess. One reader for every command that asks the app something (the active-run guard of
 * `gmt consent`; `gmt status` for a Docker app reuses it). A guessed port is never tried: it could be another
 * program's, and the credentials would go to it.
 */
export type AppEndpoint =
  | {
      kind: 'native' | 'docker';
      baseUrl: string;
      /** The basic auth (and the port it is for), or null when the settings hold none. */
      creds: AppCreds | null;
      /** AUTO_RESUME as the app reads it (true unless set to false). */
      autoResume: boolean;
    }
  | { kind: 'none'; reason: string }
  | { kind: 'unknown'; reason: string };

const autoResumeOf = (r: Readonly<Record<string, string | undefined>>): boolean => r.AUTO_RESUME !== 'false';

function readText(deps: Deps, path: string): string | null | 'unreadable' {
  try {
    return deps.files.read(path);
  } catch {
    return 'unreadable';
  }
}

export async function appEndpoint(deps: Deps): Promise<AppEndpoint> {
  const native = readText(deps, appEnvPath(deps.platform.paths));
  if (native === 'unreadable')
    return { kind: 'unknown', reason: 'app.env could not be read: check that it is yours (chmod 600)' };
  if (native !== null) {
    const app = serviceSet(deps).find((e) => e.name === 'app');
    const up = app !== undefined && factOf(await factsOf(deps, [app]), app.unit).state === 'running';
    if (!up) return { kind: 'none', reason: 'the app is not running' };
    const r = readEnvText(native);
    const creds = credsFrom(r);
    const port = creds?.port ?? (r.PORT !== undefined && /^\d+$/.test(r.PORT) ? Number(r.PORT) : 3000);
    return { kind: 'native', baseUrl: appUrl(port, ''), creds, autoResume: autoResumeOf(r) };
  }
  const run = (argv: string[]) => deps.run(argv, { cwd: deps.checkout, timeoutMs: 20_000 });
  if ((await run(['docker', '--version'])).code !== 0)
    return { kind: 'none', reason: 'no app is set up here' };
  const ps = await run(compose('ps', '--format', 'json'));
  if (ps.code !== 0)
    return {
      kind: 'unknown',
      reason: 'docker compose ps failed, so whether the Docker app runs is not known',
    };
  if (!appRunningIn(ps.stdout)) return { kind: 'none', reason: 'the Docker app is not running' };
  const published = await run(compose('port', 'app', '3000'));
  const m =
    published.code === 0
      ? /^(?:127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|::):(\d+)$/.exec(published.stdout.trim())
      : null;
  const port = m?.[1] === undefined ? null : Number(m[1]);
  if (port === null || port < 1 || port > 65535)
    return { kind: 'unknown', reason: 'compose did not say which host port the Docker app publishes' };
  const env = readText(deps, join(deps.checkout, '.env'));
  if (env === 'unreadable')
    return {
      kind: 'unknown',
      reason: 'the checkout’s .env could not be read: check that it is yours and readable (chmod 600)',
    };
  const r = env === null ? {} : readEnvText(env);
  const creds = credsFrom(r);
  return {
    kind: 'docker',
    baseUrl: appUrl(port, ''),
    creds: creds === null ? null : { ...creds, port },
    autoResume: autoResumeOf(r),
  };
}
