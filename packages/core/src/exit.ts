/**
 * The plan's single exit-code table for every command line: the app, the tools, the scripts and `gmt`. 1 = a required recording call did not return its expected status, a
 * smoke provider errored or a smoke check failed, or the run failed. 2 = smoke: no provider configured, nothing sent. 3
 * = smoke: no error, but a tile or the chain held no price. 70 = refused under NODE_ENV=test or while the synthetic
 * gate is open. 65 = a tool run refused for spend: credits already ledgered to earlier tool runs plus this run's worst
 * case exceed `--budget` without `--confirm-rerun` (plan decision 20), or a provider's budget window has less room than
 * the run's worst case (cost-wp4b-r2-001). 75 = another process holds what this one needs: the database's app lock, or (gmt) a search running in the app. 64 = usage. 74 = a backup failed. 78 = bad configuration or an unmet prerequisite, including a DATABASE_PATH that would put the smoke's
 * fixtures inside the recorded tree.
 */
export const EXIT = {
  ok: 0,
  failed: 1,
  smokeNoProviders: 2,
  smokeEmpty: 3,
  usage: 64,
  spendRefused: 65,
  refusedTestEnv: 70,
  preflightImpossible: 73,
  backupFailed: 74,
  lockRefused: 75,
  badConfig: 78,
} as const;
