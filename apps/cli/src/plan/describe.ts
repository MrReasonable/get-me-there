import type { Action, ApplyResult, Plan } from './action.js';

const octal = (mode: number): string => `0${mode.toString(8)}`;

/** The number of lines a file's text has (a trailing newline ends the last line rather than starting another). */
function lineCount(contents: string): number {
  if (contents === '') return 0;
  return contents.split('\n').length - (contents.endsWith('\n') ? 1 : 0);
}

/**
 * One action as a line of a plan. A secret file shows as "<path> (0600, n lines, values hidden)" and a run's standard
 * input is never shown, whether secret or not; a run shows its `describe`, which is the literal command for service
 * actions, so `--dry-run` prints the real `launchctl` and `systemctl` lines.
 */
export function describeAction(a: Action): string {
  switch (a.kind) {
    case 'mkdir':
      return `make directory ${a.path} (${octal(a.mode)})`;
    case 'writeFile':
      return a.secret
        ? `write ${a.path} (${octal(a.mode)}, ${lineCount(a.contents)} lines, values hidden)`
        : `write ${a.path} (${octal(a.mode)}, ${lineCount(a.contents)} lines)`;
    case 'download':
      return `download ${a.url} to ${a.to} (${a.bytes} bytes, sha256 ${a.sha256})`;
    case 'unpack':
      return `unpack ${a.archive} into ${a.to} (sha256 ${a.sha256})`;
    case 'rename':
      return `move ${a.from} to ${a.to}`;
    case 'copy':
      return `copy ${a.from} to ${a.to} (${octal(a.mode)})`;
    case 'remove':
      return a.recursive ? `remove ${a.path} and everything in it` : `remove ${a.path}`;
    case 'run':
      return `run ${a.describe}${a.stdin === undefined ? '' : a.stdin.secret ? ' (secret input on stdin)' : ' (input on stdin)'}`;
    case 'waitHealthy':
      return `wait up to ${a.timeoutSeconds} s for ${a.url}`;
    case 'waitGone':
      return `wait up to ${a.timeoutSeconds} s until ${a.describe} fails`;
    case 'waitState':
      return `wait up to ${a.timeoutSeconds} s until ${a.describe} prints ${a.until.join(' or ')}`;
    case 'waitUnlocked':
      return `wait up to ${a.timeoutSeconds} s until ${a.holder} lets go of ${a.path}`;
  }
}

/** A plan as numbered lines, then its notes. A plan with no action says so. */
export function describePlan(plan: Plan): string {
  const lines =
    plan.actions.length === 0
      ? [`${plan.command}: nothing to do`]
      : [`${plan.command}:`, ...plan.actions.map((a, i) => `  ${i + 1}. ${describeAction(a)}`)];
  for (const n of plan.notes) lines.push(`  note: ${n}`);
  return `${lines.join('\n')}\n`;
}

/** What an apply did, for the operator: done, the failure with its error, and what was not run. */
export function describeResult(command: string, r: ApplyResult): string {
  if (r.failed === null) return `${command}: done (${r.done.length} steps)\n`;
  const lines = [
    `${command}: stopped at a failed step; nothing was undone`,
    ...r.done.map((a) => `  done:    ${describeAction(a)}`),
    `  failed:  ${describeAction(r.failed.action)}: ${r.failed.error}`,
    ...r.notRun.map((a) => `  not run: ${describeAction(a)}`),
    '  run the same command again to carry on from here',
  ];
  return `${lines.join('\n')}\n`;
}
