import { parseArgs } from 'node:util';

/**
 * The `gmt` command line (spec §13 "The `gmt` command"), parsed with `node:util` `parseArgs` (decision 72). Each command
 * names the options it takes; an unknown option, a missing value or a stray argument is a usage error (exit 64).
 */
export const COMMANDS = [
  'setup',
  'status',
  'start',
  'stop',
  'restart',
  'logs',
  'backup',
  'restore',
  'password',
  'smoke',
  'update',
  'uninstall',
  'browser',
] as const;
export type CommandName = (typeof COMMANDS)[number];

export const RECONFIGURE_GROUPS = [
  'port',
  'timezone',
  'email',
  'travelpayouts',
  'searchapi',
  'browser',
  'password',
  'linger',
] as const;
export type ReconfigureGroup = (typeof RECONFIGURE_GROUPS)[number];

/** `start`, `stop` and `restart --only <service>`: one service of the set (WP17: the browser worker alone, for recordings). */
export const ONLY_SERVICES = ['app', 'backup', 'worker'] as const;
export type OnlyService = (typeof ONLY_SERVICES)[number];
export const isOnlyService = (s: string): s is OnlyService => ONLY_SERVICES.some((x) => x === s);
const ONLY_HELP = `--only <service>          act on one service only: ${ONLY_SERVICES.join(', ')}`;

/** `gmt browser <action>`: install or reinstall the pinned Camoufox, or rewrite the worker's monthly counts. */
export const BROWSER_ACTIONS = ['install', 'counts'] as const;
export type BrowserAction = (typeof BROWSER_ACTIONS)[number];
export const isBrowserAction = (s: string): s is BrowserAction => BROWSER_ACTIONS.some((x) => x === s);

type OptionSpec = { type: 'boolean' } | { type: 'string' };
const bool: OptionSpec = { type: 'boolean' };
const str: OptionSpec = { type: 'string' };

/** W5 (ca-b1-001): `--only` names a service for start, stop and restart; another command's `--only` is its own. */
const onlyService = (flags: Flags): string | null =>
  typeof flags.only === 'string' && !isOnlyService(flags.only)
    ? `unknown service for --only: ${flags.only} (one of ${ONLY_SERVICES.join(', ')})`
    : null;

/**
 * Each command's options, its positional argument (if any), its one-line help, and its own check of what it was given
 * (a usage error's text, or null): an option two commands share keeps each command's meaning.
 */
const SPEC: Record<
  CommandName,
  {
    options: Record<string, OptionSpec>;
    positional: string | null;
    help: string;
    flags: string[];
    check?: (flags: Flags, positional: string | null) => string | null;
  }
