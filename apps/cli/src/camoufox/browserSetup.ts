import { join } from 'node:path/posix';
import {
  START_REFUSAL_TEXT,
  type StartRefusal,
  sharedInt,
  startRefusalSchema,
  WORKER_KEY_HEADER,
  workerStatusSchema,
} from '@gmt/core';
import { appUrl, authHeaders, credsFrom } from '../appClient.js';
import type { Ask } from '../ask.js';
import type { Deps } from '../deps.js';
import type { Action } from '../plan/action.js';
import { apply } from '../plan/apply.js';
import { describeResult } from '../plan/describe.js';
import type { ServiceFacts } from '../platform/types.js';
import { factOf, factsOf, serviceSet, workerEntry } from '../services/set.js';
import { appEnvPath, serviceEnvironment } from '../services/specs.js';
import { readEnvText, readSettings } from '../setup/appEnv.js';
import { freeBytesAt, planInstall } from './install.js';
import { planLayout } from './layout.js';
import { libraryProblem, unzipProblem } from './libs.js';
import {
  browserAvailability,
  consentMethodText,
  costsSummary,
  ENABLE_QUESTION,
  RESUME_LINE,
  SERVER_QUESTION,
  SERVER_TEXT,
  unavailableText,
} from './offer.js';
import {
  appShared,
  keysDiffer,
  newWorkerKey,
  readWorkerEnv,
  renderWorkerEnv,
  WORKER_URL,
  withBrowserLines,
  workerEnvPath,
} from './workerEnv.js';

/**
 * The browser provider in `gmt setup` (spec §13 "The gmt command"; decision 75; brief WP17 Task 17.6). The order is
 * fixed: costs, the consent method, the install (download, layout, Linux libraries), worker.env with a new shared key
 * mirrored into app.env, then the worker's own start check: only once it says consent is in place does app.env gain
 * CAMOUFOX_ENABLED=true and the worker service get installed and started. Any step that stops leaves the provider off
 * (`not-set-up`), and `pnpm gmt setup --reconfigure browser` resumes it. With the provider on, `--reconfigure browser`
 * offers a new key (yes by default when the two files' keys differ) and, when the worker's counts file refused, a
 * rewrite from the app's own ledger.
 */
export type BrowserOutcome = 'unavailable' | 'off' | 'not-set-up' | 'on' | 'failed';

/** The answers file's browser fields (decision 75): turn it on, and accept a server's own address. */
export interface BrowserChoice {
  enabled?: boolean;
  acceptServerAddress?: boolean;
  rotateKey?: boolean;
}

/** The worker's own start check, `run.ts check --json`, run as the service would (PATH and HOME only). */
export async function workerCheck(
  deps: Deps,
): Promise<{ kind: 'ok' } | { kind: 'refused'; refusal: StartRefusal } | { kind: 'failed'; error: string }> {
  const pkg = join(deps.checkout, 'apps', 'camoufox-worker');
  const r = await deps.run(
    [
      deps.execPath,
      '--conditions=@gmt/source',
      '--import',
      'tsx',
      join(pkg, 'src', 'run.ts'),
      'check',
      '--json',
    ],
    { cwd: pkg, timeoutMs: 60_000, env: serviceEnvironment(deps.execPath, deps.home) },
  );
  const line = r.stdout.trim().split('\n').at(-1) ?? '';
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    return { kind: 'failed', error: `the worker’s start check printed no result (exit ${r.code})` };
  }
  if (typeof json === 'object' && json !== null && 'ok' in json && json.ok === true) return { kind: 'ok' };
  const refusal = startRefusalSchema.safeParse(json);
  return refusal.success
    ? { kind: 'refused', refusal: refusal.data }
    : { kind: 'failed', error: 'the worker’s start check printed what this build cannot read' };
}

/** A refusal's words for the operator: core's summary and its fix. */
export const refusalWords = (r: StartRefusal): string => {
  const t = START_REFUSAL_TEXT[r.reason];
  return `${t.summary}${t.fixCommand === null ? '' : ` (fix: ${t.fixCommand})`}`;
};

const assumedStopped = (f: ServiceFacts): ServiceFacts => ({ ...f, loaded: false, state: 'stopped' });

