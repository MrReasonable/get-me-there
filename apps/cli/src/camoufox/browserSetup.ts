import { CONSENT_FIX, START_REFUSAL_TEXT } from '@gmt/core';
import { appUrl, credsFrom } from '../appClient.js';
import type { Ask } from '../ask.js';
import { consentChild } from '../commands/consent.js';
import type { Deps } from '../deps.js';
import type { Action } from '../plan/action.js';
import { apply } from '../plan/apply.js';
import { describeResult } from '../plan/describe.js';
import { assumedStopped, factOf, factsOf, serviceSet, workerEntry } from '../services/set.js';
import { appEnvPath } from '../services/specs.js';
import { readEnvText, readSettings } from '../setup/appEnv.js';
import { rewriteCounts } from './counts.js';
import { installCamoufox, oldBundleRemovals } from './installer.js';
import {
  browserAvailability,
  CONSENT_STEP,
  consentMethodText,
  costsSummary,
  ENABLE_QUESTION,
  RESUME_LINE,
  SERVER_QUESTION,
  SERVER_TEXT,
  unavailableText,
} from './offer.js';
import {
  appEnvWithBrowser,
  appShared,
  keysDiffer,
  newWorkerKey,
  readWorkerEnv,
  renderWorkerEnv,
  workerEnvPath,
  workerUrlOf,
} from './workerEnv.js';
import { checkWords, workerCheck, workerStart, workerStop } from './workerService.js';

/**
 * The browser provider in `gmt setup` (spec §13 "The gmt command"; decision 75; brief WP17 Task 17.6). The order is
 * fixed: costs, the consent method, the install (the one sequence `gmt browser install` runs: download, layout, Linux
 * libraries), worker.env with a new shared key mirrored into app.env, then (interactive, with a display) the consent
 * capture as its own step (review X5), then the worker's own start check: only once it says consent is in place does app.env gain CAMOUFOX_ENABLED=true and the worker service get installed and started.
 * Any step that stops leaves the provider off (`not-set-up`), and `pnpm gmt setup --reconfigure browser` resumes it.
 * With the provider on, `--reconfigure browser` installs a missing or changed bundle first, then offers a new key (yes
 * by default when the two files' keys differ) and, when the worker's counts file is missing or unreadable, the rewrite
 * `gmt browser counts` makes. A re-run of setup re-renders the worker's unit only once its check passes.
 */
export type BrowserOutcome = 'unavailable' | 'off' | 'not-set-up' | 'on' | 'failed';

/** The answers file's browser fields (decision 75): turn it on, and accept a server's own address. */
export interface BrowserChoice {
  enabled?: boolean;
  acceptServerAddress?: boolean;
  rotateKey?: boolean;
}

interface Options {
  interactive: boolean;
  ask: Ask;
  choice: BrowserChoice | null;
}

/**
 * The worker's stop and the app's (when it restarts), the files written, then the worker's start once its check passes
 * and the app's, and the health wait: worker before app, so the app's first status read finds the worker up.
 */
async function writeAndRestart(
  deps: Deps,
  files: Action[],
  /** startWorker: after its own check, or `checked` when the caller has just run that check, or not at all. */
  o: { appRestart: boolean; startWorker: boolean | 'checked' },
): Promise<string | null> {
  const sm = deps.platform.serviceManager;
  const entries = serviceSet(deps);
  const worker = workerEntry(deps);
  const app = entries.find((e) => e.name === 'app');
  const facts = await factsOf(deps, [...entries, worker]);
  const wf = factOf(facts, worker.unit);
  const af = factOf(facts, app?.unit ?? '');
  const port = credsFrom(readEnvText(deps.files.read(appEnvPath(deps.platform.paths)) ?? ''))?.port ?? 3000;
  const command = 'setup: the browser provider';
  const stopped = await apply(
    {
      command,
      actions: [
        ...(wf.onDisk === null ? [] : workerStop(deps, worker.unit, wf)),
        ...(o.appRestart && app !== undefined ? sm.stop(app.unit, af) : []),
        ...files,
      ],
      notes: [],
    },
    deps.executor,
  );
  if (stopped.failed !== null) return describeResult(command, stopped);
  const workerActions: Action[] = [];
  const stoppedFacts = new Map([[worker.unit, assumedStopped(wf)]]);
  if (o.startWorker === 'checked') {
    const install = sm.install(worker.rendered, stoppedFacts);
    workerActions.push(...(install.length === 0 ? sm.start(worker.unit, assumedStopped(wf)) : install));
  } else if (o.startWorker) {
    const start = await workerStart(deps, worker, stoppedFacts);
    if (start.notStarted !== null) deps.io.out(`worker: not started: ${start.notStarted}\n`);
    workerActions.push(...start.actions);
  }
  const started = await apply(
    {
      command,
      actions: [
        ...workerActions,
        ...(o.appRestart && app !== undefined
          ? [
              ...sm.start(app.unit, assumedStopped(af)),
              { kind: 'waitHealthy' as const, url: appUrl(port, '/api/health'), timeoutSeconds: 240 },
            ]
          : []),
      ],
      notes: [],
    },
    deps.executor,
  );
  return started.failed === null ? null : describeResult(command, started);
}

