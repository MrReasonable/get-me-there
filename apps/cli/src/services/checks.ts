import { join } from 'node:path/posix';
import type { Deps } from '../deps.js';
import type { ServiceFacts } from '../platform/types.js';
import { factOf, type ServiceEntry } from './set.js';
import { appEnvPath } from './specs.js';

/** One local check (spec §13 `gmt status`'s local facts; `gmt start` refuses on a fail among them). */
export interface Check {
  name: string;
  level: 'ok' | 'warn' | 'fail';
  detail: string;
  fix: string | null;
}

/** The two settings files: present (app.env must be), the user's own and 0600 (spec §12). */
export function settingsChecks(deps: Deps, appEnvRequired = true): Check[] {
  const files: Array<[string, string, boolean]> = [
    // why: W1: a worker alone (the app in Docker) needs no app.env; an app.env that is there is still checked
    ['settings app.env', appEnvPath(deps.platform.paths), appEnvRequired],
    ['settings worker.env', join(deps.platform.paths.workerData, 'worker.env'), false],
  ];
  const out: Check[] = [];
  for (const [name, path, required] of files) {
    const mode = deps.files.mode(path);
    if (mode === null) {
      if (required) out.push({ name, level: 'fail', detail: `${path} is missing`, fix: 'pnpm gmt setup' });
      continue;
    }
    if ((mode & 0o077) !== 0)
      out.push({
        name,
        level: 'fail',
        detail: `${path} is readable by others (0${mode.toString(8)})`,
        fix: `chmod 600 ${path}`,
      });
    else if (deps.files.owner(path) !== deps.platform.uid)
      out.push({
        name,
        level: 'fail',
        detail: `${path} belongs to another user`,
        fix: `chown ${deps.username} ${path}`,
      });
    else out.push({ name, level: 'ok', detail: '0600, yours', fix: null });
  }
  return out;
}

const unXml = (s: string) =>
  s
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');

/** The Node binary and the working directory an installed unit file names. */
export function unitTargets(contents: string): { node: string | null; dir: string | null } {
  const plistNode = /<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]*)<\/string>/.exec(contents)?.[1];
  const plistDir = /<key>WorkingDirectory<\/key>\s*<string>([^<]*)<\/string>/.exec(contents)?.[1];
  if (plistNode !== undefined)
    return { node: unXml(plistNode), dir: plistDir === undefined ? null : unXml(plistDir) };
  const exec = /^ExecStart="((?:[^"\\]|\\.)*)"/m.exec(contents)?.[1];
  const dir = /^WorkingDirectory=(.*)$/m.exec(contents)?.[1];
  const node =
    exec === undefined ? null : exec.replace(/\\(.)/g, '$1').replaceAll('%%', '%').replaceAll('$$', '$');
  return { node, dir: dir === undefined ? null : dir.replaceAll('%%', '%') };
}

/** Spec §13: a unit whose Node binary or checkout no longer exists is a fail, with `pnpm gmt setup` as the fix. */
export function staleChecks(
  deps: Deps,
  entries: readonly ServiceEntry[],
  facts: ReadonlyMap<string, ServiceFacts>,
): Check[] {
  const out: Check[] = [];
  for (const e of entries) {
    const onDisk = factOf(facts, e.unit).onDisk;
    if (onDisk === null) continue;
    const t = unitTargets(onDisk);
    if (t.node !== null && deps.files.size(t.node) === null)
      out.push({
        name: `unit ${e.name}`,
        level: 'fail',
        detail: `its Node binary ${t.node} is gone`,
        fix: 'pnpm gmt setup',
      });
    if (t.dir !== null && !deps.files.isDir(t.dir))
      out.push({
        name: `unit ${e.name}`,
        level: 'fail',
        detail: `the checkout ${t.dir} is gone`,
        fix: 'pnpm gmt setup',
      });
  }
  return out;
}

/** The unit a job is scheduled by: the timer on Linux, the calendar agent itself on macOS. */
export const scheduleUnit = (e: ServiceEntry): string =>
  e.rendered.find((r) => r.unitName.endsWith('.timer'))?.unitName ?? e.unit;

export function describeChecks(checks: readonly Check[]): string {
  const width = Math.max(10, ...checks.map((c) => c.name.length));
  return `${checks
    .map(
      (c) =>
        `${c.name.padEnd(width)}  ${c.level.padEnd(4)}  ${c.detail}${c.fix === null ? '' : `\n${' '.repeat(width + 8)}fix: ${c.fix}`}`,
    )
    .join('\n')}\n`;
}
