import { type CommandName, type Flags, parseCommandLine } from './args.js';
import { setupCommand } from './commands/setup.js';
import { type Deps, EXIT } from './deps.js';

/** A command: its flags and positional, the injected facts, and an exit code. */
export type Command = (flags: Flags, positional: string | null, deps: Deps) => Promise<number>;

const notBuilt: Command = async (_f, _p, deps) => {
  deps.io.err('this command is not built yet\n');
  return EXIT.failed;
};

const COMMANDS: Record<CommandName, Command> = {
  setup: setupCommand,
  status: notBuilt,
  start: notBuilt,
  stop: notBuilt,
  restart: notBuilt,
  logs: notBuilt,
  backup: notBuilt,
  restore: notBuilt,
  password: notBuilt,
  smoke: notBuilt,
  update: notBuilt,
  uninstall: notBuilt,
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
