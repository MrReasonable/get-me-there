import type { Logger } from '@gmt/core';

/**
 * A Logger for the command line: warnings and errors as JSON lines on stderr (host names only, never a URL), and debug
 * lines (a refused path without its query, never a URL) only when `debug` is on: CAMOUFOX_LOG_DEBUG=true in worker.env.
 */
export function stderrLog(err: (line: string) => void, debug = false): Logger {
  const log: Logger = {
    debug: (o, msg) => {
      if (debug) err(JSON.stringify({ level: 'debug', msg, ...o }));
    },
    info: () => undefined,
    warn: (o, msg) => err(JSON.stringify({ level: 'warn', msg, ...o })),
    error: (o, msg) => err(JSON.stringify({ level: 'error', msg, ...o })),
    child: () => log,
  };
  return log;
}

/** True when worker.env asks for debug lines (CAMOUFOX_LOG_DEBUG=true); off by default. */
export function debugLogging(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.CAMOUFOX_LOG_DEBUG === 'true';
}