/** The app's and the worker's stop, the two files written, then the worker's start and the app's, and the health wait. */
async function writeAndRestart(
  deps: Deps,
  files: Action[],
  o: { appRestart: boolean },
): Promise<string | null> {
  const sm = deps.platform.serviceManager;
  const entries = serviceSet(deps);
  const worker = workerEntry(deps);
  const app = entries.find((e) => e.name === 'app');
  const facts = await factsOf(deps, [...entries, worker]);
  const wf = factOf(facts, worker.unit);
  const af = factOf(facts, app?.unit ?? '');
  const port = credsFrom(readEnvText(deps.files.read(appEnvPath(deps.platform.paths)) ?? ''))?.port ?? 3000;
  const actions: Action[] = [
    ...(wf.onDisk === null ? [] : sm.stop(worker.unit, wf)),
    ...(o.appRestart && app !== undefined ? sm.stop(app.unit, af) : []),
    ...files,
    ...(wf.onDisk === null ? [] : sm.start(worker.unit, assumedStopped(wf))),
    ...(o.appRestart && app !== undefined
      ? [
          ...sm.start(app.unit, assumedStopped(af)),
          { kind: 'waitHealthy' as const, url: appUrl(port, '/api/health'), timeoutSeconds: 240 },
        ]
      : []),
  ];
  const r = await apply({ command: 'setup: the browser provider', actions, notes: [] }, deps.executor);
  return r.failed === null ? null : describeResult('setup: the browser provider', r);
}

/** Whether to turn the provider on: asked on a terminal, read from the answers file otherwise. */
async function choose(
  deps: Deps,
  o: { interactive: boolean; ask: Ask; choice: BrowserChoice | null },
): Promise<boolean> {
  const display = deps.platform.hasDisplay;
  if (!o.interactive) return o.choice?.enabled === true && (display || o.choice.acceptServerAddress === true);
  if (!(await o.ask.confirm(ENABLE_QUESTION, false))) return false;
  return display || (await o.ask.typed(SERVER_QUESTION, 'yes'));
}

/**
 * The first turn-on, or its resumption: costs, the question, the consent method, the install, the two files, the
 * worker's check, then CAMOUFOX_ENABLED and the worker service.
 */
async function turnOn(
  deps: Deps,
  o: { interactive: boolean; ask: Ask; choice: BrowserChoice | null },
): Promise<BrowserOutcome> {
  const avail = browserAvailability(deps.platform);
  const os = deps.platform.os;
  if (avail === null || os === 'win32') {
    deps.io.out(`${unavailableText(`${deps.platform.os}-${deps.platform.arch}`)}\n`);
    return 'unavailable';
  }
  deps.io.out(`\n${costsSummary(avail.entry)}\n`);
  if (!deps.platform.hasDisplay) deps.io.out(`${SERVER_TEXT}\n`);
  if (!(await choose(deps, o))) {
    deps.io.out('The browser provider stays off.\n');
    return 'off';
  }
  deps.io.out(`${consentMethodText(deps.platform.hasDisplay)}\n`);
  const paths = deps.platform.paths;
  const root = paths.camoufoxRoot;
  const stop = (why: string): BrowserOutcome => {
    deps.io.err(`${why}\n${RESUME_LINE}\n`);
    return 'not-set-up';
  };
  const unzip = await unzipProblem(deps.run, os);
  if (unzip !== null) return stop(unzip);
  const random = deps.randomBytes(4).toString('hex');
  const install = planInstall({
    root,
    entry: avail.entry,
    files: deps.files,
    freeBytes: await freeBytesAt(deps.run, deps.files, root),
    random,
  });
  if (install.kind === 'refused') return stop(install.message);
  const layout = planLayout({
    os,
    root,
    bundle: install.bundle,
    entry: avail.entry,
    files: deps.files,
    random,
  });
  if (layout.kind === 'refused') return stop(layout.message);
  const installing = [...(install.kind === 'install' ? install.actions : []), ...layout.actions];
  if (installing.length > 0) {
    const r = await apply(
      { command: 'setup: install Camoufox', actions: installing, notes: [] },
      deps.executor,
    );
    if (r.failed !== null) return stop(describeResult('setup: install Camoufox', r));
  }
  if (os === 'linux') {
    const libs = await libraryProblem(deps.run, deps.files, install.bundle);
    if (libs !== null) return stop(libs);
  }
  const appText = deps.files.read(appEnvPath(paths)) ?? '';
  const appRecord = readEnvText(appText);
  const workerText = deps.files.read(workerEnvPath(paths));
  const worker = readWorkerEnv(deps.files, paths);
  const key =
    worker?.CAMOUFOX_WORKER_KEY !== undefined && !keysDiffer(appRecord, worker)
      ? worker.CAMOUFOX_WORKER_KEY
      : newWorkerKey(deps.randomBytes);
  const files: Action[] = [
    ...(deps.files.isDir(paths.workerData) && deps.files.mode(paths.workerData) === 0o700
      ? []
      : [{ kind: 'mkdir' as const, path: paths.workerData, mode: 0o700 as const }]),
    deps.platform.writeSecretFile(
      workerEnvPath(paths),
      renderWorkerEnv(key, appShared(appRecord), workerText),
    ),
    deps.platform.writeSecretFile(
      appEnvPath(paths),
      withBrowserLines(appText, [
        ['CAMOUFOX_WORKER_URL', WORKER_URL],
        ['CAMOUFOX_WORKER_KEY', key],
      ]),
    ),
  ];
  const wrote = await apply(
    { command: 'setup: the worker’s settings', actions: files, notes: [] },
    deps.executor,
  );
  if (wrote.failed !== null) return stop(describeResult('setup: the worker’s settings', wrote));
  const check = await workerCheck(deps);
  if (check.kind === 'failed') return stop(check.error);
  if (check.kind === 'refused') {
    const r = check.refusal.reason;
    if (r === 'consent-missing' || r === 'consent-expired' || r === 'consent-voided')
      return stop(
        `The worker needs your consent choice before it can start: ${START_REFUSAL_TEXT[r].summary}. ${consentMethodText(deps.platform.hasDisplay)}`,
      );
    return stop(`The worker would refuse to start: ${refusalWords(check.refusal)}`);
  }
  const enabled = withBrowserLines(deps.files.read(appEnvPath(paths)) ?? appText, [
    ['CAMOUFOX_ENABLED', 'true'],
  ]);
  const settings = readSettings(enabled);
  if (!settings.ok)
    return stop(`app.env would not pass the app’s settings check: ${settings.fields.join(', ')}`);
  const sm = deps.platform.serviceManager;
  const w = workerEntry(deps);
  const facts = await sm.facts(w.rendered, deps.run);
  const failed = await writeAndRestart(
    deps,
    [deps.platform.writeSecretFile(appEnvPath(paths), enabled), ...sm.install(w.rendered, facts)],
    { appRestart: true },
  );
  if (failed !== null) {
    deps.io.err(failed);
    return 'failed';
  }
  deps.io.out('The browser provider is on: the worker service is installed and running.\n');
  return 'on';
}

