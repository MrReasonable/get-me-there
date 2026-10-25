import { dirname, join, resolve } from 'node:path/posix';
import { credsFrom } from '../appClient.js';
import { type Flags, isReconfigureGroup, type ReconfigureGroup } from '../args.js';
import { noAsk } from '../ask.js';
import { browserSetup } from '../camoufox/browserSetup.js';
import { type Deps, EXIT } from '../deps.js';
import { type Action, type Plan, runAction } from '../plan/action.js';
import { apply } from '../plan/apply.js';
import { describeAction, describePlan, describeResult } from '../plan/describe.js';
import type { ServiceFacts } from '../platform/types.js';
import { WIN32_REFUSAL } from '../platform/win32.js';
import { factOf, factsOf, type ServiceEntry, serviceSet } from '../services/set.js';
import {
  appEnvPath,
  controlProblem,
  dailyBackupsDir,
  databasePath,
  execPathProblem,
  isLoopback,
} from '../services/specs.js';
import {
  type Answers,
  defaultAnswers,
  loadAnswersFile,
  plainProblems,
  searchSource,
  secretProblems,
} from '../setup/answers.js';
import {
  answersFromConfig,
  checkAppEnv,
  type Entries,
  entriesFor,
  ownedDiff,
  readSettings,
  renderAppEnv,
  replaceGroups,
  type Settings,
} from '../setup/appEnv.js';
import { closingScreen, NO_SOURCE_TEXT, nextStep } from '../setup/closing.js';
import { type DockerFacts, gatherDocker, judgeDocker } from '../setup/docker.js';
import {
  backupAction,
  checkedSummary,
  lockFree,
  markerBesideAction,
  nativeBackupAction,
  placeActions,
  printedBackup,
  startNote,
} from '../setup/importDb.js';
import {
  type ComposeFacts,
  carryOver,
  composeFacts,
  DOCKER_BACKUP_DIR,
  DOWN_REASON,
  dockerBackupAction,
  dockerCopiedPath,
  dockerCopyAction,
  dockerDownAction,
  dockerGuardTarget,
  dockerMarkerAction,
  dockerStopAction,
  MARKER_REMOVAL,
} from '../setup/importDocker.js';
import { lingerPlan, runLinger } from '../setup/linger.js';
import { describeProblems, gatherPrereqs, judgePrereqs, nextFreePort } from '../setup/prereqs.js';
import { askAnswers, askPasteToken, type PromptRow } from '../setup/prompts.js';
import { readSetupRecord, recordAction, type SetupRecord } from '../setup/record.js';
import { generatePassword } from '../setup/secrets.js';
import { offeredFor, offerTestEmail } from '../setup/testEmail.js';
import { type GuardTarget, guardActiveRun } from './guard.js';

/** The rows each `--reconfigure` group asks (brief §6); `password` asks none and generates a new one. */
const GROUP_ROWS: Record<ReconfigureGroup, PromptRow[]> = {
  port: [1],
  timezone: [2],
  travelpayouts: [4],
  searchapi: [5],
  email: [6],
  browser: [9],
  password: [],
  linger: [7],
};

const failed = (deps: Deps, message: string): number => {
  deps.io.err(`${message}\n`);
  return EXIT.failed;
};
const refuse = (deps: Deps, message: string, code: number = EXIT.badConfig): number => {
  deps.io.err(message.endsWith('\n') ? message : `${message}\n`);
  return code;
};

/** macOS's privacy-protected folders, which a launchd agent cannot read without a grant (U5, dev-b1-008). */
const PROTECTED = ['Desktop', 'Documents', 'Downloads', 'Library/Mobile Documents'];

/** The directories a native install needs, 0700 (the service directory 0755), made or tightened when not so (U8). */
function directoryActions(deps: Deps): Action[] {
  const p = deps.platform.paths;
  const dirs: Array<[string, 0o700 | 0o755]> = [
    [p.config, 0o700],
    [p.data, 0o700],
    [join(p.data, 'backups'), 0o700],
    [dailyBackupsDir(p), 0o700],
    [join(p.data, 'backups', 'update'), 0o700],
    [p.state, 0o700],
    ...(p.logs === null ? [] : [[p.logs, 0o700] satisfies [string, 0o700]]),
    [p.serviceDir, 0o755],
  ];
  return dirs
    .filter(([d, mode]) => !deps.files.isDir(d) || (mode === 0o700 && (deps.files.mode(d) ?? 0) !== 0o700))
    .map(([path, mode]) => ({ kind: 'mkdir', path, mode }));
}

