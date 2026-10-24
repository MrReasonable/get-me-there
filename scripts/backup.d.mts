// Types for scripts/backup.mjs's one export, for the gmt CLI's tests (WP16b), which parse the daily job's argv with it.
export function parseArgs(
  argv: string[],
  envDb: string | undefined,
  rules: { backupsDirFor: (db: string) => string; BACKUPS_KEPT: number },
): { ok: true; db: string; dir: string; keep: number } | { ok: false; reason: string };
