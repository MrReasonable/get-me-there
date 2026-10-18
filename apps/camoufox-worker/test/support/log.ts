// A Logger that keeps every line in memory, so tests can assert what was (and was never) logged.
import type { Logger } from '@gmt/core';

export interface LogLine {
  level: 'debug' | 'info' | 'warn' | 'error';
  o: object;
  msg: string | undefined;
}
export function memoryLog(lines: LogLine[] = []): Logger & { lines: LogLine[] } {
  const at =
    (level: LogLine['level']) =>
    (o: object, msg?: string): void => {
      lines.push({ level, o, msg });
    };
  const log = {
    lines,
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    child: () => log,
  };
  return log;
}
