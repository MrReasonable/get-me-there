// Repository paths in one form (U13, CI run 40130578076): the scripts' rules are written with forward slashes, and on
// Windows node:path joins with backslashes, so every walked path is turned into the forward-slash form before a rule
// reads it.

/** @param {string} p */
export const toPosix = (p) => p.replaceAll('\\', '/');

// why: the only code that may read process.env is a command-line entry point: the app and tool bootstraps under
// exactly apps/api/src/bootstrap/ (wiring and logger take the env as an argument), and the operator scripts directly
// under scripts/ (backup.mjs reads DATABASE_PATH as the bootstrap does; secret-scan.mjs reads the configured secret
// values). Anchored to the path start, so a directory named bootstrap elsewhere (apps/api/src/routes/bootstrap/) or a
// helper nested under scripts/ is not an entry point (CodeRabbit batch 3).
// why: WP14: the camoufox worker's one launcher, run.ts, is its only environment reader (SEC-R2-006); decision 72: the
// gmt CLI's entry module, apps/cli/src/main.ts, is its only one.
const ENV_READER =
  /^(?:apps\/api\/src\/bootstrap\/.+|apps\/camoufox-worker\/src\/run\.ts|apps\/cli\/src\/main\.ts|scripts\/[^/]+\.mjs)$/;
export const ENV_RULE =
  'apps/api/src/bootstrap/, apps/camoufox-worker/src/run.ts, apps/cli/src/main.ts and scripts/*.mjs entry points';

/** Whether a repository-relative path, in either separator form, may read process.env. @param {string} p */
export const isEnvReader = (p) => ENV_READER.test(toPosix(p));
