/**
 * pino behind the core Logger port (spec §14). Redact paths are the spec's list plus every casing of
 * WP4's credential header names at any one level of nesting; URL query and userinfo stripping happens
 * in http-kit before anything reaches a log line (§5.3). Every line is also scrubbed of the
 * configured secret values (all their encoded forms) before it reaches the destination.
 */
import type { Config, Logger, Secret } from '@gmt/core';
import { CREDENTIAL_HEADERS, scrubSecrets } from '@gmt/providers';
import pino, { type Logger as PinoLogger } from 'pino';

/** Spec §14 / §5.3 redact paths, verbatim. */
export const SPEC_REDACT_PATHS: readonly string[] = [
  'apiKey',
  'token',
  'authorization',
  'url.query',
  'req.headers.authorization',
];

/** `x-access-token` → `x-access-token`, `X-Access-Token`, `X-ACCESS-TOKEN`. */
function casings(name: string): string[] {
  const title = name
    .split('-')
    .map((p) => (p === '' ? p : `${p[0]?.toUpperCase() ?? ''}${p.slice(1)}`))
    .join('-');
  return [...new Set([name, title, name.toUpperCase()])];
}

/**
 * The spec list, then WP4's CREDENTIAL_HEADERS in every casing under `headers` at the top level and one
 * level down (`*.headers[...]`, which covers `req.headers` and `request.headers`), then the nested
 * credential fields a library error or the SMTP config can carry (sec-001, sec-002).
 */
export const REDACT_PATHS: readonly string[] = [
  ...SPEC_REDACT_PATHS,
  ...[...CREDENTIAL_HEADERS].flatMap((h) =>
    casings(h).flatMap((c) => [`headers["${c}"]`, `*.headers["${c}"]`]),
  ),
  '*.apiKey',
  '*.token',
  '*.authorization',
  '*.Authorization',
  'err.config',
  '*.config.headers',
  'smtp.pass',
  '*.pass',
  '*.password',
];

function wrap(p: PinoLogger): Logger {
  return {
    debug: (o, msg) => p.debug(o, msg),
    info: (o, msg) => p.info(o, msg),
    warn: (o, msg) => p.warn(o, msg),
    error: (o, msg) => p.error(o, msg),
    child: (bindings) => wrap(p.child(bindings)),
  };
}

/**
 * JSON logs to stdout by default (spec §14). The tool bootstrap passes `fd: 2` so its human report on
 * stdout stays clean. Every line is scrubbed of the configured secret values (all their encoded forms) by pino's
 * `hooks.streamWrite`, before any destination sees it. why: `pino.destination({ dest: fd, sync: true })` (SonicBoom)
 * writes synchronously, so a process that exits right after an error keeps its last line, and it handles partial
 * writes and EAGAIN on a pipe, which a hand-rolled `writeSync` stream did not (arch I-2, sec minor 3). `destination`
 * is the test seam.
 */
export function createLogger(
  config: Pick<Config, 'logLevel'>,
  opts?: { destination?: NodeJS.WritableStream; fd?: 1 | 2; secrets?: readonly Secret[] },
): Logger {
  const secrets = opts?.secrets ?? [];
  return wrap(
    pino(
      {
        level: config.logLevel,
        redact: { paths: [...REDACT_PATHS], censor: '[redacted]' },
        hooks: { streamWrite: (line) => scrubSecrets(line, secrets) },
      },
      opts?.destination ?? pino.destination({ dest: opts?.fd ?? 1, sync: true }),
    ),
  );
}
