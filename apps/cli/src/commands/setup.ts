import { join, resolve } from 'node:path';
import { activeLine, credsFrom, readActive } from '../appClient.js';
import { type Flags, isReconfigureGroup, type ReconfigureGroup } from '../args.js';
import { noAsk } from '../ask.js';
import { type Deps, EXIT } from '../deps.js';
import { type Action, type Plan, runAction } from '../plan/action.js';
import { apply } from '../plan/apply.js';
import { describeAction, describePlan, describeResult } from '../plan/describe.js';
import { WIN32_REFUSAL } from '../platform/win32.js';
import { factOf, factsOf, type ServiceEntry, serviceSet } from '../services/set.js';
import { appEnvPath, dailyBackupsDir, execPathProblem } from '../services/specs.js';
import {
  type Answers,
  defaultAnswers,
  hasPriceSource,
  loadAnswersFile,
  plainProblems,
  secretProblems,
} from '../setup/answers.js';
import {
  answersFromRecord,
  checkAppEnv,
  entriesFor,
  ownedDiff,
  readEnvText,
  renderAppEnv,
  replaceGroups,
} from '../setup/appEnv.js';
import { closingScreen } from '../setup/closing.js';
import { gatherDocker, judgeDocker } from '../setup/docker.js';
import { lingerPlan, runLinger } from '../setup/linger.js';
import { describeProblems, gatherPrereqs, judgePrereqs, nextFreePort } from '../setup/prereqs.js';
import { askAnswers, askPasteToken, type PromptRow } from '../setup/prompts.js';
import { generatePassword } from '../setup/secrets.js';

/** The rows each `--reconfigure` group asks (brief §6); `password` asks none and generates a new one. */
const GROUP_ROWS: Record<ReconfigureGroup, PromptRow[]> = {
  port: [1],
  timezone: [2],
  travelpayouts: [4],
  searchapi: [5],
  email: [6],
  browser: [9],
  password: [],
};

/** The record setup keeps beside its state: the answers the settings file does not hold (spec §13: linger). */
export const setupRecordPath = (deps: Deps): string => join(deps.platform.paths.state, 'setup.json');
export function readSetupRecord(deps: Deps): { linger: 'skip' | 'enable' } {
  const text = deps.files.read(setupRecordPath(deps));
  try {
    const v: unknown = text === null ? null : JSON.parse(text);
    if (typeof v === 'object' && v !== null && 'linger' in v && v.linger === 'enable')
      return { linger: 'enable' };
  } catch {
    // an unreadable record is read as the default
  }
  return { linger: 'skip' };
}
const setupRecordText = (a: Answers): string => `${JSON.stringify({ linger: a.linger })}\n`;

const refuse = (deps: Deps, message: string): number => {
  deps.io.err(message.endsWith('\n') ? message : `${message}\n`);
  return EXIT.refused;
};

/** The directories a native install needs, each made 0700 (the service directory 0755) only when it is missing. */
function directoryActions(deps: Deps): Action[] {
  const p = deps.platform.paths;
  const dirs: Array<[string, 0o700 | 0o755]> = [
    [p.config, 0o700],
    [p.data, 0o700],
    [join(p.data, 'backups'), 0o700],
    [dailyBackupsDir(p), 0o700],
    [join(p.data, 'backups', 'update'), 0o700],
    [p.state, 0o700],
    [p.serviceDir, 0o755],
  ];
  // why: the macOS log directory goes before the service directory, as the plan lists it
  if (p.logs !== null) dirs.splice(dirs.length - 1, 0, [p.logs, 0o700]);
  return dirs.filter(([d]) => !deps.files.isDir(d)).map(([path, mode]) => ({ kind: 'mkdir', path, mode }));
}

