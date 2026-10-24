import { execFile } from 'node:child_process';
import { constants } from 'node:os';

/**
 * The one `execFile` wrapper (decision 72): the system executor's `run` actions and every read a planner makes (a
 * service manager's facts, `git status`, `docker compose ps`) go through it. It never throws for a child's exit: a
 * non-zero exit is its code, a command that cannot be started is 127, a timeout is 124, a child stopped by a signal
 * is 128 + its number, and output past the buffer stops the child with 1. `env`, when given, is the child's whole
 * environment; otherwise the child inherits this process's.
 */
export type Runner = (
  argv: readonly string[],
  opts: { cwd: string; stdin?: string; timeoutMs: number; env?: Readonly<Record<string, string>> },
) => Promise<{ code: number; stdout: string; stderr: string }>;

const MAX_BUFFER = 64 * 1024 * 1024;

const signalCode = (signal: string): number => {
  const n: unknown = Object.entries(constants.signals).find(([k]) => k === signal)?.[1];
  return 128 + (typeof n === 'number' ? n : 0);
};

/** The runner with its output limit; production uses `systemRunner` (64 MiB), tests a small one. */
export function makeRunner(o: { maxBufferBytes?: number } = {}): Runner {
  const maxBuffer = o.maxBufferBytes ?? MAX_BUFFER;
  return (argv, opts) =>
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
          maxBuffer,
          encoding: 'utf8',
          windowsHide: true,
          ...(opts.env === undefined ? {} : { env: { ...opts.env } }),
        },
        (err, stdout, stderr) => {
          if (err === null) resolve({ code: 0, stdout, stderr });
          // why: ca-b1-019: execFile kills a child past maxBuffer (killed true), which is not a timeout
          else if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
            resolve({
              code: 1,
              stdout,
              stderr: `${stderr}${file}: printed more than ${maxBuffer} bytes; stopped`,
            });
          else if (err.killed === true)
            resolve({ code: 124, stdout, stderr: `${stderr}timed out after ${opts.timeoutMs} ms` });
          else if (typeof err.signal === 'string')
            resolve({
              code: signalCode(err.signal),
              stdout,
              stderr: `${stderr}${file} was stopped by ${err.signal}`,
            });
          else if (typeof err.code === 'number') resolve({ code: err.code, stdout, stderr });
          else resolve({ code: 127, stdout, stderr: `${file}: cannot be started (${String(err.code)})` });
        },
      );
      // why: a child that exits without reading stdin closes the pipe; the EPIPE that follows is expected, and the
      // child's own exit is what the caller gets
      child.stdin?.on('error', () => {});
      // why: a child that reads stdin must see its end, or it waits for input that never comes
      child.stdin?.end(opts.stdin ?? '');
    });
}

export const systemRunner: Runner = makeRunner();
