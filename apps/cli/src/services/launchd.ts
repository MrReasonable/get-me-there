import { join } from 'node:path/posix';
import type { Runner } from '../exec/runner.js';
import { type Action, runAction } from '../plan/action.js';
import type {
  Paths,
  RenderedService,
  ServiceFacts,
  ServiceManager,
  ServiceSpec,
  ServiceState,
} from '../platform/types.js';

/**
 * macOS user agents (spec §13; `man launchd.plist`, `man launchctl`, brief §7): one plist per service in
 * ~/Library/LaunchAgents, loaded into the `gui/<uid>` domain. `KeepAlive { SuccessfulExit: false }` restarts on a
 * failed exit no faster than `ThrottleInterval`; `ExitTimeOut` 30 lets the app checkpoint and release its lock.
 */
export const launchdLabel = (name: ServiceSpec['name']): string => `local.get-me-there.${name}`;

const xml = (s: string): string =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
const str = (s: string): string => `<string>${xml(s)}</string>`;

/** The plist for one spec, keys in a fixed order so an unchanged spec renders byte for byte the same. */
export function renderPlist(spec: ServiceSpec, paths: Paths): string {
  const label = launchdLabel(spec.name);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  ${str(label)}`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    ...spec.argv.map((a) => `    ${str(a)}`),
    '  </array>',
    '  <key>WorkingDirectory</key>',
    `  ${str(spec.workingDirectory)}`,
    '  <key>EnvironmentVariables</key>',
    '  <dict>',
    '    <key>HOME</key>',
    `    ${str(spec.environment.HOME)}`,
    '    <key>PATH</key>',
    `    ${str(spec.environment.PATH)}`,
    '  </dict>',
  ];
  if (spec.restart === 'on-failure')
    lines.push(
      '  <key>RunAtLoad</key>',
      '  <true/>',
      '  <key>KeepAlive</key>',
      '  <dict>',
      '    <key>SuccessfulExit</key>',
      '    <false/>',
      '  </dict>',
      '  <key>ThrottleInterval</key>',
      `  <integer>${spec.throttleSeconds}</integer>`,
    );
  if (spec.calendar !== null)
    lines.push(
      '  <key>StartCalendarInterval</key>',
      '  <dict>',
      '    <key>Hour</key>',
      `    <integer>${spec.calendar.hour}</integer>`,
      '    <key>Minute</key>',
      `    <integer>${spec.calendar.minute}</integer>`,
      '  </dict>',
    );
  lines.push('  <key>ExitTimeOut</key>', '  <integer>30</integer>');
  if (paths.logs !== null) {
    const log = join(paths.logs, `${spec.name}.log`);
    lines.push(
      '  <key>StandardOutPath</key>',
      `  ${str(log)}`,
      '  <key>StandardErrorPath</key>',
      `  ${str(log)}`,
    );
  }
  lines.push('</dict>', '</plist>', '');
  return lines.join('\n');
}

/** The state `launchctl print` reports: running, or the last exit (0 or never is stopped, anything else failed). */
function stateOf(printed: string): ServiceState {
  if (/^\s*state = running\s*$/m.test(printed)) return 'running';
  const exit = /^\s*last exit code = (\d+)/m.exec(printed)?.[1];
  return exit !== undefined && exit !== '0' ? 'failed' : 'stopped';
}

const missing: ServiceFacts = { onDisk: null, loaded: false, state: 'not-installed' };

export function launchdManager(uid: number, paths: Paths): ServiceManager {
  const domain = `gui/${uid}`;
  const plistPath = (label: string): string => join(paths.serviceDir, `${label}.plist`);
  const lc = (...args: string[]): Action => runAction(['launchctl', ...args], '/');
  const bootstrap = (label: string) => lc('bootstrap', domain, plistPath(label));
  const bootout = (label: string) => lc('bootout', `${domain}/${label}`);
  return {
    render: (spec, p) => [
      {
        path: join(p.serviceDir, `${launchdLabel(spec.name)}.plist`),
        contents: renderPlist(spec, p),
        unitName: launchdLabel(spec.name),
      },
    ],

    async facts(rendered: readonly RenderedService[], run: Runner) {
      const out = new Map<string, ServiceFacts>();
      for (const r of rendered) {
        const file = await run(['cat', r.path], { cwd: '/', timeoutMs: 15_000 });
        const onDisk = file.code === 0 ? file.stdout : null;
        const printed = await run(['launchctl', 'print', `${domain}/${r.unitName}`], {
          cwd: '/',
          timeoutMs: 15_000,
        });
        const loaded = printed.code === 0;
        out.set(r.unitName, {
          onDisk,
          loaded,
          state: loaded ? stateOf(printed.stdout) : onDisk === null ? 'not-installed' : 'stopped',
        });
      }
      return out;
    },

    install(rendered, facts) {
      return rendered.flatMap((r) => {
        const f = facts.get(r.unitName) ?? missing;
        if (f.onDisk === r.contents) return [];
        const write: Action = {
          kind: 'writeFile',
          path: r.path,
          contents: r.contents,
          mode: 0o644,
          secret: false,
        };
        return [...(f.loaded ? [bootout(r.unitName)] : []), write, bootstrap(r.unitName)];
      });
    },

    start(unitName, f) {
      if (f.loaded) return f.state === 'running' ? [] : [lc('kickstart', `${domain}/${unitName}`)];
      return f.onDisk === null ? [] : [bootstrap(unitName)];
    },
    // why: a booted-out agent stays stopped; killing the process would only let KeepAlive start it again
    stop: (unitName, f) => (f.loaded ? [bootout(unitName)] : []),
    restart(unitName, f) {
      if (f.loaded) return [lc('kickstart', '-k', `${domain}/${unitName}`)];
      return f.onDisk === null ? [] : [bootstrap(unitName)];
    },

    remove(rendered, facts) {
      return rendered.flatMap((r) => {
        const f = facts.get(r.unitName) ?? missing;
        return [
          ...(f.loaded ? [bootout(r.unitName)] : []),
          ...(f.onDisk !== null ? [{ kind: 'remove' as const, path: r.path, recursive: false }] : []),
        ];
      });
    },
  };
}