/** Install every service, then start the app when nothing in the install started it (or restart it for new settings). */
function serviceActions(
  deps: Deps,
  entries: readonly ServiceEntry[],
  facts: ReadonlyMap<string, import('../platform/types.js').ServiceFacts>,
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

/** `gmt setup` (spec §13): checks, answers, the settings file, the services, the health wait, the first backup. */
export async function setupCommand(flags: Flags, _positional: string | null, deps: Deps): Promise<number> {
  // why: decision 78: on Windows a dry run states the refusal and succeeds with no plan; a real setup refuses (78)
  if (deps.platform.os === 'win32') {
    deps.io.out(`${WIN32_REFUSAL}\n`);
    return flags['dry-run'] === true ? EXIT.ok : EXIT.refused;
  }
  const os = deps.platform.os;
  const paths = deps.platform.paths;
  const dryRun = flags['dry-run'] === true;
  const force = flags.force === true;
  const group =
    typeof flags.reconfigure === 'string' && isReconfigureGroup(flags.reconfigure) ? flags.reconfigure : null;
  const answersPath =
    typeof flags.answers === 'string' ? resolve(deps.env.INIT_CWD ?? deps.checkout, flags.answers) : null;
  const nonInteractive = flags['non-interactive'] === true;
  const interactive = !nonInteractive && answersPath === null && deps.io.stdinIsTTY;
  const ask = nonInteractive ? noAsk : deps.ask;
  const envPath = appEnvPath(paths);
  const existingText = deps.files.read(envPath);
  const existing = existingText === null ? null : readEnvText(existingText);
  const recorded = readSetupRecord(deps);

  // 1. checks, all before any action
  const nodeProblem = execPathProblem(deps.execPath, os, [deps.tmpDir]);
  if (nodeProblem !== null) return refuse(deps, `setup cannot continue: ${nodeProblem}`);
  if (group !== null && (existing === null || existingText === null))
    return refuse(deps, `there is no ${envPath} to reconfigure: run pnpm gmt setup first`);
  const notes: string[] = [];
  if (group === null) {
    const pre = judgePrereqs(await gatherPrereqs(deps, null));
    const docker = judgeDocker(await gatherDocker(deps), {
      importDocker: flags['import-docker'] === true,
      ignoreDocker: flags['ignore-docker'] === true,
      nativeInstalled: existing !== null,
    });
    const problems = [...pre.problems, ...docker];
    if (problems.length > 0) return refuse(deps, describeProblems(problems));
    notes.push(...pre.notes);
  }

  // 2. answers
  const current = existing === null ? null : answersFromRecord(existing, recorded);
  let answers: Answers;
  if (group !== null && current !== null) {
    if (group === 'browser') {
      const creds = existing === null ? null : credsFrom(existing);
      const active = creds === null ? null : await readActive(deps, creds);
      if (active?.kind === 'active') {
        if (!force)
          return refuse(
            deps,
            `${activeLine(active.execution)}; run this again when it ends, or with --force`,
          );
        deps.io.out(
          `${activeLine(active.execution)}. Restarting the app interrupts ${active.execution.definitionName}: it stops at its last checkpoint and resumes after the restart (when AUTO_RESUME is on), and the new value applies when it resumes.\n`,
        );
      }
    }
    try {
      answers =
        answersPath !== null
          ? await fromFile(answersPath, deps, current)
          : await askAnswers(ask, {
              os,
              defaults: current,
              importedDb: true,
              rows: new Set(GROUP_ROWS[group]),
              io: deps.io,
            });
    } catch (e) {
      return refuse(deps, e instanceof Error ? e.message : String(e));
    }
  } else if (current !== null && answersPath === null) {
    answers = current;
  } else {
    const port = (await deps.portFree(3000)) ? 3000 : ((await nextFreePort(3000, deps.portFree)) ?? 3000);
    const defaults = current ?? defaultAnswers({ port, timezone: deps.machineTimeZone });
    try {
      answers =
        answersPath !== null
          ? await fromFile(answersPath, deps, defaults)
          : await askAnswers(ask, { os, defaults, importedDb: false, rows: null, io: deps.io });
    } catch (e) {
      return refuse(deps, e instanceof Error ? e.message : String(e));
    }
  }
  const problems = [...secretProblems(answers), ...plainProblems(answers)];
  if (problems.length > 0) return refuse(deps, `setup cannot use these answers: ${problems.join('; ')}`);
  if (existing === null || group === 'port') {
    const pre = judgePrereqs(await gatherPrereqs(deps, answers.port));
    const portProblems = pre.problems.filter((p) => p.check === 'port');
    if (portProblems.length > 0) return refuse(deps, describeProblems(portProblems));
  }
  if (existing === null && !dryRun) answers = await askPasteToken(answers, ask, { interactive });

  // 3. the settings file
  const password =
    group === 'password' || existing?.APP_BASIC_AUTH_PASS === undefined
      ? generatePassword(deps.randomBytes)
      : existing.APP_BASIC_AUTH_PASS;
  const entries = entriesFor(answers, { paths, password });
  const intended = Object.fromEntries(entries);
  let envText: string | null = null;
  let effective = intended;
  if (existingText === null) envText = renderAppEnv(entries);
  else if (group !== null) {
    const replaced = replaceGroups(existingText, entries, [group]);
    if (replaced !== existingText) envText = replaced;
  } else {
    const differs = ownedDiff(existing ?? {}, intended);
    if (differs.length > 0) {
      effective = existing ?? intended;
      notes.push(
        `app.env differs from what setup would write: ${differs.join(', ')}. Setup keeps the file as it is; to change a value, run pnpm gmt setup --reconfigure <group> (for PORT: pnpm gmt setup --reconfigure port).`,
      );
    }
  }
  if (envText !== null) {
    const checked = checkAppEnv(envText, intended);
    if (!checked.ok) return refuse(deps, `setup cannot write ${envPath}: ${checked.error}`);
  }
  const port = credsFrom(effective)?.port ?? answers.port;

  // 4. the plan
  const entriesSet = serviceSet(deps);
  const facts = await factsOf(deps, entriesSet);
  const startJs = join(deps.checkout, 'apps', 'api', 'dist', 'bootstrap', 'start.js');
  const build = existing === null || deps.files.read(startJs) === null;
  const record = setupRecordText(answers);
  const actions: Action[] = [
    ...(group === null ? directoryActions(deps) : []),
    ...(envText === null ? [] : [deps.platform.writeSecretFile(envPath, envText)]),
    ...(group === null && deps.files.read(setupRecordPath(deps)) !== record
      ? [
          {
            kind: 'writeFile' as const,
            path: setupRecordPath(deps),
            contents: record,
            mode: 0o644 as const,
            secret: false,
          },
        ]
      : []),
    ...(build
      ? [
          runAction(['pnpm', 'install', '--frozen-lockfile'], deps.checkout),
          runAction(['pnpm', 'build'], deps.checkout),
        ]
      : []),
    ...serviceActions(
      deps,
      group === null ? entriesSet : entriesSet.filter((e) => e.name === 'app'),
      facts,
      envText !== null && existing !== null,
    ),
    { kind: 'waitHealthy', url: `http://127.0.0.1:${port}/api/health`, timeoutSeconds: 240 },
  ];
  const plan: Plan = { command: group === null ? 'setup' : `setup --reconfigure ${group}`, actions, notes };
  const backup = entriesSet.find((e) => e.name === 'backup');

  if (dryRun) {
    deps.io.out(describePlan(plan));
    if (group === null && backup !== undefined && !hasBackup(deps)) {
      const assumed = { onDisk: backup.rendered[0]?.contents ?? '', loaded: true, state: 'stopped' as const };
      for (const a of deps.platform.serviceManager.start(backup.unit, assumed))
        deps.io.out(`  then: ${describeAction(a)} (the first daily backup)\n`);
    }
    if (group === null)
      for (const a of await lingerPlan(answers.linger, deps)) deps.io.out(`  then: ${describeAction(a)}\n`);
    return EXIT.ok;
  }
  for (const n of notes) deps.io.out(`note: ${n}\n`);

  // 5. apply, then the steps whose failure does not stop setup
  const result = await apply(plan, deps.executor);
  if (result.failed !== null) {
    deps.io.err(describeResult(plan.command, result));
    return EXIT.failed;
  }
  if (group !== null) {
    deps.io.out(`${plan.command}: done; the app restarted with the new settings\n`);
    return EXIT.ok;
  }
  const backupOk = backup === undefined ? true : await firstBackup(deps, backup);
  await runLinger(answers.linger, deps);
  deps.io.out(closingScreen({ port, priceSource: hasPriceSource(answers), appEnv: envPath, backupOk }));
  if (interactive && (await ask.confirm('Open the app in your browser now?', false))) {
    const opener = os === 'darwin' ? 'open' : 'xdg-open';
    await apply(
      { command: 'open', actions: [runAction([opener, `http://127.0.0.1:${port}`], '/')], notes: [] },
      deps.executor,
    );
  }
  return EXIT.ok;
}

/** Answers from a file over the current values; a refusal is thrown with its message (fields only, never values). */
async function fromFile(path: string, deps: Deps, defaults: Answers): Promise<Answers> {
  const r = await loadAnswersFile(path, deps, { importedDb: false, defaults });
  if (!r.ok) throw new Error(r.error);
  return r.answers;
}
