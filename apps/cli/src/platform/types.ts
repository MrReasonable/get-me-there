/**
 * The `Platform` interface (decision 72; brief WP16b §5, the single statement WP17 and WP18 code against): where an
 * install keeps its files on this OS, the user id launchd's domain needs, and the one service manager. Planning methods
 * are pure over the facts `facts` gathered; they return the literal `launchctl gui/<uid>` or `systemctl --user` argv.
 */
import type { Runner } from '../exec/runner.js';
import type { Action } from '../plan/action.js';

export type Os = 'darwin' | 'linux' | 'win32';
export type Arch = 'arm64' | 'x64';
export interface Paths {
  config: string; // ~/.config/get-me-there (XDG_CONFIG_HOME honoured on linux when absolute)
  data: string; // ~/.local/share/get-me-there (XDG_DATA_HOME likewise)
  state: string; // ~/.local/state/get-me-there (XDG_STATE_HOME likewise)
  workerData: string; // always workerDataDir(home) from core (XDG ignored; spec §12)
  camoufoxRoot: string; // always ~/.local/share/get-me-there/camoufox (XDG ignored)
  logs: string | null; // ~/Library/Logs/get-me-there on darwin; null on linux (the journal)
  serviceDir: string; // ~/Library/LaunchAgents | ~/.config/systemd/user
}
export interface ServiceSpec {
  name: 'app' | 'backup' | 'camoufox-worker';
  argv: readonly string[]; // argv[0] is the recorded process.execPath; never a shell string
  workingDirectory: string;
  environment: Readonly<{ PATH: string; HOME: string }>; // the whole environment
  restart: 'on-failure' | 'never';
  preventRestartExitStatus: number | null; // 78 for the worker (systemd)
  throttleSeconds: number; // launchd ThrottleInterval: 60, or 600 for the worker
  stopSeconds: number; // TimeoutStopSec / ExitTimeOut: 30, or a page's longest time plus a margin for the worker (W7)
  calendar: { hour: number; minute: number } | null; // jobs only
}
export interface RenderedService {
  path: string;
  contents: string;
  unitName: string;
}
export interface ServiceFacts {
  onDisk: string | null;
  loaded: boolean;
  state: ServiceState;
}
export type ServiceState = 'running' | 'stopped' | 'failed' | 'not-installed';
export interface ServiceManager {
  render(spec: ServiceSpec, paths: Paths): RenderedService[]; // one plist, or a .service (+ .timer)
  facts(r: readonly RenderedService[], run: Runner): Promise<ReadonlyMap<string, ServiceFacts>>; // the only async read
  install(r: readonly RenderedService[], facts: ReadonlyMap<string, ServiceFacts>): Action[]; // [] when unchanged
  start(unitName: string, facts: ServiceFacts): Action[];
  stop(unitName: string, facts: ServiceFacts): Action[];
  restart(unitName: string, facts: ServiceFacts): Action[];
  remove(r: readonly RenderedService[], facts: ReadonlyMap<string, ServiceFacts>): Action[];
}
export interface Platform {
  os: Os;
  arch: Arch;
  uid: number; // for launchctl's gui/<uid> domain
  paths: Paths;
  hasDisplay: boolean;
  writeSecretFile(path: string, contents: string): Action;
  serviceManager: ServiceManager;
}
