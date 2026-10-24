import { execFile } from 'node:child_process';

/**
 * The one `execFile` wrapper (decision 72): the system executor's `run` actions and every read a planner makes (a
 * service manager's facts, `git status`, `docker compose ps`) go through it. It never throws for a child's exit: a
 * non-zero exit is its code, a command that cannot be started is 127, and a timeout is 124. `env`, when given, is the
 * child's whole environment; otherwise the child inherits this process's.
 */
export type Runner = (
  argv: readonly string[],
  opts: { cwd: string; stdin?: string; timeoutMs: number; env?: Readonly<Record<string, string>> },
) => Promise<{ code: number; stdout: string; stderr: string }>;

const MAX_BUFFER = 64 * 1024 * 1024;

export const systemRunner: Runner = (argv, opts) =>
  new Promise((resolve) => {
    const [file, ...args] = argv;
    if (file === undefined || file === '') {
      resolve({ code: 127, stdout: '', stderr: 'no command given' });
      return;
    }
    const child = execFile(
      file,
      args,
      {
        cwd: opts.cwd,
        timeout: opts.timeoutMs,
        maxBuffer: MAX_BUFFER,
        encoding: 'utf8',
        windowsHide: true,
        ...(opts.env === undefined ? {} : { env: { ...opts.env } }),
      },
      (err, stdout, stderr) => {
        if (err === null) resolve({ code: 0, stdout, stderr });
        else if (err.killed === true || err.signal === 'SIGTERM')
          resolve({ code: 124, stdout, stderr: `${stderr}timed out after ${opts.timeoutMs} ms` });
        else if (typeof err.code === 'number') resolve({ code: err.code, stdout, stderr });
        else resolve({ code: 127, stdout, stderr: `${file}: cannot be started (${String(err.code)})` });
      },
    );
    // why: a child that reads stdin must see its end, or it waits for input that never comes
    child.stdin?.on('error', () => {});
    child.stdin?.end(opts.stdin ?? '');
  });
