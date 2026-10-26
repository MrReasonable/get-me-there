import { join } from 'node:path/posix';
import type { Runner } from '../exec/runner.js';
import { type Action, runAction } from '../plan/action.js';
import type {
  RenderedService,
  ServiceFacts,
  ServiceManager,
  ServiceSpec,
  ServiceState,
} from '../platform/types.js';
import { assertPrintable, stopWaitSeconds } from './specs.js';

/**
 * Linux user units (spec §13; systemd.service(5), systemd.timer(5), systemd.exec(5); brief §7): one `.service` per
 * service in ~/.config/systemd/user, plus a `.timer` for a calendar job, driven through `systemctl --user`.
 */
export const systemdUnit = (name: ServiceSpec['name']): string => `get-me-there-${name}.service`;

/**
 * One word of a command line or an `Environment=` assignment: double-quoted with `\` and `"` escaped, `%` doubled (a
 * specifier) and `$` doubled (a variable), so systemd reads back exactly the word (systemd.service(5) "Command lines").
 */
export function quoteWord(w: string): string {
  return `"${w.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%').replaceAll('$', '$$$$')}"`;
}
/** A path setting such as `WorkingDirectory=`: specifiers expand there, so only `%` is escaped. */
const pathValue = (p: string): string => p.replaceAll('%', '%%');

export function renderService(spec: ServiceSpec): string {
  assertPrintable(spec);
  const job = spec.calendar !== null;
  const lines = [
    '[Unit]',
    `Description=get-me-there ${spec.name}`,
    '',
    '[Service]',
    `Type=${job ? 'oneshot' : 'simple'}`,
    `WorkingDirectory=${pathValue(spec.workingDirectory)}`,
    `ExecStart=${spec.argv.map(quoteWord).join(' ')}`,
    `Environment=${quoteWord(`PATH=${spec.environment.PATH}`)} ${quoteWord(`HOME=${spec.environment.HOME}`)}`,
  ];
  if (spec.restart === 'on-failure') lines.push('Restart=on-failure', 'RestartSec=60');
  if (spec.preventRestartExitStatus !== null)
    lines.push(`RestartPreventExitStatus=${spec.preventRestartExitStatus}`);
  lines.push(`TimeoutStopSec=${spec.stopSeconds}`, 'KillSignal=SIGTERM');
  if (!job) lines.push('', '[Install]', 'WantedBy=default.target');
  lines.push('');
  return lines.join('\n');
}

export function renderTimer(spec: ServiceSpec & { calendar: { hour: number; minute: number } }): string {
  const hh = String(spec.calendar.hour).padStart(2, '0');
  const mm = String(spec.calendar.minute).padStart(2, '0');
  return [
    '[Unit]',
    `Description=get-me-there ${spec.name} timer`,
    '',
    '[Timer]',
    `OnCalendar=*-*-* ${hh}:${mm}:00`,
    'Persistent=true',
    `Unit=${systemdUnit(spec.name)}`,
    '',
    '[Install]',
    'WantedBy=timers.target',
    '',
  ].join('\n');
}

/** `systemctl --user is-active` words: active or changing is running, failed is failed, anything else inactive. */
function stateOf(word: string, onDisk: string | null): ServiceState {
  if (['active', 'reloading', 'deactivating', 'refreshing'].includes(word)) return 'running';
  // why: U5 (dev-b1-003): a crash-looping unit spends its restart wait as `activating`, which is not a running app
  if (word === 'failed' || word === 'activating') return 'failed';
  return onDisk === null ? 'not-installed' : 'stopped';
}

const missing: ServiceFacts = { onDisk: null, loaded: false, state: 'not-installed' };
const hasInstall = (contents: string): boolean => contents.includes('\n[Install]\n');

export function systemdManager(): ServiceManager {
  const sc = (...args: string[]): Action => runAction(['systemctl', '--user', ...args], '/');
  return {
    render(spec, p) {
      const service = {
        path: join(p.serviceDir, systemdUnit(spec.name)),
        contents: renderService(spec),
        unitName: systemdUnit(spec.name),
      };
      if (spec.calendar === null) return [service];
      const timerName = `get-me-there-${spec.name}.timer`;
      return [
        service,
        {
          path: join(p.serviceDir, timerName),
          contents: renderTimer({ ...spec, calendar: spec.calendar }),
          unitName: timerName,
        },
      ];
    },

    async facts(rendered: readonly RenderedService[], run: Runner) {
      const out = new Map<string, ServiceFacts>();
      for (const r of rendered) {
        const file = await run(['cat', r.path], { cwd: '/', timeoutMs: 15_000 });
        const onDisk = file.code === 0 ? file.stdout : null;
        const active = await run(['systemctl', '--user', 'is-active', r.unitName], {
          cwd: '/',
          timeoutMs: 15_000,
        });
        const state = stateOf(active.stdout.trim(), onDisk);
        out.set(r.unitName, { onDisk, loaded: state === 'running' || state === 'failed', state });
      }
      return out;
    },

    install(rendered, facts) {
      const changed = rendered.filter((r) => (facts.get(r.unitName) ?? missing).onDisk !== r.contents);
      if (changed.length === 0) return [];
      // why: a job is driven by its timer; restarting its oneshot .service would run the job now
      const target = rendered.find((r) => r.unitName.endsWith('.timer')) ?? rendered[0];
      const writes: Action[] = changed.map((r) => ({
        kind: 'writeFile',
        path: r.path,
        contents: r.contents,
        mode: 0o644,
        secret: false,
      }));
      if (target === undefined) return writes;
      const isNew = (facts.get(target.unitName) ?? missing).onDisk === null;
      return [
        ...writes,
        sc('daemon-reload'),
        isNew ? sc('enable', '--now', target.unitName) : sc('restart', target.unitName),
      ];
    },

    start: (unitName, f) => (f.onDisk === null || f.state === 'running' ? [] : [sc('start', unitName)]),
    // why: U5's rule on Linux too: nothing starts the unit again until it reads inactive (or failed, its stop having
    // ended in an error); `systemctl stop` blocks on its stop job, and the wait confirms the state it left
    stop: (unitName, f) =>
      f.state === 'running' || f.state === 'failed'
        ? [
            sc('stop', unitName),
            {
              kind: 'waitState',
              argv: ['systemctl', '--user', 'show', '--property=ActiveState', '--value', unitName],
              describe: `systemctl --user show --property=ActiveState --value ${unitName}`,
              until: ['inactive', 'failed'],
              timeoutSeconds: stopWaitSeconds(unitName === systemdUnit('camoufox-worker')),
            },
          ]
        : [],
    restart: (unitName, f) => (f.onDisk === null ? [] : [sc('restart', unitName)]),

    remove(rendered, facts) {
      const present = rendered.filter((r) => {
        const f = facts.get(r.unitName) ?? missing;
        return f.onDisk !== null || f.loaded;
      });
      if (present.length === 0) return [];
      // why: the timer goes first, so it cannot start the job between the two stops
      const isTimer = (r: RenderedService) => r.unitName.endsWith('.timer');
      const ordered = [...present.filter(isTimer), ...present.filter((r) => !isTimer(r))];
      return [
        ...ordered.flatMap((r) => [
          sc('stop', r.unitName),
          ...(hasInstall(r.contents) ? [sc('disable', r.unitName)] : []),
        ]),
        ...present
          .filter((r) => (facts.get(r.unitName) ?? missing).onDisk !== null)
          .map((r): Action => ({ kind: 'remove', path: r.path, recursive: false })),
        sc('daemon-reload'),
        sc('reset-failed'),
      ];
    },
  };
}
