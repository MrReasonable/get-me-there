import type { Flags } from '../args.js';
import { type Deps, EXIT } from '../deps.js';
import { WIN32_REFUSAL } from '../platform/win32.js';

/** `gmt setup` (spec §13): the wizard, the plan and its apply. */
export async function setupCommand(flags: Flags, _positional: string | null, deps: Deps): Promise<number> {
  // why: decision 78: on Windows a dry run states the refusal and succeeds with no plan; a real setup refuses (78)
  if (deps.platform.os === 'win32') {
    deps.io.out(`${WIN32_REFUSAL}\n`);
    return flags['dry-run'] === true ? EXIT.ok : EXIT.refused;
  }
  deps.io.err('setup: not built yet\n');
  return EXIT.failed;
}