/** Whether to turn the provider on: asked on a terminal, read from the answers file otherwise. */
async function choose(deps: Deps, o: Options): Promise<boolean> {
  const display = deps.platform.hasDisplay;
  if (!o.interactive) return o.choice?.enabled === true && (display || o.choice.acceptServerAddress === true);
  if (!(await o.ask.confirm(ENABLE_QUESTION, false))) return false;
  return display || (await o.ask.typed(SERVER_QUESTION, 'yes'));
}

/**
 * The first turn-on, or its resumption: costs, the question, the consent method, the install, the two files, the
 * worker's check, then CAMOUFOX_ENABLED and the worker service.
 */
async function turnOn(deps: Deps, o: Options): Promise<BrowserOutcome> {
  const avail = browserAvailability(deps.platform);
  if (avail === null) {
    deps.io.out(`${unavailableText(`${deps.platform.os}-${deps.platform.arch}`)}\n`);
    return 'unavailable';
  }
  deps.io.out(`\n${costsSummary(avail.entry)}\n`);
  if (!deps.platform.hasDisplay) deps.io.out(`${SERVER_TEXT}\n`);
  if (!(await choose(deps, o))) {
    deps.io.out('The browser provider stays off.\n');
    return 'off';
  }
  // why: review X5 (spec §13's one wizard): interactive with a display, the capture is setup's own step after the install
  const display = deps.platform.hasDisplay;
  const wizard = display && o.interactive;
  deps.io.out(`${consentMethodText(display, wizard)}\n`);
  const paths = deps.platform.paths;
  const stop = (why: string): BrowserOutcome => {
    deps.io.err(`${why}\n${RESUME_LINE}\n`);
    return 'not-set-up';
  };
  const install = await installCamoufox(deps, { command: 'setup: install Camoufox' });
  if (install.kind !== 'ok') return stop(install.message);
  const appText = deps.files.read(appEnvPath(paths)) ?? '';
  const appRecord = readEnvText(appText);
  const workerText = deps.files.read(workerEnvPath(paths));
  const worker = readWorkerEnv(deps.files, paths);
  const url = workerUrlOf(worker);
  if (url === null) return stop('CAMOUFOX_WORKER_PORT in worker.env is not a port from 1024 to 65535');
  const key =
    worker?.CAMOUFOX_WORKER_KEY !== undefined && !keysDiffer(appRecord, worker)
      ? worker.CAMOUFOX_WORKER_KEY
      : newWorkerKey(deps.randomBytes);
  const workerEnv = renderWorkerEnv(key, appShared(appRecord), workerText);
  if (!workerEnv.ok) return stop(workerEnv.error);
  const appEnv = appEnvWithBrowser(appText, [
    ['CAMOUFOX_WORKER_URL', url],
    ['CAMOUFOX_WORKER_KEY', key],
  ]);
  if (!appEnv.ok) return stop(appEnv.error);
  const files: Action[] = [
    ...(deps.files.isDir(paths.workerData) && deps.files.mode(paths.workerData) === 0o700
      ? []
      : [{ kind: 'mkdir' as const, path: paths.workerData, mode: 0o700 as const }]),
    deps.platform.writeSecretFile(workerEnvPath(paths), workerEnv.text),
    deps.platform.writeSecretFile(appEnvPath(paths), appEnv.text),
  ];
  const wrote = await apply(
    { command: 'setup: the worker’s settings', actions: files, notes: [] },
    deps.executor,
  );
  if (wrote.failed !== null) return stop(describeResult('setup: the worker’s settings', wrote));
  let check = await workerCheck(deps);
  if (check.kind === 'refused' && check.refusal.reason.startsWith('consent-') && wizard) {
    deps.io.out(`${CONSENT_STEP}\n`);
    const child = consentChild(deps, null);
    const code = await deps.attach(child.argv, child.cwd, child.env);
    if (code !== 0)
      return stop(
        `The consent capture stored no rejection (it said why above). Run ${CONSENT_FIX.command} when you are ready.`,
      );
    check = await workerCheck(deps);
  }
  if (check.kind === 'refused') {
    const r = check.refusal.reason;
    if (r.startsWith('consent-'))
      return stop(
        `The worker needs your consent choice before it can start: ${START_REFUSAL_TEXT[r].summary}. ${consentMethodText(display, false)}`,
      );
  }
  if (check.kind !== 'ok') return stop(`The worker would refuse to start: ${checkWords(check)}`);
  const enabled = appEnvWithBrowser(deps.files.read(appEnvPath(paths)) ?? appEnv.text, [
    ['CAMOUFOX_ENABLED', 'true'],
  ]);
  if (!enabled.ok) return stop(enabled.error);
  const settings = readSettings(enabled.text);
  if (!settings.ok)
    return stop(`app.env would not pass the app’s settings check: ${settings.fields.join(', ')}`);
  const failed = await writeAndRestart(
    deps,
    [
      deps.platform.writeSecretFile(appEnvPath(paths), enabled.text),
      ...oldBundleRemovals(deps, install.bundle),
    ],
    // why: the check above just passed; the service starts on it
    { appRestart: true, startWorker: 'checked' },
  );
  if (failed !== null) {
    deps.io.err(failed);
    return 'failed';
  }
  deps.io.out('The browser provider is on: the worker service is installed and running.\n');
  return 'on';
}

