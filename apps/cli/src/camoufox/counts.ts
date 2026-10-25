import { apiContract } from '@gmt/core';
import { appUrl, authHeaders, credsFrom } from '../appClient.js';
import type { Flags } from '../args.js';
import type { Ask } from '../ask.js';
import { guardActiveRun } from '../commands/guard.js';
import { nativeTarget } from '../commands/setup.js';
import { type Deps, EXIT } from '../deps.js';
import type { Action } from '../plan/action.js';
import { apply } from '../plan/apply.js';
import { describeResult } from '../plan/describe.js';
import { factOf, factsOf, serviceSet, workerEntry } from '../services/set.js';
import { appEnvPath, serviceEnvironment, workerRunArgv } from '../services/specs.js';
import { readEnvText, readSettings } from '../setup/appEnv.js';
import { workerEnvPath } from './workerEnv.js';
import { workerStart } from './workerService.js';

/**
 * `gmt browser counts` (W3; decision 82): the worker refuses every page while its monthly counts file is missing beside
 * an earlier worker's files (an upgrade) or cannot be read, and this rewrites it from real figures: the month's
 * camoufox pages and scrolls from this machine's native app's ledger (`GET /api/providers`), or as the operator states
 * them (`--pages`, `--scrolls`: the app's Providers page shows both when the app runs in Docker), plus pages loaded
 * outside the ledger (`--other-pages`: recordings, another app). It never sets the whole cap as spent and writes
 * nothing without a yes (or, with `--non-interactive`, figures from the app or the flags). The file is written by the
 * worker's own `counts` entry, under its lock, through core's schema, with the worker service stopped meanwhile and
 * started again once its check passes. `gmt setup --reconfigure browser` runs the same steps.
 */
export interface Figures {
  pages: number;
  scrolls: number;
}

/** The camoufox provider-month figures in a `GET /api/providers` answer (no row this window: none used), or why not. */
export function ledgerFigures(body: string): Figures | { problem: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return { problem: 'the app’s providers answer is not JSON' };
  }
  const r = apiContract.providersResponseSchema.safeParse(raw);
  if (!r.success) return { problem: 'the app’s providers answer is not one this build can read' };
  const camoufox = r.data.providers.find((p) => p.providerId === 'camoufox');
  // why: CodeRabbit (PR #15): an app with the provider off lists no camoufox entry, yet its ledger may hold this
  // month's pages; no entry is no figure, never zero (a listed provider with no month row has used none)
  if (camoufox === undefined)
    return { problem: 'the app does not list the browser provider (is it turned on?)' };
  const month = camoufox.usage.find((u) => u.scope === 'provider-month:camoufox');
  if (month === undefined) return { pages: 0, scrolls: 0 };
  if (month.scrolls === undefined)
    return { problem: 'the app does not report its scroll count (update it first)' };
  return { pages: month.calls, scrolls: month.scrolls };
}

const whole = (v: string | boolean | undefined): number | null =>
  typeof v === 'string' && /^\d{1,7}$/.test(v) ? Number(v) : null;

async function askNumber(ask: Ask, q: string, def: number): Promise<number | null> {
  const a = (await ask.text(q, String(def))).trim();
  return /^\d{1,7}$/.test(a) ? Number(a) : null;
}

/** The counts file's state as the worker reads it (`run.ts counts --check`), or the worker's own failure. */
async function countsState(deps: Deps): Promise<'ok' | 'missing' | 'unreadable' | { error: string }> {
  const run = workerRunArgv(deps, 'counts', '--check');
  const r = await deps.run(run.argv, {
    cwd: run.cwd,
    timeoutMs: 60_000,
    env: serviceEnvironment(deps.execPath, deps.home),
  });
  try {
    const raw: unknown = JSON.parse(r.stdout.trim().split('\n').at(-1) ?? '');
    if (typeof raw === 'object' && raw !== null && 'counts' in raw) {
      const c = raw.counts;
      if (c === 'ok' || c === 'missing' || c === 'unreadable') return c;
    }
  } catch {
    // why: the worker said why on stderr; its last line is shown below
  }
  const said = r.stderr.trim().split('\n').at(-1) ?? '';
  return { error: `the worker could not read its counts (exit ${r.code}${said === '' ? '' : `: ${said}`})` };
}

/** The month's figures: the native app's ledger when it answers, else the flags, else asked; null when there are none. */
async function figuresOf(
  deps: Deps,
  o: { interactive: boolean; ask: Ask; flags: Flags },
): Promise<{ figures: Figures; from: string } | null> {
  const fromFlags = { pages: whole(o.flags.pages), scrolls: whole(o.flags.scrolls) };
  if (fromFlags.pages !== null && fromFlags.scrolls !== null)
    return { figures: { pages: fromFlags.pages, scrolls: fromFlags.scrolls }, from: 'the figures given' };
  let text: string | null;
  try {
    text = deps.files.read(appEnvPath(deps.platform.paths));
  } catch {
    text = null;
  }
  const creds = text === null ? null : credsFrom(readEnvText(text));
  if (creds !== null) {
    const p = await deps.http({
      method: 'GET',
      url: appUrl(creds.port, '/api/providers'),
      headers: authHeaders(creds),
      timeoutMs: 10_000,
    });
    if (!('error' in p) && p.status === 200) {
      const l = ledgerFigures(p.body);
      if (!('problem' in l)) return { figures: l, from: 'this app’s ledger' };
      deps.io.err(`${l.problem}\n`);
    } else deps.io.err('The app’s ledger could not be read (is the app running?).\n');
  }
  if (!o.interactive) {
    deps.io.err(
      'Give this month’s browser pages and scrolls with --pages and --scrolls (the app’s Providers page shows both).\n',
    );
    return null;
  }
  const pages = await askNumber(o.ask, 'This month’s browser pages (the app’s Providers page shows them)', 0);
  const scrolls = await askNumber(o.ask, 'This month’s browser scrolls (the same page)', 0);
  if (pages === null || scrolls === null) {
    deps.io.err('A whole number is needed; nothing was written.\n');
    return null;
  }
  return { figures: { pages, scrolls }, from: 'the figures you gave' };
}