> = {
  setup: {
    options: {
      'dry-run': bool,
      'non-interactive': bool,
      answers: str,
      reconfigure: str,
      'import-docker': bool,
      'import-db': str,
      'ignore-docker': bool,
      'replace-database': bool,
      wait: bool,
      force: bool,
    },
    positional: null,
    help: 'install or re-check the app as a user service on this machine (127.0.0.1, basic auth; setup generates its password)',
    flags: [
      '--dry-run                 print the plan and change nothing',
      '--non-interactive         ask nothing (with --answers <file>)',
      '--answers <file>          the answers as JSON (secrets need the file at 0600, or fromEnv/fromStdin)',
      `--reconfigure <group>     ask one group again and replace only its lines: ${RECONFIGURE_GROUPS.join(', ')}`,
      '--import-docker           move the Docker install’s database here, then mark the old one moved',
      '--import-db <path>        move a checkout’s database here, then mark the old one moved',
      '--ignore-docker           start fresh here: stops the Docker app and marks its volume moved, so it refuses to start',
      '--replace-database        let an import replace a native database (backed up first)',
      '--wait                    wait for a running search to finish instead of refusing',
      '--force                   go ahead although a search is running (it is interrupted)',
    ],
  },
  status: {
    options: {},
    positional: null,
    help: 'show the services, the settings files and anything that needs attention',
    flags: [],
  },
  start: {
    options: { 'dry-run': bool, only: str },
    positional: null,
    help: 'start the services',
    flags: [ONLY_HELP],
    check: onlyService,
  },
  stop: {
    options: { 'dry-run': bool, wait: bool, force: bool, only: str },
    positional: null,
    help: 'stop the services (refuses while a search runs, unless --wait or --force)',
    flags: [
      '--wait                    wait for a running search to finish instead of refusing',
      '--force                   go ahead although a search is running (it is interrupted)',
      ONLY_HELP,
    ],
    check: onlyService,
  },
  restart: {
    options: { 'dry-run': bool, wait: bool, force: bool, only: str },
    positional: null,
    help: 'restart the services (refuses while a search runs, unless --wait or --force)',
    flags: [
      '--wait                    wait for a running search to finish instead of refusing',
      '--force                   go ahead although a search is running (it is interrupted)',
      ONLY_HELP,
    ],
    check: onlyService,
  },
  logs: { options: {}, positional: null, help: 'follow the app’s log', flags: [] },
  backup: {
    options: { 'dry-run': bool },
    positional: null,
    help: 'take a backup now (the daily job, run once)',
    flags: [],
  },
  restore: {
    options: { 'dry-run': bool },
    positional: 'file',
    help: 'replace the database with a backup (the app must be stopped)',
    flags: [],
  },
  password: { options: {}, positional: null, help: 'print the app’s password to this terminal', flags: [] },
  smoke: {
    options: { yes: bool, 'accept-total': bool, from: str, to: str },
    positional: null,
    help: 'spends real calls: up to 4 SearchApi credits and one browser page with today’s settings',
    flags: [
      '--from <IATA> --to <IATA>  the route to try, for example --from LHR --to JFK',
      '--yes                     skip the typed confirmation (for scripts)',
      '--accept-total            with --yes: accept the running total once earlier tool runs used credits in this window',
    ],
  },
  update: {
    options: { wait: bool, force: bool, 'dry-run': bool },
    positional: null,
    help: 'update this checkout to origin/main (fast-forward only: it refuses a branch that has diverged), rebuild and restart, with a backup first',
    flags: [
      '--wait                    wait for a running search to finish instead of refusing',
      '--force                   go ahead although a search is running (it is interrupted)',
      '--dry-run                 print the plan and change nothing',
    ],
  },
  uninstall: {
    options: { purge: bool, 'non-interactive': bool, 'dry-run': bool },
    positional: null,
    help: 'remove the services; settings, data and state are kept unless --purge',
    flags: [
      '--purge                   also delete the settings, data and state directories (asks for the word purge)',
      '--non-interactive         ask nothing (refused with --purge)',
      '--dry-run                 print the plan and change nothing',
    ],
  },
  browser: {
    options: {
      'keep-archive': bool,
      wait: bool,
      force: bool,
      'non-interactive': bool,
      pages: str,
      scrolls: str,
      'other-pages': str,
    },
    positional: 'action',
    help: 'the browser provider on this machine, whether the app runs here, in Docker or not at all: install (or reinstall) the pinned Camoufox and restart the worker; counts rewrites the worker’s monthly counts',
    flags: [
      'install                   download, verify and lay out the pinned Camoufox (about 313 to 663 MB), then start the worker if it is set up',
      'counts                    rewrite an unreadable or missing monthly counts file from the app’s ledger',
      '--keep-archive            install: keep the verified download beside the install (for a cache)',
      '--wait                    wait for a running search to finish instead of refusing',
      '--force                   go ahead although a search is running (it is interrupted)',
      '--pages <n> --scrolls <n>  counts: this month’s browser pages and scrolls, when no app here can report them',
      '--other-pages <n>         counts: pages loaded this month outside the app’s ledger (recordings, other apps)',
      '--non-interactive         counts: ask nothing (the figures come from the app or the flags)',
    ],
    check: (flags, positional) => {
      if (positional === null || !isBrowserAction(positional))
        return `browser needs an action: ${BROWSER_ACTIONS.join(' or ')}`;
      for (const n of ['pages', 'scrolls', 'other-pages'])
        if (flags[n] !== undefined && !/^\d{1,7}$/.test(String(flags[n])))
          return `--${n} takes a whole number`;
      if (
        positional === 'install' &&
        ['pages', 'scrolls', 'other-pages', 'non-interactive'].some((n) => flags[n] !== undefined)
      )
        return 'install takes --keep-archive, --wait and --force only';
      if (positional === 'counts' && flags['keep-archive'] !== undefined)
        return 'counts does not take --keep-archive';
      return null;
    },
  },
};