/**
 * With the provider on: a missing or changed bundle installed first (dev-b1-001, po-b1-002: the `layout` and
 * `build-mismatch` refusals' fix works here too), then a new key on request (yes by default when the keys differ), and
 * the counts rewrite when the worker's counts file is missing or unreadable.
 */
async function reconfigureOn(deps: Deps, o: Options): Promise<BrowserOutcome> {
  const paths = deps.platform.paths;
  const install = await installCamoufox(deps, { command: 'setup: install Camoufox' });
  if (install.kind !== 'ok') {
    deps.io.err(`${install.message}\n`);
    return install.kind === 'failed' ? 'failed' : 'not-set-up';
  }
  const appText = deps.files.read(appEnvPath(paths)) ?? '';
  const appRecord = readEnvText(appText);
  const worker = readWorkerEnv(deps.files, paths);
  const differ = keysDiffer(appRecord, worker);
  if (differ) deps.io.out('The app’s and the worker’s keys differ.\n');
  const rotate = o.interactive
    ? await o.ask.confirm('Generate a new worker key?', differ)
    : (o.choice?.rotateKey ?? differ);
  const removals = oldBundleRemovals(deps, install.bundle);
  if (rotate) {
    const key = newWorkerKey(deps.randomBytes);
    const workerEnv = renderWorkerEnv(key, appShared(appRecord), deps.files.read(workerEnvPath(paths)));
    const appEnv = appEnvWithBrowser(appText, [['CAMOUFOX_WORKER_KEY', key]]);
    if (!workerEnv.ok || !appEnv.ok) {
      deps.io.err(`${workerEnv.ok ? '' : `${workerEnv.error}\n`}${appEnv.ok ? '' : `${appEnv.error}\n`}`);
      return 'failed';
    }
    const failed = await writeAndRestart(
      deps,
      [
        deps.platform.writeSecretFile(workerEnvPath(paths), workerEnv.text),
        deps.platform.writeSecretFile(appEnvPath(paths), appEnv.text),
        ...removals,
      ],
      { appRestart: true, startWorker: true },
    );
    if (failed !== null) {
      deps.io.err(`${failed}A re-run of pnpm gmt setup --reconfigure browser repairs the keys.\n`);
      return 'failed';
    }
    deps.io.out('A new worker key is in worker.env and app.env; the worker and the app restarted.\n');
  } else if (install.changed || removals.length > 0) {
    // why: a bundle just installed or switched is the worker's from its next start, which waits for its check
    const failed = await writeAndRestart(deps, removals, { appRestart: false, startWorker: true });
    if (failed !== null) {
      deps.io.err(failed);
      return 'failed';
    }
  }
  const counts = await rewriteCounts(deps, {
    interactive: o.interactive,
    ask: o.ask,
    flags: {},
    command: 'setup: the worker’s counts',
  });
  return counts === 0 ? 'on' : 'failed';
}

/** The browser part of setup: first run (`reconfigure` false) or `--reconfigure browser`. */
export async function browserSetup(
  deps: Deps,
  o: Options & { reconfigure: boolean },
): Promise<BrowserOutcome> {
  const appRecord = readEnvText(deps.files.read(appEnvPath(deps.platform.paths)) ?? '');
  if (appRecord.CAMOUFOX_ENABLED === 'true') {
    if (o.reconfigure) return reconfigureOn(deps, o);
    // why: a re-run re-renders the worker's unit when it changed (a new checkout or Node path), and like every start of
    // the worker only once its own check passes (CodeRabbit, PR #15); unchanged plans nothing
    const w = workerEntry(deps);
    const facts = await deps.platform.serviceManager.facts(w.rendered, deps.run);
    if (deps.platform.serviceManager.install(w.rendered, facts).length === 0) return 'on';
    const start = await workerStart(deps, w, facts);
    if (start.notStarted !== null) {
      deps.io.out(`worker: not started: ${start.notStarted}\n`);
      return 'on';
    }
    const r = await apply(
      { command: 'setup: the worker service', actions: start.actions, notes: [] },
      deps.executor,
    );
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
