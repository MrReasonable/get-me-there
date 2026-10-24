/**
 * The plan-then-apply model (decision 72; brief WP16b §5, the single statement WP17 and WP18 code against). Every `gmt`
 * command computes a `Plan` from facts gathered before planning and hands it to an `Executor`; nothing else changes the
 * machine. There is no journal: `apply` stops at the first failure and reports what was and was not done, and a re-run
 * of the planner over the new facts plans only what is still missing.
 */

/** One step a command takes. Paths are absolute; a `run` argv is never a shell string and never holds a secret. */
export type Action =
  | { kind: 'mkdir'; path: string; mode: 0o700 | 0o755 }
  | { kind: 'writeFile'; path: string; contents: string; mode: 0o600 | 0o644; secret: boolean }
  | { kind: 'download'; url: string; to: string; sha256: string; bytes: number }
  | { kind: 'unpack'; archive: string; sha256: string; to: string }
  | { kind: 'rename'; from: string; to: string }
  | { kind: 'copy'; from: string; to: string; mode: 0o600 }
  | { kind: 'remove'; path: string; recursive: boolean }
  // why: `stdin` is the child's standard input. A secret reaches a child only this way, with `secretStdin: true`, so
  // describePlan and every error leave it out; a non-secret input (the moved marker's text) has `secretStdin: false`.
  | {
      kind: 'run';
      argv: readonly string[];
      cwd: string;
      describe: string;
      secretStdin: boolean;
      stdin?: string;
    }
  | { kind: 'waitHealthy'; url: string; timeoutSeconds: number };

export interface Plan {
  command: string;
  actions: readonly Action[];
  notes: readonly string[];
}

export interface Executor {
  run(a: Action): Promise<void>;
}

export interface ApplyResult {
  done: readonly Action[];
  failed: { action: Action; error: string } | null;
  notRun: readonly Action[];
}

/** A `run` action, its `describe` defaulting to the argv as one would type it (no secret is ever in an argv). */
export function runAction(
  argv: readonly string[],
  cwd: string,
  opts: { describe?: string; stdin?: string; secretStdin?: boolean } = {},
): Extract<Action, { kind: 'run' }> {
  const base = {
    kind: 'run' as const,
    argv,
    cwd,
    describe: opts.describe ?? commandLine(argv),
    secretStdin: opts.secretStdin ?? false,
  };
  return opts.stdin === undefined ? base : { ...base, stdin: opts.stdin };
}

/** An argv as a POSIX shell would read it back: each word bare when it is plain, else single-quoted. */
export function commandLine(argv: readonly string[]): string {
  return argv
    .map((w) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(w) ? w : `'${w.replaceAll("'", `'\\''`)}'`))
    .join(' ');
}
