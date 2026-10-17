/** The app process entry (`pnpm --filter @gmt/api start`, `dev`, and the WP12 image CMD). The one process.env read. */
import { safeMessage } from '../safeMessage.js';
import { EXIT } from '../tools/types.js';
import { main } from './app.js';
import { BootError } from './errors.js';

main(process.env).catch((err: unknown) => {
  // why: boot errors are already URL- and secret-free; a stray error is stripped of URLs here before it is printed.
  process.stderr.write(`${safeMessage(err, [])}\n`);
  // why: a BootError carries the plan's exit code (70, 73, 74, 75, 78); anything else is 1.
  process.exit(err instanceof BootError ? err.exitCode : EXIT.failed);
});
