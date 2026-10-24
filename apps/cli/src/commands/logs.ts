import { join } from 'node:path/posix';
import type { Flags } from '../args.js';
import type { Deps } from '../deps.js';
import { refuseOnWindows } from './lifecycle.js';

export const JOURNAL_HINT =
  'The journal shows nothing for get-me-there-app. If your user is not in the systemd-journal group, journalctl --user may show no lines: sudo usermod -aG systemd-journal <your user>, then log in again.';

/** `gmt logs` (spec §13): `tail -F` of the log files on macOS, the user journal on Linux, as argv arrays. */
export async function logsCommand(_f: Flags, _p: string | null, deps: Deps): Promise<number> {
  const win = refuseOnWindows(deps);
  if (win !== null) return win;
  const logs = deps.platform.paths.logs;
  if (logs !== null) {
    const files = (deps.files.list(logs) ?? []).filter((n) => n.endsWith('.log')).map((n) => join(logs, n));
    return deps.attach(
      ['tail', '-n', '200', '-F', ...(files.length > 0 ? files : [join(logs, 'app.log')])],
      '/',
    );
  }
  const peek = await deps.run(['journalctl', '--user', '-u', 'get-me-there-app', '-n', '1', '--no-pager'], {
    cwd: '/',
    timeoutMs: 15_000,
  });
  if (peek.stdout.trim() === '' || peek.stdout.includes('-- No entries --')) deps.io.out(`${JOURNAL_HINT}\n`);
  return deps.attach(['journalctl', '--user', '-u', 'get-me-there-app', '-n', '200', '-f'], '/');
}
