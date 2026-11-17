import type { Flags } from '../args.js';
import { type Deps, EXIT } from '../deps.js';
import { appEnvPath } from '../services/specs.js';
import { readEnvText, signInOf } from '../setup/appEnv.js';
import { invalidSettingsText, noPasswordText } from '../setup/closing.js';

/**
 * `gmt password`: the app's password from app.env (read with parseEnv), to a terminal only, never to a pipe or log; with
 * none (spec §4), why there is none and how to turn sign-in on, on stderr, and success.
 */
export async function passwordCommand(_f: Flags, _p: string | null, deps: Deps): Promise<number> {
  if (!deps.io.stdoutIsTTY) {
    deps.io.err(
      'pnpm gmt password prints only to a terminal, so the password never lands in a pipe or a log\n',
    );
    return EXIT.badConfig;
  }
  const text = deps.files.read(appEnvPath(deps.platform.paths));
  if (text === null) {
    deps.io.err(`no password in ${appEnvPath(deps.platform.paths)}: run pnpm gmt setup first\n`);
    return EXIT.badConfig;
  }
  const record = readEnvText(text);
  const pass = record.APP_BASIC_AUTH_PASS;
  if (pass === undefined || pass === '') {
    // why: spec §4: no password is the install's state while only this machine can reach the app (or with
    // ALLOW_UNAUTHENTICATED), not a fault; settings that need one are, and the words say which, by core's rule
    const signIn = signInOf(record);
    const path = appEnvPath(deps.platform.paths);
    // why: 'password' cannot come back for a record with no password; it reads as the settings fault if it ever does
    deps.io.err(`${signIn === 'password' ? invalidSettingsText(path) : noPasswordText(signIn, path)}\n`);
    return signIn === 'only-this-machine' || signIn === 'allow-unauthenticated' ? EXIT.ok : EXIT.badConfig;
  }
  deps.io.out(`${pass}\n`);
  return EXIT.ok;
}
