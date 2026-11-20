import { appUrl, settingsPath } from '../appClient.js';
import type { Answers } from './answers.js';
import { searchSource } from './answers.js';
import type { SignIn } from './appEnv.js';
import { TP_SIGNUP_URL, TP_TOKEN_URL } from './prompts.js';

/**
 * Settings plan ruling 15: the token is added on the Settings page (the app imports app.env's lines on its first start,
 * then holds them), so the words name its Price sources section on this app.
 */
export const noSourceText = (port: number): string =>
  `No price source is set up yet, so searches will find nothing. The no-cost source is Travelpayouts, which needs a free account: register at ${TP_SIGNUP_URL}, then copy the token from your Profile’s API token section (help: ${TP_TOKEN_URL}) and add it in Settings › Price sources: ${appUrl(port, settingsPath('sources'))}`;
export const TRIAL_ONLY_TEXT =
  'The SearchApi free trial is for `pnpm gmt smoke` only; searches never use it.';
export const BACKUP_FAILED_TEXT = 'The first daily backup did not complete; take one with `pnpm gmt backup`.';
export const NO_SCHEDULE_TEXT =
  'Nothing runs on a schedule until you give a search one; a scheduled search spends within the limits Settings › Limits shows.';

/** The line naming where to go next (U3: always printed, with or without a price source). */
export const nextStep = (port: number): string =>
  `Next: open http://127.0.0.1:${port} and use the new-search panel on Trips: enter From, To and the dates, review what the search will use, then press Search.`;

/**
 * Spec §4: the words for an app with no password, each said only when it is true: only this machine (every account on
 * it) can reach it; ALLOW_UNAUTHENTICATED is set; or something else can reach it, so the app refuses to start.
 */
export const NO_PASSWORD_TEXT =
  'There is no password: only this machine can reach the app, and that means every account on it. On a machine other people log in to, or before another device or name reaches the app (docs/setup.md section 3), turn sign-in on with `pnpm gmt setup --reconfigure password`.';
export const ALLOW_UNAUTHENTICATED_TEXT =
  'There is no password because ALLOW_UNAUTHENTICATED is set in app.env, so every device that reaches this machine can use the app (docs/setup.md section 3). To turn sign-in on: `pnpm gmt setup --reconfigure password`.';
export const NEEDS_PASSWORD_TEXT =
  'app.env has no password, but its settings let something other than this machine reach the app, so the app refuses to start: run `pnpm gmt setup --reconfigure password`.';

/**
 * Settings that fail the app's check for some other reason than reach: the fault is not reach, so say so. `hasPassword`
 * when the file has a password line (a half pair), which is then not called absent.
 */
export const invalidSettingsText = (appEnv: string, hasPassword = false): string =>
  `${hasPassword ? `${appEnv} has a password but` : `no password in ${appEnv}, and it`} would not pass the app’s settings check: run pnpm gmt setup to see why`;

/** The sentence for how the app signs people in, when it has no password. */
export const noPasswordText = (s: Exclude<SignIn, 'password'>, appEnv: string): string =>
  s === 'only-this-machine'
    ? NO_PASSWORD_TEXT
    : s === 'allow-unauthenticated'
      ? ALLOW_UNAUTHENTICATED_TEXT
      : s === 'needs-password'
        ? NEEDS_PASSWORD_TEXT
        : invalidSettingsText(appEnv);

/**
 * The closing screen (brief §6; U3, U6): never the password itself, only where it lives and how to show or replace it
 * (or, with none, why there is none and how to turn sign-in on); the next step in plain words whatever was chosen; what
 * keeps the app running on this OS.
 */
export function closingScreen(x: {
  port: number;
  answers: Answers;
  appEnv: string;
  backupOk: boolean;
  os: 'darwin' | 'linux';
  /** How the app signs people in, from app.env (spec §4: no password while only this machine can reach it). */
  signIn: SignIn;
}): string {
  const source = searchSource(x.answers);
  const lines = [
    ...(source
      ? []
      : [noSourceText(x.port), ...(x.answers.searchApi?.plan === 'trial' ? [TRIAL_ONLY_TEXT] : []), '']),
    `get-me-there is running at http://127.0.0.1:${x.port}`,
    ...(x.signIn === 'password'
      ? [
          'User name: operator',
          `The password is in ${x.appEnv}; show it with \`pnpm gmt password\` (if scrollback or a shared screen may have kept it, \`pnpm gmt setup --reconfigure password\` replaces it).`,
        ]
      : [noPasswordText(x.signIn, x.appEnv)]),
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
