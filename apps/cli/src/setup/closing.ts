import type { Answers } from './answers.js';
import { searchSource } from './answers.js';
import { TP_SIGNUP_URL, TP_TOKEN_URL } from './prompts.js';

export const NO_SOURCE_TEXT = `No price source is set up yet, so searches will find nothing. The no-cost source is Travelpayouts, which needs a free account: register at ${TP_SIGNUP_URL}, then copy the token from your Profile’s API token section (help: ${TP_TOKEN_URL}) and run \`pnpm gmt setup --reconfigure travelpayouts\`.`;
export const TRIAL_ONLY_TEXT =
  'The SearchApi free trial is for `pnpm gmt smoke` only; searches never use it.';
export const BACKUP_FAILED_TEXT = 'The first daily backup did not complete; take one with `pnpm gmt backup`.';
export const NO_SCHEDULE_TEXT =
  'Nothing runs on a schedule until you give a search one; a scheduled search spends within the caps the Providers page shows.';

/** The line naming where to go next (U3: always printed, with or without a price source). */
export const nextStep = (port: number): string =>
  `Next: open http://127.0.0.1:${port}, choose Definitions and add a search with your airports and dates; its Coverage check shows what the price sources hold before you save it.`;

/**
 * The closing screen (brief §6; U3, U6): never the password itself, only where it lives and how to show or replace it;
 * the next step in plain words whatever was chosen; what keeps the app running on this OS.
 */
export function closingScreen(x: {
  port: number;
  answers: Answers;
  appEnv: string;
  backupOk: boolean;
  os: 'darwin' | 'linux';
}): string {
  const source = searchSource(x.answers);
  const lines = [
    ...(source
      ? []
      : [NO_SOURCE_TEXT, ...(x.answers.searchApi?.plan === 'trial' ? [TRIAL_ONLY_TEXT] : []), '']),
    `get-me-there is running at http://127.0.0.1:${x.port}`,
    'User name: operator',
    `The password is in ${x.appEnv}; show it with \`pnpm gmt password\` (if scrollback or a shared screen may have kept it, \`pnpm gmt setup --reconfigure password\` replaces it).`,
    nextStep(x.port),
    NO_SCHEDULE_TEXT,
    'Scheduled searches run while this machine is awake; a missed one is caught up once when it wakes, without the browser provider.',
    x.os === 'darwin'
      ? 'The app runs while you are logged in to this Mac and starts again when you log in (turn on automatic login for a Mac that must run unattended); pnpm gmt stop lasts until then.'
      : x.answers.linger === 'enable'
        ? 'The app keeps running after you log out.'
        : 'The app stops when you log out of every session; to keep it running: pnpm gmt setup --reconfigure linger',
    `Only if you want to reach it from another device: an SSH tunnel (ssh -L ${x.port}:127.0.0.1:${x.port} <this machine>), or docs/setup.md section 3 for Tailscale and TLS; the service speaks plain HTTP.`,
    ...(x.backupOk ? [] : [BACKUP_FAILED_TEXT]),
  ];
  return `\n${lines.join('\n')}\n`;
}
