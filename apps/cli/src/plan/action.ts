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
  // why: `stdin` is the child's standard input with its secrecy: a secret reaches a child only this way, so describePlan
  // and every error leave the text out (and a secret run's stderr too). `env`, when given, is the child's whole
  // environment (U8: app-side children get PATH and HOME, not the CLI's environment).
  | {
      kind: 'run';
      argv: readonly string[];
      cwd: string;
      describe: string;
      stdin?: { text: string; secret: boolean };
      env?: Readonly<Record<string, string>>;
    }
  | { kind: 'waitHealthy'; url: string; timeoutSeconds: number }
  // why: U5: a probe run until it fails, within a bound; launchd's bootout returns before the label is gone
  | { kind: 'waitGone'; argv: readonly string[]; describe: string; timeoutSeconds: number };

export interface Plan {
  command: string;
  actions: readonly Action[];
  notes: readonly string[];
}

/** Runs one action; a `run` resolves the child's stdout (so a later step can use it), every other action ''. */
export interface Executor {
  run(a: Action): Promise<{ stdout: string }>;
}

export interface ApplyResult {
  done: readonly Action[];
  /** Each done action's stdout, in the order of `done`. */
  outputs: readonly string[];
  failed: { action: Action; error: string } | null;
  notRun: readonly Action[];
}

/** A `run` action, its `describe` defaulting to the argv as one would type it (no secret is ever in an argv). */
export function runAction(
  argv: readonly string[],
  cwd: string,
  opts: {
    describe?: string;
    stdin?: { text: string; secret: boolean };
    env?: Readonly<Record<string, string>>;
  } = {},
): Extract<Action, { kind: 'run' }> {
  return {
    kind: 'run' as const,
    argv,
    cwd,
    describe: opts.describe ?? commandLine(argv),
    ...(opts.stdin === undefined ? {} : { stdin: opts.stdin }),
    ...(opts.env === undefined ? {} : { env: opts.env }),
  };
}

/** An argv as a POSIX shell would read it back: each word bare when it is plain, else single-quoted. */
export function commandLine(argv: readonly string[]): string {
  return argv
    .map((w) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(w) ? w : `'${w.replaceAll("'", `'\\''`)}'`))
    .join(' ');
}