/** With the provider on: a new key on request (yes by default when the keys differ), and a refused counts file's rewrite. */
async function reconfigureOn(
  deps: Deps,
  o: { interactive: boolean; ask: Ask; choice: BrowserChoice | null },
): Promise<BrowserOutcome> {
  const paths = deps.platform.paths;
  const appText = deps.files.read(appEnvPath(paths)) ?? '';
  const appRecord = readEnvText(appText);
  const worker = readWorkerEnv(deps.files, paths);
  const differ = keysDiffer(appRecord, worker);
  if (differ) deps.io.out('The app’s and the worker’s keys differ.\n');
  const rotate = o.interactive
    ? await o.ask.confirm('Generate a new worker key?', differ)
    : (o.choice?.rotateKey ?? differ);
  if (rotate) {
    const key = newWorkerKey(deps.randomBytes);
    const failed = await writeAndRestart(
      deps,
      [
        deps.platform.writeSecretFile(
          workerEnvPath(paths),
          renderWorkerEnv(key, appShared(appRecord), deps.files.read(workerEnvPath(paths))),
        ),
        deps.platform.writeSecretFile(
          appEnvPath(paths),
          withBrowserLines(appText, [['CAMOUFOX_WORKER_KEY', key]]),
        ),
      ],
      { appRestart: true },
    );
    if (failed !== null) {
      deps.io.err(`${failed}A re-run of pnpm gmt setup --reconfigure browser repairs the keys.\n`);
      return 'failed';
    }
    deps.io.out('A new worker key is in worker.env and app.env; the worker and the app restarted.\n');
  }
  return (await rewriteCounts(deps, o)) ? 'on' : 'failed';
}

/**
 * The worker's counts file refused (`monthly.readable` false in its status): offer to rewrite it from the app's own
 * ledger for this window. The app counts pages, not scrolls, so the month's scrolls are counted as spent (the worker
 * never under-counts), and pages other apps caused are not in the figure. Nothing is written without a yes.
 */
