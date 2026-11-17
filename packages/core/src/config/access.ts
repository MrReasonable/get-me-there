/**
 * Who can reach the app (spec §4 "Auth and request hardening"): the one rule for when the app may run without a
 * password. Config (parseConfig), the boot guard (bootApp's assertAuthInvariants), the Status report and the CLI's setup
 * all read it from here, so there is no second copy.
 *
 * The app may run without a password exactly when only this machine can reach it:
 * 1. it is reachable only on loopback: natively its BIND_ADDRESS is loopback; in the container (which binds 0.0.0.0, so
 *    the app cannot see this itself) the address compose publishes it on, PUBLISHED_ADDRESS, is loopback; and
 * 2. it answers only to this machine's names: every ALLOWED_HOSTS entry is loopback. why: `tailscale serve` and a
 *    reverse proxy forward to 127.0.0.1:3000, so a loopback address alone would leave a public proxy without a password.
 */

const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|localhost)$/;
/** An ALLOWED_HOSTS entry naming this machine: `localhost`, 127.0.0.0/8 or `[::1]`, an optional `:port`, any case. */
const LOOPBACK_HOST_ENTRY = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:\d+)?$/i;

/** Whether a bind or published address (or an SMTP host) is this machine's loopback. */
export const isLoopbackHost = (host: string): boolean => LOOPBACK.test(host);

/** Whether an ALLOWED_HOSTS entry (a Host header's value) names only this machine. */
export const isLoopbackHostEntry = (entry: string): boolean => LOOPBACK_HOST_ENTRY.test(entry);

/** What the rule reads of the configuration. */
export interface ReachFacts {
  inContainer: boolean;
  bindAddress: string;
  /** The host address compose publishes the container on (its `ports:` line); null when not stated. */
  publishedAddress: string | null;
  allowedHosts: readonly string[];
}

/** Why something other than this machine can reach the app: the first reason found. */
export type Reach =
  | { kind: 'bind'; address: string }
  | { kind: 'published'; address: string | null }
  | { kind: 'host'; host: string };

/** The reason another device or name can reach the app, or null when only this machine can. */
export function reachBeyondThisMachine(f: ReachFacts): Reach | null {
  if (f.inContainer) {
    if (f.publishedAddress === null || !isLoopbackHost(f.publishedAddress))
      return { kind: 'published', address: f.publishedAddress };
  } else if (!isLoopbackHost(f.bindAddress)) return { kind: 'bind', address: f.bindAddress };
  const host = f.allowedHosts.find((h) => !isLoopbackHostEntry(h));
  return host === undefined ? null : { kind: 'host', host };
}

/** Whether the app may run without a password: only this machine can reach it. */
export const onlyThisMachine = (f: ReachFacts): boolean => reachBeyondThisMachine(f) === null;

/**
 * The fix for the container and development (docs/setup.md section 1): the two sign-in lines in `.env`. The refusal an
 * operator who skipped that section reads in `docker compose logs` ends with it (devops-final-001).
 */
export const AUTH_MISSING =
  'add two lines to .env: APP_BASIC_AUTH_USER=<a user name> and APP_BASIC_AUTH_PASS=<a password of at least 12 characters> (docs/setup.md section 1)';
/** The fix for a native install: setup writes both lines into app.env and restarts the app. */
export const AUTH_MISSING_NATIVE = 'run pnpm gmt setup --reconfigure password, which turns sign-in on';

/** The message's mode: a native install's fix is a `pnpm gmt` command; the container's and development's is `.env`. */
export type ReachMode = 'native' | 'container' | 'dev';

/**
 * The refusal for an app with no password that something other than this machine can reach: the setting that lets it,
 * why, and the fix that works in this mode. Config reports it under `field`; bootApp prints `field: message`.
 */
export function reachRefusal(r: Reach, mode: ReachMode): { field: string; message: string } {
  const fix = mode === 'native' ? AUTH_MISSING_NATIVE : AUTH_MISSING;
  switch (r.kind) {
    case 'bind':
      return {
        field: 'BIND_ADDRESS',
        message: `the app binds ${r.address}, which other devices can reach, and has no password: ${fix}`,
      };
    case 'published':
      return {
        field: 'PUBLISHED_ADDRESS',
        message:
          r.address === null
            ? `not set, so the app cannot tell that only this machine reaches it, and it has no password: ${fix}`
            : `the app is published on ${r.address}, which other devices can reach, and has no password: ${fix}`,
      };
    case 'host':
      return {
        field: 'ALLOWED_HOSTS',
        message: `${r.host} is not this machine, so the app answers to another name, and it has no password: ${fix}`,
      };
  }
}
