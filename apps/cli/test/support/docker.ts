import type { MemoryFs, RunCall, RunHandler } from '../../src/exec/memory.js';

/**
 * A stand-in for the docker steps: a compose project whose `app` runs until stopped, a backup inside it that prints
 * its file, `cp` that writes the copy on the host tree, the marker's `cat` capturing its stdin, and `down`.
 */
export function dockerStandIn(
  fs: MemoryFs,
  opts: { running?: boolean; backupFails?: boolean; daemon?: boolean } = {},
) {
  const calls: RunCall[] = [];
  const state: { running: boolean; marker: string | null; down: boolean; calls: RunCall[] } = {
    running: opts.running ?? true,
    marker: null,
    down: false,
    calls,
  };
  const FILE = '/data/backups/get-me-there-2026-10-24T09-30-00-000Z.db';
  const handler: RunHandler = (argv, call) => {
    if (argv[0] !== 'docker') return undefined;
    state.calls.push(call);
    if (argv[1] === '--version') return { code: 0 };
    if (argv[1] === 'info') return { code: opts.daemon === false ? 1 : 0 };
    if (argv[1] === 'volume') return { code: 0 };
    const sub = argv.slice(4);
    if (sub[0] === 'ps')
      return {
        code: 0,
        stdout: `${JSON.stringify({ Service: 'app', State: state.running ? 'running' : 'exited' })}\n`,
      };
    if (sub[0] === 'port') return { code: 0, stdout: '127.0.0.1:3000\n' };
    if (sub[0] === 'stop') {
      state.running = false;
      return { code: 0 };
    }
    if (sub[0] === 'down') {
      state.down = true;
      return { code: 0 };
    }
    if (sub[0] === 'cp') {
      fs.file(sub[2] ?? '', 'sqlite copy from the volume', 0o644);
      return { code: 0 };
    }
    if (sub[0] === 'run' && sub.includes('scripts/backup.mjs'))
      return opts.backupFails
        ? { code: 74 }
        : { code: 0, stdout: `${JSON.stringify({ ok: true, file: FILE })}\n` };
    if (sub[0] === 'run' && sub.includes('sh')) {
      state.marker = call.stdin ?? null;
      return { code: 0 };
    }
    return { code: 0 };
  };
  return { handler, state, FILE };
}
