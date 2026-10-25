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
  /** The home directory the platform's paths were built from (validated by currentPlatform). */
  home: string;
  /** The directory the operator ran `pnpm gmt` from (pnpm's INIT_CWD), against which relative paths are read. */
  invocationCwd: string;
  /** One environment variable by name, for an answers file's `{ "fromEnv": "NAME" }` secrets only. */
  secretEnv(name: string): string | undefined;
  /**
   * The environment children such as git and pnpm run with: PATH, HOME and the locale, pnpm, corepack and temporary
   * directory variables, never the rest of the shell's (U8: no vendor key reaches a dependency's install script).
   */
  childEnv: Readonly<Record<string, string>>;
  /** `os.tmpdir()`: a Node binary under it is refused for services. */
  tmpDir: string;
  /** `Intl.DateTimeFormat().resolvedOptions().timeZone`. */
  machineTimeZone: string;
  /** Whether 127.0.0.1:<port> can be listened on now. */
  portFree(port: number): Promise<boolean>;
  randomBytes(n: number): Buffer;
  /**
   * Runs an argv with this terminal attached (`logs`, `consent`), resolving its exit code; `env`, when given, is the
   * child's whole environment, and aborting `signal` sends the child SIGTERM.
   */
  attach(
    argv: readonly string[],
    cwd: string,
    env?: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<number>;
  /**
   * Handles SIGINT and SIGTERM with `handler` instead of exiting, until the returned function is called (review X3:
   * `gmt consent` puts the worker back before it ends).
   */
  onInterrupt(handler: () => void): () => void;
}

/** The one exit-code table (core's, shared with apps/api; U9): 78 a refusal or unmet prerequisite, 75 busy, 65 spend. */
export { EXIT } from '@gmt/core';
