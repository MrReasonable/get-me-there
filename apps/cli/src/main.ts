// The `gmt` command's entry point (`pnpm gmt <command>`, decision 72): the only module of @gmt/cli that reads
// `process.env`. It gathers the process facts once and hands them to the commands, which never read the environment.
import { parseCommandLine } from './args.js';

const parsed = parseCommandLine(process.argv.slice(2));
if (parsed.kind === 'help') {
  process.stdout.write(parsed.text);
  process.exitCode = 0;
} else if (parsed.kind === 'usage') {
  process.stderr.write(`${parsed.message}\n`);
  process.exitCode = 64;
} else {
  process.stderr.write(`gmt ${parsed.command}: not built yet\n`);
  process.exitCode = 70;
}
