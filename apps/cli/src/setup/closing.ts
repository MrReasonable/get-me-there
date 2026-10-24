import { TP_SIGNUP_URL, TP_TOKEN_URL } from './prompts.js';

export const NO_SOURCE_TEXT = `No price source is set up yet, so searches will find nothing. The no-cost source is Travelpayouts, which needs a free account: register at ${TP_SIGNUP_URL}, then open the API token page (${TP_TOKEN_URL}) and run \`pnpm gmt setup --reconfigure travelpayouts\`.`;
export const BACKUP_FAILED_TEXT = 'The first daily backup did not complete; take one with `pnpm gmt backup`.';

/** The closing screen (brief §6): never the password itself, only where it lives and how to show or replace it. */
export function closingScreen(x: {
  port: number;
  priceSource: boolean;
  appEnv: string;
  backupOk: boolean;
}): string {
  const lines = [
    ...(x.priceSource ? [] : [NO_SOURCE_TEXT, '']),
    `get-me-there is running at http://127.0.0.1:${x.port}`,
    'User name: operator',
    `The password is in ${x.appEnv}; show it with \`pnpm gmt password\` (if scrollback or a shared screen may have kept it, \`pnpm gmt setup --reconfigure password\` replaces it).`,
    `From another device: an SSH tunnel, ssh -L ${x.port}:127.0.0.1:${x.port} <host>, or docs/setup.md section 3 for Tailscale and TLS; the service speaks plain HTTP.`,
    'Scheduled searches run while this machine is awake; a missed one is caught up once when it wakes, without the browser provider.',
    ...(x.backupOk ? [] : [BACKUP_FAILED_TEXT]),
    ...(x.priceSource ? ['Next: Definitions → Coverage check.'] : []),
  ];
  return `\n${lines.join('\n')}\n`;
}
