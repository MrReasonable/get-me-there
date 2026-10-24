import type { Ask } from './ask.js';
import type { Files } from './exec/files.js';
import type { Runner } from './exec/runner.js';
import type { Executor } from './plan/action.js';
import type { Platform } from './platform/types.js';

/** An HTTP request the CLI makes, always to this machine's app (127.0.0.1); never to a vendor. */
export interface HttpRequest {
  method: 'GET' | 'POST';
  url: string;
  headers: Readonly<Record<string, string>>;
  body?: string;
  timeoutMs: number;
}
export type HttpResult = { status: number; body: string } | { error: string };
export type Http = (r: HttpRequest) => Promise<HttpResult>;

/** The terminal: two streams, whether each is a TTY, and standard input read whole (for `fromStdin` secrets). */
export interface Io {
  out(text: string): void;
  err(text: string): void;
  stdoutIsTTY: boolean;
  stdinIsTTY: boolean;
  readStdin(): Promise<string>;
}

/**
 * Everything a command reads or changes, gathered once by main.ts (the one reader of the environment) and injected, so every
 * command is a planner over these facts plus an executor: memory ones in tests, system ones for real.
 */
export interface Deps {
  platform: Platform;
  files: Files;
  run: Runner;
  executor: Executor;
  ask: Ask;
  io: Io;
  http: Http;
  now(): Date;
  sleep(ms: number): Promise<void>;
  /** The checkout's root, absolute. */
  checkout: string;
  /** The Node binary this process runs (`process.execPath`), recorded into every service. */
  execPath: string;
  /** `process.versions.node`. */
  nodeVersion: string;
  /** The login name (`os.userInfo().username`), for `loginctl enable-linger <user>`. */
  username: string;
  /** The process environment, read once by main.ts: only `fromEnv` answers and the platform input use it. */
  env: Readonly<Record<string, string | undefined>>;
  /** `os.tmpdir()`: a Node binary under it is refused for services. */
  tmpDir: string;
  /** `Intl.DateTimeFormat().resolvedOptions().timeZone`. */
  machineTimeZone: string;
  /** Whether 127.0.0.1:<port> can be listened on now. */
  portFree(port: number): Promise<boolean>;
  randomBytes(n: number): Buffer;
  /** Runs an argv with this terminal attached (for `logs`), resolving its exit code. */
  attach(argv: readonly string[], cwd: string): Promise<number>;
}

/** Exit codes (sysexits, as the app's EXIT table uses): ok, a failed step, usage, a refusal or unmet prerequisite. */
export const EXIT = { ok: 0, failed: 1, usage: 64, refused: 78 } as const;
