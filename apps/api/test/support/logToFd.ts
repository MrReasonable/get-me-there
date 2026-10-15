// Spawned by test/logger.test.ts: logs one line through the default destination to the given fd, then exits at once,
// so the test sees whether the write was synchronous and scrubbed. Arguments: <fd 1|2> <secret>.
import { Secret } from '@gmt/core';
import { createLogger } from '../../src/logger.js';

const [fdArg, secret = ''] = process.argv.slice(2);
const log = createLogger({ logLevel: 'info' }, { fd: fdArg === '1' ? 1 : 2, secrets: [new Secret(secret)] });
log.error({ detail: `upstream echoed ${secret}` }, `failed with ${secret}`);
process.exit(3);
