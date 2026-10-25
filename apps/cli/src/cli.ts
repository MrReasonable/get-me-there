import { type CommandName, type Flags, parseCommandLine } from './args.js';
import { backupCommand } from './commands/backup.js';
import { browserCommand } from './commands/browser.js';
import { consentCommand } from './commands/consent.js';
import { logsCommand } from './commands/logs.js';
import { passwordCommand } from './commands/password.js';
import { restartCommand } from './commands/restart.js';
import { restoreCommand } from './commands/restore.js';
import { setupCommand } from './commands/setup.js';
import { smokeCommand } from './commands/smoke.js';
import { startCommand } from './commands/start.js';
import { statusCommand } from './commands/status.js';
import { stopCommand } from './commands/stop.js';
import { uninstallCommand } from './commands/uninstall.js';
import { updateCommand } from './commands/update.js';
import { type Deps, EXIT } from './deps.js';

/** A command: its flags and positional, the injected facts, and an exit code. */
export type Command = (flags: Flags, positional: string | null, deps: Deps) => Promise<number>;

const COMMANDS: Record<CommandName, Command> = {
  setup: setupCommand,
  status: statusCommand,
  start: startCommand,
  stop: stopCommand,
  restart: restartCommand,
  logs: logsCommand,
  backup: backupCommand,
  restore: restoreCommand,
  password: passwordCommand,
  smoke: smokeCommand,
  update: updateCommand,
  uninstall: uninstallCommand,
  browser: browserCommand,
  consent: consentCommand,
};

/** Parses `gmt`'s arguments and runs the command; resolves the process's exit code. */
export async function runCli(argv: readonly string[], deps: Deps): Promise<number> {
  const parsed = parseCommandLine(argv);
  if (parsed.kind === 'help') {
    deps.io.out(parsed.text);
    return EXIT.ok;
  }
  if (parsed.kind === 'usage') {
    deps.io.err(`${parsed.message}\n`);
    return EXIT.usage;
  }
  return COMMANDS[parsed.command](parsed.flags, parsed.positional, deps);
}
