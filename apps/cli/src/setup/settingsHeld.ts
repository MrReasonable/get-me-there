import { join } from 'node:path/posix';
import { z } from 'zod';
import type { Deps } from '../deps.js';

const heldSchema = z.object({ rows: z.number().int().nonnegative() });

/**
 * Settings plan ruling 15 (review I2, controller ruling R20): whether the app holds its settings, told from the
 * database, not from whether the app answers, so a stopped app counts too. It does from the first start at which
 * `app.env` had a line for one of them (imported as a row), or from the first save on the Settings page. No database, or one with no settings table (before
 * migration 0014) or no row, is not holding them: setup then writes `app.env` as on a first run. The file is read
 * read-only by scripts/settings-held.mjs (setup does not import @gmt/db); a file it cannot read is an error, never a
 * guess.
 */
export async function settingsHeld(
  deps: Deps,
  db: string,
): Promise<{ ok: true; held: boolean } | { ok: false; error: string }> {
  if (deps.files.size(db) === null) return { ok: true, held: false };
  const r = await deps.run([deps.execPath, join(deps.checkout, 'scripts', 'settings-held.mjs'), db], {
    cwd: deps.checkout,
    timeoutMs: 60_000,
    env: deps.childEnv,
  });
  let rows: number | null = null;
  try {
    const parsed = heldSchema.safeParse(JSON.parse(r.stdout));
    rows = r.code === 0 && parsed.success ? parsed.data.rows : null;
  } catch {
    rows = null;
  }
  if (rows === null)
    return {
      ok: false,
      error: `cannot tell whether the app holds its settings: ${db} could not be read, or the packages are not built (run pnpm build, then setup again)`,
    };
  return { ok: true, held: rows > 0 };
}