/**
 * The rewrite itself; `notNeeded` true when the file is readable. Returns the exit code (EXIT.ok when nothing was
 * needed or the operator said no).
 */
export async function rewriteCounts(
  deps: Deps,
  o: { interactive: boolean; ask: Ask; flags: Flags; command: string },
): Promise<number> {
  if (deps.files.read(workerEnvPath(deps.platform.paths)) === null) {
    deps.io.err('The browser worker is not set up here (no worker.env): nothing to rewrite.\n');
    return EXIT.badConfig;
  }
  const state = await countsState(deps);
  if (typeof state === 'object') {
    deps.io.err(`${state.error}\n`);
    return EXIT.failed;
  }
  if (state === 'ok') {
    deps.io.out('The worker’s monthly counts file is readable; nothing to rewrite.\n');
    return EXIT.ok;
  }
  deps.io.out(
    state === 'missing'
      ? 'The worker’s monthly counts file is missing beside an earlier worker’s files, so it refuses every page.\n'
      : 'The worker’s monthly counts file cannot be read, so it refuses every page.\n',
  );
  const got = await figuresOf(deps, o);
  if (got === null) return EXIT.badConfig;
  let other = whole(o.flags['other-pages']);
  if (other === null && o.interactive) {
    other = await askNumber(
      o.ask,
      'Pages loaded this month outside this app’s ledger (recordings, another app), if any',
      0,
    );
    if (other === null) {
      deps.io.err('A whole number is needed; nothing was written.\n');
      return EXIT.badConfig;
    }
  }
  const pages = got.figures.pages + (other ?? 0);
  const { scrolls } = got.figures;
  deps.io.out(
    `From ${got.from}: ${got.figures.pages} browser pages and ${scrolls} scrolls this month${other === null || other === 0 ? '' : `, plus ${other} pages outside the ledger`}. The worker’s counts would be ${pages} pages and ${scrolls} scrolls.\n`,
  );
  if (o.interactive && !(await o.ask.confirm('Rewrite the worker’s counts with these figures?', false))) {
    deps.io.out('Nothing was written.\n');
    return EXIT.ok;
  }
  const entries = serviceSet(deps);
  const app = entries.find((e) => e.name === 'app');
  const worker = entries.find((e) => e.name === 'camoufox-worker') ?? workerEntry(deps);
  const facts = await factsOf(deps, [...entries, worker]);
  let appText: string | null;
  try {
    appText = deps.files.read(appEnvPath(deps.platform.paths));
  } catch {
    appText = null;
  }
  if (appText !== null) {
    const g = await guardActiveRun(
      deps,
      nativeTarget(readSettings(appText), factOf(facts, app?.unit ?? '')),
      { wait: o.flags.wait === true, force: o.flags.force === true },
    );
    if (!g.ok) {
      deps.io.err(`${g.message}\n`);
      return EXIT.lockRefused;
    }
  }
  const sm = deps.platform.serviceManager;
  const wf = factOf(facts, worker.unit);
  const run = workerRunArgv(deps, 'counts', '--json');
  const write: Action = {
    kind: 'run',
    argv: run.argv,
    cwd: run.cwd,
    describe: 'the worker writes its monthly counts',
    stdin: { text: JSON.stringify({ pages, scrolls }), secret: false },
    env: serviceEnvironment(deps.execPath, deps.home),
  };
  const r = await apply(
    { command: o.command, actions: [...sm.stop(worker.unit, wf), write], notes: [] },
    deps.executor,
  );
  if (r.failed !== null) {
    deps.io.err(describeResult(o.command, r));
    return EXIT.failed;
  }
  deps.io.out(`The worker’s counts are now ${pages} pages and ${scrolls} scrolls for this window.\n`);
  if (wf.onDisk === null) return EXIT.ok;
  const start = await workerStart(deps, worker, await factsOf(deps, [worker]));
  if (start.notStarted !== null) deps.io.out(`worker: not started: ${start.notStarted}\n`);
  const s = await apply({ command: o.command, actions: start.actions, notes: [] }, deps.executor);
  if (s.failed !== null) {
    deps.io.err(describeResult(o.command, s));
    return EXIT.failed;
  }
  return EXIT.ok;
}

/** `gmt browser counts`. */
export function countsCommand(flags: Flags, deps: Deps): Promise<number> {
  return rewriteCounts(deps, {
    interactive: flags['non-interactive'] !== true,
    ask: deps.ask,
    flags,
    command: 'browser counts',
  });
}