export type Flags = Readonly<Record<string, string | boolean | undefined>>;
export type Parsed =
  | { kind: 'command'; command: CommandName; flags: Flags; positional: string | null }
  | { kind: 'help'; text: string }
  | { kind: 'usage'; message: string };

const isCommand = (s: string): s is CommandName => COMMANDS.some((c) => c === s);
export const isReconfigureGroup = (s: string): s is ReconfigureGroup =>
  RECONFIGURE_GROUPS.some((g) => g === s);

/** The whole help text, or one command's. */
export function helpText(command?: CommandName): string {
  if (command !== undefined) {
    const s = SPEC[command];
    const usage = `usage: pnpm gmt ${command}${s.positional === null ? '' : ` <${s.positional}>`}${Object.keys(s.options).length > 0 ? ' [options]' : ''}`;
    return `${[usage, '', `  ${s.help}`, ...(s.flags.length > 0 ? ['', ...s.flags.map((f) => `  ${f}`)] : [])].join('\n')}\n`;
  }
  const width = Math.max(...COMMANDS.map((c) => c.length));
  return `${[
    'usage: pnpm gmt <command> [options]',
    '',
    'First time: pnpm gmt setup',
    '',
    ...COMMANDS.map((c) => `  ${c.padEnd(width)}  ${SPEC[c].help}`),
    '',
    'pnpm gmt <command> --help shows a command’s options.',
  ].join('\n')}\n`;
}

/** Parses the arguments after `gmt`. */
export function parseCommandLine(argv: readonly string[]): Parsed {
  const [first, ...rest] = argv;
  if (first === undefined || first === '--help' || first === '-h' || first === 'help')
    return { kind: 'help', text: helpText() };
  if (!isCommand(first)) return { kind: 'usage', message: `unknown command: ${first}\n${helpText()}` };
  const spec = SPEC[first];
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: [...rest],
      options: { ...spec.options, help: { type: 'boolean', short: 'h' } },
      allowPositionals: true,
      strict: true,
    });
  } catch (e) {
    return { kind: 'usage', message: `${e instanceof Error ? e.message : String(e)}\n${helpText(first)}` };
  }
  if (parsed.values.help === true) return { kind: 'help', text: helpText(first) };
  const want = spec.positional === null ? 0 : 1;
  if (parsed.positionals.length !== want)
    return {
      kind: 'usage',
      message: `${want === 0 ? `${first} takes no argument` : `${first} needs <${spec.positional}>`}\n${helpText(first)}`,
    };
  const flags: Record<string, string | boolean | undefined> = {};
  for (const [k, v] of Object.entries(parsed.values)) if (k !== 'help' && !Array.isArray(v)) flags[k] = v;
  const reconfigure = flags.reconfigure;
  if (typeof reconfigure === 'string' && !isReconfigureGroup(reconfigure))
    return {
      kind: 'usage',
      message: `unknown group for --reconfigure: ${reconfigure} (one of ${RECONFIGURE_GROUPS.join(', ')})`,
    };
  const positional = parsed.positionals[0] ?? null;
  const problem = spec.check?.(flags, positional) ?? null;
  if (problem !== null) return { kind: 'usage', message: `${problem}\n${helpText(first)}` };
  return { kind: 'command', command: first, flags, positional };
}
