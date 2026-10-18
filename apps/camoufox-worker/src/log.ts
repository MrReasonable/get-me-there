import type { Logger } from '@gmt/core';

/** A Logger for the command line: warnings and errors as JSON lines on stderr (host names only, never a URL). */
export function stderrLog(err: (line: string) => void): Logger {
  const log: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: (o, msg) => err(JSON.stringify({ level: 'warn', msg, ...o })),
    error: (o, msg) => err(JSON.stringify({ level: 'error', msg, ...o })),
    child: () => log,
  };
  return log;
}