async function rewriteCounts(deps: Deps, o: { interactive: boolean; ask: Ask }): Promise<boolean> {
  const paths = deps.platform.paths;
  const worker = readWorkerEnv(deps.files, paths);
  const key = worker?.CAMOUFOX_WORKER_KEY;
  if (key === undefined) return true;
  const port = Number(worker?.CAMOUFOX_WORKER_PORT ?? '8090');
  const s = await deps.http({
    method: 'GET',
    url: `http://127.0.0.1:${port}/v1/status`,
    headers: { [WORKER_KEY_HEADER]: key },
    timeoutMs: 10_000,
  });
  if ('error' in s || s.status !== 200) return true;
  let status: ReturnType<typeof workerStatusSchema.parse>;
  try {
    status = workerStatusSchema.parse(JSON.parse(s.body));
  } catch {
    return true;
  }
  if (status.monthly === undefined || status.monthly.readable) return true;
  const appRecord = readEnvText(deps.files.read(appEnvPath(paths)) ?? '');
  const creds = credsFrom(appRecord);
  if (creds === null) return true;
  const p = await deps.http({
    method: 'GET',
    url: appUrl(creds.port, '/api/providers'),
    headers: authHeaders(creds),
    timeoutMs: 10_000,
  });
  if ('error' in p || p.status !== 200) {
    deps.io.err(
      'The worker’s counts file is unreadable, and the app’s ledger could not be read to rewrite it.\n',
    );
    return false;
  }
  const pages = pagesFromProviders(p.body);
  if (pages === null) return false;
  const { windowStart } = status.monthly;
  const scrolls = sharedInt(appShared(appRecord), 'CAMOUFOX_MONTHLY_SCROLL_CAP');
  deps.io.out(
    `The worker’s monthly counts file could not be read, so it refuses every page. This app’s ledger counts ${pages} browser pages this month (pages other apps caused are not in that figure); the app does not count scrolls, so the month’s ${scrolls} scrolls would be counted as spent.\n`,
  );
  if (!o.interactive || !(await o.ask.confirm('Rewrite the worker’s counts from these figures?', false)))
    return true;
  const failed = await writeAndRestart(
    deps,
    [
      {
        kind: 'writeFile',
        path: join(paths.workerData, 'monthly.json'),
        contents: JSON.stringify({ windowStart, pages, scrolls }),
        mode: 0o600,
        secret: false,
      },
    ],
    { appRestart: false },
  );
  if (failed !== null) {
    deps.io.err(failed);
    return false;
  }
  return true;
}

/** The camoufox provider-month calls from `GET /api/providers`, or null when the answer says none. */
export function pagesFromProviders(body: string): number | null {
  try {
    const raw: unknown = JSON.parse(body);
    if (typeof raw !== 'object' || raw === null || !('providers' in raw) || !Array.isArray(raw.providers))
      return null;
    for (const p of raw.providers) {
      if (typeof p !== 'object' || p === null || !('providerId' in p) || p.providerId !== 'camoufox')
        continue;
      if (!('usage' in p) || !Array.isArray(p.usage)) return null;
      for (const u of p.usage)
        if (
          typeof u === 'object' &&
          u !== null &&
          'scope' in u &&
          typeof u.scope === 'string' &&
          u.scope.startsWith('provider-month') &&
          'calls' in u &&
          typeof u.calls === 'number'
        )
          return u.calls;
    }
    return null;
  } catch {
    return null;
  }
}

/** The browser part of setup: first run (`reconfigure` false) or `--reconfigure browser`. */
export async function browserSetup(
  deps: Deps,
  o: { interactive: boolean; ask: Ask; choice: BrowserChoice | null; reconfigure: boolean },
): Promise<BrowserOutcome> {
  const appRecord = readEnvText(deps.files.read(appEnvPath(deps.platform.paths)) ?? '');
  if (appRecord.CAMOUFOX_ENABLED === 'true') {
    if (o.reconfigure) return reconfigureOn(deps, o);
    // why: a re-run re-renders the worker's unit when it changed (a new checkout or Node path); unchanged plans nothing
    const w = workerEntry(deps);
    const actions = deps.platform.serviceManager.install(
      w.rendered,
      await deps.platform.serviceManager.facts(w.rendered, deps.run),
    );
    const r = await apply({ command: 'setup: the worker service', actions, notes: [] }, deps.executor);
    if (r.failed === null) return 'on';
    deps.io.err(describeResult('setup: the worker service', r));
    return 'failed';
  }
  // why: a run with no terminal and no browser answer asks nothing and turns nothing on, but still says once where
  // the provider is not offered on this machine
  if (!o.reconfigure && !o.interactive && o.choice?.enabled === undefined) {
    if (browserAvailability(deps.platform) !== null) return 'off';
    deps.io.out(`${unavailableText(`${deps.platform.os}-${deps.platform.arch}`)}\n`);
    return 'unavailable';
  }
  return turnOn(deps, o);
}
