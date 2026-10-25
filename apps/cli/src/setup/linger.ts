import type { Deps } from '../deps.js';
import { type Action, runAction } from '../plan/action.js';
import { apply } from '../plan/apply.js';

/** The command the operator runs when `loginctl` refuses an unprivileged request; `gmt` never runs sudo (spec §13). */
export const sudoLingerLine = (user: string): string => `sudo loginctl enable-linger ${user}`;

/** On Linux with `linger: enable`, `loginctl enable-linger <user>` unless linger is on already; nothing elsewhere. */
export async function lingerPlan(choice: 'skip' | 'enable', deps: Deps): Promise<Action[]> {
  if (choice !== 'enable' || deps.platform.os !== 'linux') return [];
  const shown = await deps.run(['loginctl', 'show-user', deps.username, '--property=Linger', '--value'], {
    cwd: '/',
    timeoutMs: 15_000,
  });
  if (shown.code === 0 && shown.stdout.trim() === 'yes') return [];
  return [runAction(['loginctl', 'enable-linger', deps.username], '/')];
}

/**
 * Applies the linger step on its own: a refusal is not a setup failure, it prints the exact `sudo` line for the
 * operator and setup carries on. Never prompts.
 */
export async function runLinger(
  choice: 'skip' | 'enable',
  deps: Deps,
): Promise<'enabled' | 'refused' | 'unchanged'> {
  const actions = await lingerPlan(choice, deps);
  if (actions.length === 0) return 'unchanged';
  const r = await apply({ command: 'linger', actions, notes: [] }, deps.executor);
  if (r.failed === null) return 'enabled';
  deps.io.out(
    `Keeping the app running after you log out needs one command with sudo, which setup never runs. Run it yourself:\n  ${sudoLingerLine(deps.username)}\n`,
  );
  return 'refused';
}
