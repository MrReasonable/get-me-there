import type { Flags } from '../args.js';
import { type Deps, EXIT } from '../deps.js';
import { appEnvPath } from '../services/specs.js';
import { readEnvText } from '../setup/appEnv.js';

/** `gmt password`: the app's password from app.env (read with parseEnv), to a terminal only, never to a pipe or log. */
export async function passwordCommand(_f: Flags, _p: string | null, deps: Deps): Promise<number> {
  if (!deps.io.stdoutIsTTY) {
    deps.io.err(
      'pnpm gmt password prints only to a terminal, so the password never lands in a pipe or a log\n',
    );
    return EXIT.badConfig;
  }
  const text = deps.files.read(appEnvPath(deps.platform.paths));
  const pass = text === null ? undefined : readEnvText(text).APP_BASIC_AUTH_PASS;
  if (pass === undefined || pass === '') {
    deps.io.err(`no password in ${appEnvPath(deps.platform.paths)}: run pnpm gmt setup first\n`);
    return EXIT.badConfig;
  }
  deps.io.out(`${pass}\n`);
  return EXIT.ok;
}