/** Install every service, then start the app when nothing in the install started it (or restart it for new settings). */
function serviceActions(
  deps: Deps,
  entries: readonly ServiceEntry[],
  facts: ReadonlyMap<string, ServiceFacts>,
  settingsChanged: boolean,
): Action[] {
  const sm = deps.platform.serviceManager;
  const out: Action[] = [];
  for (const e of entries) {
    const install = sm.install(e.rendered, facts);
    out.push(...install);
    if (e.name !== 'app' || install.length > 0) continue;
    const f = factOf(facts, e.unit);
    out.push(...(settingsChanged ? sm.restart(e.unit, f) : sm.start(e.unit, f)));
  }
  return out;
}

const hasBackup = (deps: Deps): boolean =>
  (deps.files.list(dailyBackupsDir(deps.platform.paths)) ?? []).some((n) => n.endsWith('.db'));

/** Runs the backup job once and waits for its file (launchd's kickstart returns at once; systemd's oneshot waits). */
async function firstBackup(deps: Deps, backup: ServiceEntry): Promise<boolean> {
  if (hasBackup(deps)) return true;
  const facts = await deps.platform.serviceManager.facts(backup.rendered, deps.run);
  const actions = deps.platform.serviceManager.start(backup.unit, factOf(facts, backup.unit));
  const r = await apply({ command: 'first backup', actions, notes: [] }, deps.executor);
  if (r.failed !== null) return false;
  for (let i = 0; i < 60 && !hasBackup(deps); i++) await deps.sleep(2000);
  return hasBackup(deps);
}

/** Answers from a file over the current values; a refusal is thrown with its message (fields only, never values). */
async function fromFile(path: string, deps: Deps, defaults: Answers): Promise<Answers> {
  const r = await loadAnswersFile(path, deps, { defaults });
  if (!r.ok) throw new Error(r.error);
  return r.answers;
}

/** The native app as the active-run guard sees it, from its settings and its service's state. */
export function nativeTarget(settings: Settings | null, appFacts: ServiceFacts): GuardTarget {
  // why: CodeRabbit (PR #11): a failed (or restarting) app has no live process, so no search can be running in it
  const up = appFacts.state === 'running';
  if (settings === null || !settings.ok) return { label: 'the app', up, creds: null, autoResume: true };
  const auth = settings.config.auth;
  return {
    label: 'the app',
    up,
    creds: auth === null ? null : { port: settings.config.port, user: auth.user, pass: auth.pass.reveal() },
    autoResume: settings.config.autoResume,
  };
}

export const LEDGER_DROPPED =
  'its ledger is left behind, so the calls it counted this month (and the SearchApi trial’s) stop counting toward the caps here. Check each vendor’s dashboard, and set SEARCHAPI_TRIAL_USED (trial) or SEARCHAPI_MONTHLY_CALL_CAP ($40 plan) in app.env to match if needed.';

/** `gmt setup` (spec §13): checks, answers, the settings file, the moves, the services, the health wait, the backup. */
export async function setupCommand(flags: Flags, _positional: string | null, deps: Deps): Promise<number> {
  // why: decision 78: on Windows a dry run states the refusal and succeeds with no plan; a real setup refuses (78)
  if (deps.platform.os === 'win32') {
    deps.io.out(`${WIN32_REFUSAL}\n`);
    return flags['dry-run'] === true ? EXIT.ok : EXIT.badConfig;
  }
  const os = deps.platform.os;
  const paths = deps.platform.paths;
  const dryRun = flags['dry-run'] === true;
  const guardFlags = { wait: flags.wait === true, force: flags.force === true };
  const group =
    typeof flags.reconfigure === 'string' && isReconfigureGroup(flags.reconfigure) ? flags.reconfigure : null;
  const answersPath = typeof flags.answers === 'string' ? resolve(deps.invocationCwd, flags.answers) : null;
  const nonInteractive = flags['non-interactive'] === true;
  const interactive = !nonInteractive && answersPath === null && deps.io.stdinIsTTY;
  const ask = nonInteractive ? noAsk : deps.ask;
  const envPath = appEnvPath(paths);
  let existingText: string | null;
  try {
    existingText = deps.files.read(envPath);
  } catch (e) {
    const code = e instanceof Error && 'code' in e ? String(e.code) : 'an error';
    return refuse(
      deps,
      `cannot read ${envPath} (${code}); it was not changed. Make it yours and 0600 (chown, chmod 600), then run setup again`,
    );
  }
  const settings = existingText === null ? null : readSettings(existingText);
  if (settings !== null && !settings.ok)
    return refuse(
      deps,
      `${envPath} would not pass the app’s settings check (${settings.fields.join(', ')}); setup does not guess. Correct those lines, then run setup again`,
    );
  const record = readSetupRecord(deps);

  // 1. checks, all before any action
  const pathProblem = controlProblem({
    checkout: deps.checkout,
    home: deps.home,
    'Node binary': deps.execPath,
    settings: paths.config,
    data: paths.data,
    state: paths.state,
    'service directory': paths.serviceDir,
    ...(paths.logs === null ? {} : { logs: paths.logs }),
  });
  if (pathProblem !== null) return refuse(deps, `setup cannot continue: ${pathProblem}`);
  const nodeProblem = execPathProblem(deps.execPath, os, [deps.tmpDir]);
  if (nodeProblem !== null) return refuse(deps, `setup cannot continue: ${nodeProblem}`);
  if (os === 'darwin' && PROTECTED.some((d) => deps.checkout.startsWith(`${join(deps.home, d)}/`)))
    return refuse(
      deps,
      `setup cannot continue: the checkout ${deps.checkout} is in a folder macOS protects, which a background service cannot read. Move the clone (for example to ~/projects/get-me-there), then run pnpm gmt setup there`,
    );
  if (group !== null && settings === null)
    return refuse(deps, `there is no ${envPath} to reconfigure: run pnpm gmt setup first`);
  if (group === 'linger' && os !== 'linux')
    return refuse(deps, 'linger is a Linux setting; macOS runs the app while you are logged in');
  const notes: string[] = [];
  const importDocker = group === null && flags['import-docker'] === true;
  const importDbPath =
    group === null && typeof flags['import-db'] === 'string'
      ? resolve(deps.invocationCwd, flags['import-db'])
      : null;
  const ignoreDocker = group === null && flags['ignore-docker'] === true;
  const replace = flags['replace-database'] === true;
  const nativeDb = databasePath(paths);
  const nativeInstalled = record.installed || record.moved;
  let dockerFacts: DockerFacts | null = null;
  let compose: ComposeFacts | null = null;
  if (group === null) {
    if (record.import !== null && !record.moved && !importDocker && importDbPath === null && !ignoreDocker)
      return refuse(
        deps,
        `an import did not finish, so nothing was moved yet: run pnpm gmt setup ${record.import === 'docker' ? '--import-docker' : '--import-db <the database>'} again, or --ignore-docker to start fresh`,
      );
    const pre = judgePrereqs(await gatherPrereqs(deps, null));
    dockerFacts = await gatherDocker(deps);
    const docker = judgeDocker(dockerFacts, { importDocker, ignoreDocker, nativeInstalled });
    const problems = [...pre.problems, ...docker];
    if (problems.length > 0) return refuse(deps, describeProblems(problems));
    notes.push(...pre.notes);
    if (importDbPath !== null) {
      if (deps.files.size(importDbPath) === null)
        return refuse(deps, `there is no database file at ${importDbPath} to import`);
      const real = deps.files.realpath(importDbPath) ?? importDbPath;
      if (
        real === (deps.files.realpath(nativeDb) ?? nativeDb) ||
        dirname(real) === (deps.files.realpath(paths.data) ?? paths.data)
      )
        return refuse(deps, `${importDbPath} is the native install’s own data; there is nothing to import`);
    }
    if ((importDocker || importDbPath !== null) && deps.files.size(nativeDb) !== null && !replace)
      return refuse(
        deps,
        `a native database already exists at ${nativeDb}: pass --replace-database to back it up and replace it with the import (${LEDGER_DROPPED.replace('its ledger', 'the native ledger')})`,
      );
    if (importDocker || (ignoreDocker && dockerFacts.daemon && (dockerFacts.project || dockerFacts.volume))) {
      compose = await composeFacts(deps);
      const g = await guardActiveRun(deps, dockerGuardTarget(compose), guardFlags);
      if (!g.ok) return refuse(deps, g.message, EXIT.lockRefused);
    }
  }
  const moving = importDocker || importDbPath !== null || compose !== null;

  const entriesSet = serviceSet(deps);
  const facts = await factsOf(deps, entriesSet);
  const appEntry = entriesSet.find((e) => e.name === 'app');
  const appFacts = factOf(facts, appEntry?.unit ?? '');
  const target = nativeTarget(settings, appFacts);

  // 2. answers
  const current = settings?.ok === true ? answersFromConfig(settings.config, settings.record, record) : null;
  let answers: Answers;
  let extra: Entries = [];
  if (group !== null && current !== null) {
    if (group !== 'linger' && !dryRun) {
      // why: U1 (cb-b1-009, dev-b1-004, po-b1-009): every group that restarts the app asks it first, before any question
      const g = await guardActiveRun(deps, target, guardFlags);
      if (!g.ok) return refuse(deps, g.message, EXIT.lockRefused);
      // why: decision 83: the interrupted run reads the new value when it resumes
      if (g.forced && group === 'browser') deps.io.out('The new value applies when the run resumes.\n');
    }
    if (group === 'browser' && settings?.ok === true && settings.record.CAMOUFOX_ENABLED !== 'true')
      deps.io.out(
        'The browser provider is not set up on this machine yet; this only records what it would do after an interruption.\n',
      );
    try {
      answers =
        answersPath !== null
          ? await fromFile(answersPath, deps, current)
          : await askAnswers(ask, { os, defaults: current, rows: new Set(GROUP_ROWS[group]), io: deps.io });
    } catch (e) {
      return refuse(deps, e instanceof Error ? e.message : String(e));
    }
  } else if (current !== null && answersPath === null && !moving) {
    answers = current;
  } else {
    const port = (await deps.portFree(3000)) ? 3000 : ((await nextFreePort(3000, deps.portFree)) ?? 3000);
    let defaults = current ?? defaultAnswers({ port, timezone: deps.machineTimeZone });
    let rows: Set<PromptRow> | null = null;
    if (importDocker && compose?.record != null) {
      const carried = await carryOver(deps, ask, compose.record, defaults, interactive);
      if (!carried.ok) return refuse(deps, carried.error);
      defaults = carried.answers;
      extra = carried.extra;
      rows = new Set(([1, 2, 3, 4, 5, 6, 7] as const).filter((r) => !carried.rows.has(r)));
    }
    try {
      answers =
        answersPath !== null
          ? await fromFile(answersPath, deps, defaults)
          : await askAnswers(ask, { os, defaults, rows, io: deps.io });
    } catch (e) {
      return refuse(deps, e instanceof Error ? e.message : String(e));
    }
  }
  const problems = [...secretProblems(answers), ...plainProblems(answers)];
  if (problems.length > 0) return refuse(deps, `setup cannot use these answers: ${problems.join('; ')}`);
  if (settings === null || group === 'port') {
    const portProblems = judgePrereqs(await gatherPrereqs(deps, answers.port)).problems.filter(
      (p) => p.check === 'port',
    );
    if (portProblems.length > 0) return refuse(deps, describeProblems(portProblems));
  }
  if (settings === null && !dryRun) answers = await askPasteToken(answers, ask, { interactive });

  // 3. the settings file
  const keptPass = settings?.ok === true ? settings.config.auth?.pass.reveal() : undefined;
  const password =
    group === 'password' || keptPass === undefined ? generatePassword(deps.randomBytes) : keptPass;
  const entries = entriesFor(answers, { paths, password });
  const intended = Object.fromEntries(entries);
  let envText: string | null = null;
  let effective: Readonly<Record<string, string>> = intended;
  if (existingText === null) envText = renderAppEnv([...entries, ...extra]);
  else if (group !== null) {
    const replaced = replaceGroups(existingText, entries, [group]);
    if (replaced !== existingText) envText = replaced;
  } else if (settings?.ok === true) {
    const differs = ownedDiff(settings.record, intended);
    if (differs.length > 0) {
      effective = settings.record;
      notes.push(
        `app.env differs from what setup would write: ${differs.join(', ')}. Setup keeps the file as it is; to change a value, run pnpm gmt setup --reconfigure <group> (for PORT: pnpm gmt setup --reconfigure port).`,
      );
    }
    // why: U8 (sec-b1-002): an operator may bind wider for a tunnel (docs section 3); said plainly, never refused
    if (!isLoopback(settings.config.bindAddress))
      notes.push(
        `app.env binds BIND_ADDRESS=${settings.config.bindAddress}, so the app answers beyond this machine, over plain HTTP; setup keeps it. Use a tunnel or TLS (docs/setup.md section 3), or set it back to 127.0.0.1.`,
      );
  }
  if (envText !== null) {
    const checked = checkAppEnv(envText, { ...intended, ...Object.fromEntries(extra) });
    if (!checked.ok) return refuse(deps, `setup cannot write ${envPath}: ${checked.error}`);
  }
  const port = credsFrom(effective)?.port ?? answers.port;

  // 4. the plan, in phases
  const startJs = join(deps.checkout, 'apps', 'api', 'dist', 'bootstrap', 'start.js');
  const build: Action[] =
    group === null && (settings === null || deps.files.read(startJs) === null)
      ? [
          runAction(['pnpm', 'install', '--frozen-lockfile'], deps.checkout, { env: deps.childEnv }),
          runAction(['pnpm', 'build'], deps.checkout, { env: deps.childEnv }),
        ]
      : [];
  const kind: SetupRecord['import'] = importDocker ? 'docker' : importDbPath !== null ? 'db' : null;
  const startRecord: SetupRecord = {
    linger: answers.linger,
    installed: record.installed,
    import: kind ?? record.import,
    moved: record.moved,
  };
  const prepare: Action[] = [
    ...(group === null ? directoryActions(deps) : []),
    ...(envText === null ? [] : [deps.platform.writeSecretFile(envPath, envText)]),
    ...(group === null ? [recordAction(deps, startRecord)].filter((a) => a !== null) : []),
  ];
  const replacing = moving && kind !== null && deps.files.size(nativeDb) !== null;
  const stopNative =
    replacing && appEntry !== undefined ? deps.platform.serviceManager.stop(appEntry.unit, appFacts) : [];
  const move: Action[] = [
    ...(compose?.appRunning === true ? [dockerStopAction(deps)] : []),
    ...stopNative,
    ...(replacing ? [nativeBackupAction(deps)] : []),
    ...(importDocker ? [dockerBackupAction(deps)] : []),
    ...(importDbPath !== null ? [backupAction(deps, importDbPath, join(paths.data, 'backups'))] : []),
    ...(kind === null && compose !== null ? [dockerMarkerAction(deps)] : []),
  ];
  const place = (file: string): Action[] =>
    importDocker
      ? [
          dockerCopyAction(deps, file),
          ...placeActions(deps, dockerCopiedPath(deps, file)),
          dockerMarkerAction(deps),
        ]
      : [
          ...placeActions(deps, file),
          ...(importDbPath === null ? [] : [markerBesideAction(deps, importDbPath)]),
        ];
  const linger = group === null || group === 'linger' ? await lingerPlan(answers.linger, deps) : [];
  const doneRecord: SetupRecord = { linger: answers.linger, installed: true, import: null, moved: false };
  const restarts = envText !== null && settings !== null;
  const finish: Action[] =
    group === 'linger'
      ? [recordAction(deps, { ...record, linger: answers.linger })].filter((a) => a !== null)
      : [
          ...serviceActions(
            deps,
            // why: the browser worker is installed only by the browser step, once its start check passes
            group === null
              ? entriesSet.filter((e) => e.name !== 'camoufox-worker')
              : entriesSet.filter((e) => e.name === 'app'),
            facts,
            restarts,
          ),
          { kind: 'waitHealthy', url: `http://127.0.0.1:${port}/api/health`, timeoutSeconds: 240 },
          ...(group === null ? [recordAction(deps, doneRecord)].filter((a) => a !== null) : []),
        ];
  const command = group === null ? 'setup' : `setup --reconfigure ${group}`;
  const placeholder = importDocker
    ? `${DOCKER_BACKUP_DIR}/<the file the backup prints>`
    : join(paths.data, 'backups', '<the file the backup prints>');
  const preparePlan: Plan = { command, actions: [...prepare, ...(moving ? [] : build)], notes };
  const finishPlan: Plan = {
    command: moving ? `${command}: start the native app` : `${command}: start`,
    actions: finish,
    notes: [],
  };

  if (dryRun) {
    const phases: Plan[] = [
      ...(moving ? [{ command: `${command}: install and build first`, actions: build, notes: [] }] : []),
      preparePlan,
      ...(moving ? [{ command: `${command}: stop and back up`, actions: move, notes: [] }] : []),
      ...(moving && kind !== null
        ? [
            {
              command: `${command}: put the database in place, then mark the old one`,
              actions: place(placeholder),
              notes: [],
            },
          ]
        : []),
      finishPlan,
    ];
    for (const p of phases) if (p.actions.length > 0 || p.notes.length > 0) deps.io.out(describePlan(p));
    if (group === null) for (const a of linger) deps.io.out(`  then: ${describeAction(a)}\n`);
    const backup = entriesSet.find((e) => e.name === 'backup');
    if (group === null && backup !== undefined && !hasBackup(deps)) {
      const assumed = { onDisk: backup.rendered[0]?.contents ?? '', loaded: true, state: 'stopped' as const };
      for (const a of deps.platform.serviceManager.start(backup.unit, assumed))
        deps.io.out(`  then: ${describeAction(a)} (the first daily backup)\n`);
    }
    return EXIT.ok;
  }
  for (const n of notes) deps.io.out(`note: ${n}\n`);
  const run = (p: Plan) => apply(p, deps.executor);

  // why: WP18 owns the test-email offer (brief WP16b left it): the route exists once the app is up; the default is no.
  // It belongs to a full setup and to `--reconfigure email`, and to no other single-group change (review V9)
  const offerTest = () =>
    offerTestEmail(deps, ask, {
      interactive: interactive && offeredFor(group),
      emailConfigured: answers.email !== null,
      creds: credsFrom(effective),
    });

  // 5. reconfigure: nothing changed, or the guard, then apply
  // why: WP17 Task 17.6: the browser provider's own steps follow the browser group's window question
  const browserPart = async (code: number): Promise<number> => {
    if (group !== 'browser' || code !== EXIT.ok) return code;
    const out = await browserSetup(deps, { interactive, ask, choice: answers.browser, reconfigure: true });
    return out === 'failed' ? EXIT.failed : code;
  };
  if (group !== null) {
    if (group !== 'linger' && envText === null) {
      deps.io.out(`${command}: no change, app.env already has these values; nothing was restarted\n`);
      if (group === 'email') await offerTest();
      return browserPart(EXIT.ok);
    }
    const r = await run({
      command,
      actions: [...prepare, ...(group === 'linger' ? linger : []), ...finish],
      notes: [],
    });
    if (r.failed !== null) return failed(deps, describeResult(command, r));
    const changed = ownedDiff(settings?.ok === true ? settings.record : {}, intended).join(', ');
    deps.io.out(
      group === 'linger'
        ? `${command}: done\n`
        : `${command}: ${changed === '' ? 'app.env' : changed} written; the app restarted\n`,
    );
    if (group === 'travelpayouts' || group === 'searchapi')
      deps.io.out(`${searchSource(answers) ? nextStep(port) : NO_SOURCE_TEXT}\n`);
    if (group === 'email') await offerTest();
    return browserPart(EXIT.ok);
  }

  // 6. setup: apply each phase, with a recovery message for the state each failure leaves
  if (moving) {
    const b = await run({ command: `${command}: install and build first`, actions: build, notes: [] });
    if (b.failed !== null) return failed(deps, `${describeResult(command, b)}Nothing else was changed.`);
    if (importDbPath !== null) {
      // why: U4 (ca-b1-003): the source's lock is read before any other action (it needs the build to read it)
      const lock = await lockFree(deps, importDbPath);
      if (!lock.ok) return refuse(deps, lock.error, EXIT.lockRefused);
    }
  }
  const prep = await run(preparePlan);
  if (prep.failed !== null) return failed(deps, describeResult(command, prep));
  if (moving) {
    if (compose !== null) {
      // why: U1 (cb-b1-004, dev-b1-005): checked again immediately before the Docker app is stopped
      const g = await guardActiveRun(deps, dockerGuardTarget(await composeFacts(deps)), guardFlags);
      if (!g.ok)
        return refuse(
          deps,
          `${g.message}. Nothing was stopped; run setup again with the same flags.`,
          EXIT.lockRefused,
        );
    }
    if (replacing) {
      const g = await guardActiveRun(deps, target, guardFlags);
      if (!g.ok) return refuse(deps, g.message, EXIT.lockRefused);
      deps.io.out(
        `Replacing the native database: ${LEDGER_DROPPED.replace('its ledger', 'the native ledger')}\n`,
      );
    }
    if (kind === null)
      deps.io.out(
        `--ignore-docker: the Docker app is stopped and its volume marked moved; ${LEDGER_DROPPED} To use the Docker app again, remove the marker: ${MARKER_REMOVAL}\n`,
      );
    const m = await run({ command: `${command}: stop and back up`, actions: move, notes: [] });
    const dockerBack =
      compose?.appRunning === true
        ? ' The Docker app is stopped; to go back to it, run docker compose start app.'
        : '';
    if (m.failed !== null)
      return failed(deps, `${describeResult(command, m)}The database was not moved.${dockerBack}`);
    if (kind !== null) {
      const printed = printedBackup(
        m.outputs.at(-1) ?? '',
        importDocker ? DOCKER_BACKUP_DIR : join(paths.data, 'backups'),
      );
      if (!printed.ok) return failed(deps, `${printed.error}; the database was not moved.${dockerBack}`);
      const pl = await run({
        command: `${command}: put the database in place`,
        actions: place(printed.file),
        notes: [],
      });
      if (pl.failed !== null)
        return failed(
          deps,
          `${describeResult(command, pl)}The native database is unchanged and the old one is not marked moved.${dockerBack} Run setup again with the same flags to retry.`,
        );
      // why: cb-b1-010: the first start resumes and catches up what the imported database holds; say so first
      deps.io.out(
        startNote(
          checkedSummary(
            pl.outputs[
              pl.done.findIndex((a) => a.kind === 'run' && a.argv.some((x) => x.endsWith('check-backup.mjs')))
            ] ?? '',
          ),
          'now',
        ),
      );
      if (importDocker) {
        deps.io.out(`The Docker volume is marked moved. Remove its container now: ${DOWN_REASON}.\n`);
        if (
          !interactive ||
          (await ask.confirm(
            'Stop and remove the Docker app’s container now (docker compose down, the volume kept)?',
            true,
          ))
        )
          await run({ command: 'docker compose down', actions: [dockerDownAction(deps)], notes: [] });
      }
    }
    const moved = recordAction(deps, { ...startRecord, moved: true });
    if (moved !== null) await run({ command, actions: [moved], notes: [] });
  }
  const fin = await run(finishPlan);
  if (fin.failed !== null)
    return failed(
      deps,
      `${describeResult(command, fin)}${
        moving
          ? `The database is in place here and the old one is marked moved (the Docker app will not start on it; ${MARKER_REMOVAL} undoes that). See pnpm gmt logs, then run pnpm gmt setup to finish.`
          : 'See pnpm gmt logs, then run pnpm gmt setup again to finish.'
      }`,
    );
  const backup = entriesSet.find((e) => e.name === 'backup');
  const backupOk = backup === undefined ? true : await firstBackup(deps, backup);
  await runLinger(answers.linger, deps);
  // why: WP17 Task 17.6: row 8, once the app is up, so a stop in the browser part leaves the app running and the
  // provider off, which --reconfigure browser resumes
  // why: CodeRabbit (PR #15): a failed browser step can leave the app stopped, so setup never reports success then
  const browser = await browserSetup(deps, { interactive, ask, choice: answers.browser, reconfigure: false });
  if (browser === 'failed')
    return failed(
      deps,
      'the browser provider’s step failed (above); pnpm gmt setup --reconfigure browser repeats it.',
    );
  deps.io.out(closingScreen({ port, answers, appEnv: envPath, backupOk, os }));
  await offerTest();
  if (interactive && (await ask.confirm('Open the app in your browser now?', false))) {
    const opener = os === 'darwin' ? 'open' : 'xdg-open';
    await run({
      command: 'open',
      actions: [runAction([opener, `http://127.0.0.1:${port}`], '/')],
      notes: [],
    });
  }
  return EXIT.ok;
}
