/**
 * The Status report's check builders (spec §10 `GET /status`, brief WP18 §6): pure functions from `StatusFacts` to the
 * checks. Every summary and note is a fixed template filled from typed fields and enums, never from vendor, worker,
 * ledger, file or SMTP text. No template uses "fresh", "complete", "all" or a banned word (tested over every template).
 */
import {
  ageEndsLine,
  apiContract,
  backupState,
  CAP_WARN_SHARE,
  capPercent,
  capWarn,
  consentWindowState,
  coverageGapWarn,
  coverageLine,
  formatAgeShort,
  formatDateIn,
  formatDuration,
  formatInstantIn,
  formatTimeIn,
  hoursSince,
  type IsoDateTime,
  isoDateTimeOfEpochMs,
  SKIP_CODE_TEXT,
  START_REFUSAL_TEXT,
  TRIAL_WARN_CREDITS,
} from '@gmt/core';
import type { DataFacts, ProviderFacts, StatusFacts, WorkerFacts } from './statusFacts.js';

export type StatusCheck = apiContract.StatusCheck;
export type StatusResponse = apiContract.StatusResponse;

/** The fixed words of the report; one table so the banned-word test reads them all. */
export const STATUS_TEXT = {
  docs: 'docs/setup.md section 11',
  browserWindow: {
    scheduled: "browser pages: only inside a run's window",
    any: 'browser pages: also when a run resumes',
  },
  browserOnlyFix:
    'a catch-up loads no browser pages: keep the machine awake at the scheduled time, or move the schedule',
} as const;

/** Clamps a template's result to a schema bound (the templates are short; this is a backstop, not a truncation policy). */
function fit(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

interface CheckInput {
  id: string;
  area: StatusCheck['area'];
  state: StatusCheck['state'];
  summary: string;
  providerId?: StatusCheck['providerId'];
  note?: string | null;
  offReason?: StatusCheck['offReason'];
  fix?: StatusCheck['fix'];
}
function check(i: CheckInput): StatusCheck {
  return {
    id: i.id,
    area: i.area,
    providerId: i.providerId ?? null,
    state: i.state,
    summary: fit(i.summary, 240),
    note: i.note === undefined || i.note === null ? null : fit(i.note, 200),
    offReason: i.state === 'off' ? (i.offReason ?? 'not-set-up') : null,
    fix: i.fix ?? null,
  };
}

type Cmd = `pnpm gmt ${string}`;
/** A fix: a `pnpm gmt` command in native mode; in container and dev mode no command, and the docs section named. */
function fixer(f: Pick<StatusFacts, 'mode'>) {
  return (text: string, command: Cmd | null = null): StatusCheck['fix'] =>
    f.mode === 'native'
      ? { text: fit(text, 200), command }
      : { text: fit(`${text}: see ${STATUS_TEXT.docs}`, 200), command: null };
}

/** What the time and mode words of a check need of the facts. */
export type Frame = Pick<StatusFacts, 'now' | 'tz' | 'mode'>;
const at = (f: Frame, iso: IsoDateTime) => formatInstantIn(iso, f.tz);
const day = (f: Frame, iso: IsoDateTime) => formatDateIn(iso, f.tz);

function appCheck(f: StatusFacts): StatusCheck {
  const fix = fixer(f);
  const up = hoursSince(f.app.startedAt, f.now);
  const uptime = up < 1 ? 'less than an hour' : formatDuration(up);
  if (!f.app.authOn && f.mode !== 'dev')
    return check({
      id: 'app',
      area: 'app',
      state: 'fail',
      summary: 'sign-in is off outside development, so anyone who reaches the app can use it',
      fix: fix('replace the password so sign-in is on', 'pnpm gmt setup --reconfigure password'),
    });
  const base = `version ${f.version}, up ${uptime}, ${f.mode} mode`;
  if (!f.app.loopback)
    return check({
      id: 'app',
      area: 'app',
      state: 'warn',
      summary: `${base}; bound beyond loopback: plain HTTP beyond this machine needs TLS or Tailscale: docs/setup.md section 3`,
      fix: fix('bind to 127.0.0.1 or put TLS or Tailscale in front of it'),
    });
  return check({
    id: 'app',
    area: 'app',
    state: 'ok',
    summary: `${base}, ${f.app.authOn ? 'loopback only, sign-in on' : 'loopback only, sign-in off for development'}`,
  });
}

function databaseCheck(f: StatusFacts): StatusCheck {
  const fix = fixer(f);
  const d = f.database;
  if (!d.answers)
    return check({
      id: 'database',
      area: 'database',
      state: 'fail',
      summary: 'the database does not answer',
      fix: fix('restart the app; if it still fails, restore a backup', 'pnpm gmt restart'),
    });
  if (d.pendingMigrations > 0)
    return check({
      id: 'database',
      area: 'database',
      state: 'warn',
      summary: `${d.pendingMigrations} ${d.pendingMigrations === 1 ? 'migration is' : 'migrations are'} pending`,
      fix: fix('restart the app so it migrates after a backup', 'pnpm gmt restart'),
    });
  return check({
    id: 'database',
    area: 'database',
    state: 'ok',
    summary: `answers; ${(d.sizeBytes / 1_048_576).toFixed(1)} MB`,
  });
}

function backupsCheck(f: StatusFacts): StatusCheck {
  const fix = fixer(f);
  if (f.mode === 'container')
    return check({
      id: 'backups',
      area: 'backups',
      state: 'off',
      offReason: 'not-visible',
      summary: "not visible from the container: check your host's backup job (docs/setup.md section 6)",
    });
  const r = backupState({ newestAt: f.backupNewestAt, appStartedAt: f.app.startedAt, now: f.now });
  if (r.state === 'ok')
    return check({
      id: 'backups',
      area: 'backups',
      state: 'ok',
      summary:
        f.backupNewestAt === null
          ? 'no daily backup yet; the app started recently'
          : `newest daily backup ${at(f, f.backupNewestAt)}`,
      note: r.first ? 'first daily backup due 03:30; pnpm gmt backup takes one now' : null,
    });
  if (r.state === 'warn')
    return check({
      id: 'backups',
      area: 'backups',
      state: 'warn',
      summary: `the newest daily backup, ${at(f, f.backupNewestAt ?? f.now)}, is older than 36 hours`,
      fix: fix('take a backup now and check the daily job', 'pnpm gmt backup'),
    });
  return check({
    id: 'backups',
    area: 'backups',
    state: 'fail',
    summary: 'no daily backup found, and the app has run for more than 36 hours',
    fix: fix('take a backup now and check the daily job', 'pnpm gmt backup'),
  });
}

function scheduleCheck(f: StatusFacts): StatusCheck {
  const fix = fixer(f);
  const s = f.schedule;
  const notes: string[] = [];
  if (s.catchUp !== null)
    notes.push(`caught up the run missed at ${at(f, s.catchUp.scheduledFor)}, ran ${at(f, s.catchUp.ranAt)}`);
  if (s.skippedMissed !== null)
    notes.push(
      `the firing at ${at(f, s.skippedMissed.scheduledFor)} was not caught up: ${SKIP_CODE_TEXT[s.skippedMissed.code]}`,
    );
  const note = notes.length === 0 ? null : notes.join('; ');
  if (s.scheduledDefinitions === 0)
    return check({
      id: 'schedule',
      area: 'schedule',
      state: 'off',
      offReason: 'not-set-up',
      summary: 'no search has a schedule',
      note,
    });
  if (s.blockedSince !== null || s.degraded)
    return check({
      id: 'schedule',
      area: 'schedule',
      state: 'fail',
      summary:
        s.blockedSince !== null
          ? `schedule blocked since ${day(f, s.blockedSince)}`
          : 'the scheduler is degraded: a job is missing or a run is stuck',
      note,
      fix: fix('restart the app', 'pnpm gmt restart'),
    });
  const clash = s.clashes[0];
  if (clash !== undefined)
    return check({
      id: 'schedule',
      area: 'schedule',
      state: 'warn',
      summary: `${clash.a} and ${clash.b} both fire at ${formatTimeIn(clash.at, f.tz)}; stagger them so neither waits for the other's browser pages`,
      note,
      fix: fix('change one of the two schedules'),
    });
  return check({
    id: 'schedule',
    area: 'schedule',
    state: 'ok',
    summary: `${s.jobCount} ${s.jobCount === 1 ? 'job' : 'jobs'} registered; last run ${s.lastExecutionAt === null ? 'none yet' : at(f, s.lastExecutionAt)}; next run ${s.nextRun === null ? 'none' : at(f, s.nextRun)}`,
    note,
  });
}

const SKIPPED_REASON: Readonly<Record<string, string>> = {
  skipped_budget: 'it would exceed a budget cap',
  skipped_confirm: 'its cost estimate needs your confirmation',
  skipped_window: 'its window has no departure dates left',
  skipped_missed: 'it was missed and not caught up',
};
const RUN_WORD: Readonly<Record<string, string>> = {
  cancelled: ' (cancelled)',
  interrupted: ' (interrupted)',
  paused_budget: ' (paused at a budget cap)',
  paused_error: ' (paused after errors)',
};

function dataCheck(f: StatusFacts, d: DataFacts): StatusCheck {
  const fix = fixer(f);
  const id = `data-${d.definitionId}`;
  const running = d.runningSince === null ? '' : `running since ${at(f, d.runningSince)}; `;
  const left = d.leftNotes
    .map((n) => `${n.text} (${n.cells} ${n.cells === 1 ? 'cell' : 'cells'})`)
    .join('; ');
  const note = left === '' ? null : left;
  const l = d.latest;
  if (l === null)
    return d.runningSince === null
      ? check({
          id,
          area: 'data',
          state: 'warn',
          summary: `${d.name}: no prices yet, this search has not finished a run`,
          fix: fix('start a run from the Definitions view'),
        })
      : check({
          id,
          area: 'data',
          state: 'ok',
          summary: `${d.name}: ${running}no finished run yet`,
        });
  if (l.status.startsWith('skipped_')) {
    const reason =
      l.status === 'skipped_missed' && l.skipCode !== null
        ? SKIP_CODE_TEXT[l.skipCode]
        : (SKIPPED_REASON[l.status] ?? 'it did not run');
    const browserOnly = l.skipCode === 'browser-only-definition';
    return check({
      id,
      area: 'data',
      state: 'warn',
      summary: `${d.name}: ${running}last firing skipped (${reason}) on ${day(f, l.at)}`,
      note,
      fix: fix(
        browserOnly
          ? STATUS_TEXT.browserOnlyFix
          : 'the next scheduled run goes ahead as normal; start one now for newer prices',
      ),
    });
  }
  const parts: string[] = [];
  const cov = d.coverage;
  parts.push(
    cov === null
      ? `last run ${day(f, l.at)}${RUN_WORD[l.status] ?? ''}: no cells recorded`
      : `last run ${day(f, l.at)}${RUN_WORD[l.status] ?? ''}: ${coverageLine(cov.buckets, cov.total)}`,
  );
  parts.push(
    d.ages === null
      ? 'no prices yet'
      : ageEndsLine(formatAgeShort(d.ages.newest), formatAgeShort(d.ages.oldest)),
  );
  const summary = `${d.name}: ${running}${parts.join('; ')}`;
  const gap = cov !== null && coverageGapWarn(cov.buckets, cov.total);
  const browserOnlyCatchUp = d.browserOnlyScheduled && l.isCatchUp;
  const problem = browserOnlyCatchUp
    ? fix(STATUS_TEXT.browserOnlyFix)
    : gap
      ? fix('Coverage shows which cells were left; run again or widen the sources')
      : d.ages?.stale === true
        ? fix('start a run for newer prices')
        : d.ages === null
          ? fix('start a run, or check that a price source is set up')
          : d.behindSchedule
            ? fix('the last run is older than the schedule: check the schedule card')
            : null;
  return check({ id, area: 'data', state: problem === null ? 'ok' : 'warn', summary, note, fix: problem });
}

function dataChecks(f: StatusFacts): StatusCheck[] {
  if (f.data.length === 0)
    return [
      check({
        id: 'data',
        area: 'data',
        state: 'off',
        offReason: 'not-set-up',
        summary: 'no search definition yet',
      }),
    ];
  return f.data.map((d) => dataCheck(f, d));
}

function priceSourcesCheck(f: StatusFacts): StatusCheck {
  const fix = fixer(f);
  const names = f.priceSources.usable;
  return names.length > 0
    ? check({
        id: 'price-sources',
        area: 'provider',
        state: 'ok',
        summary: `price sources: ${names.join(' and ')}`,
      })
    : check({
        id: 'price-sources',
        area: 'provider',
        state: 'warn',
        summary: 'No price source is set up, so searches find nothing',
        fix: fix(
          'Travelpayouts is the no-cost source: add its token',
          'pnpm gmt setup --reconfigure travelpayouts',
        ),
      });
}

const RECONFIGURE: Readonly<Record<string, Cmd>> = {
  travelpayouts: 'pnpm gmt setup --reconfigure travelpayouts',
  searchapi: 'pnpm gmt setup --reconfigure searchapi',
};

/** The Providers view's usage wording ("this month: 2 of 50000 calls", "7 of 24 calls over the plan's lifetime"). */
function usageWords(u: NonNullable<ProviderFacts['usage']>): string {
  if (u.cap === null)
    return u.window === 'month' ? `this month: ${u.used} calls, no cap` : `${u.used} calls so far, no cap`;
  const calls = u.cap === 1 ? 'call' : 'calls';
  return u.window === 'month'
    ? `this month: ${u.used} of ${u.cap} ${calls}`
    : `${u.used} of ${u.cap} ${calls} over the plan's lifetime`;
}

function providerCheck(f: StatusFacts, p: ProviderFacts): StatusCheck {
  const fix = fixer(f);
  const id = `provider-${p.id}`;
  const base = { id, area: 'provider', providerId: p.id } as const;
  if (!p.configured)
    return check({
      ...base,
      state: 'off',
      offReason: 'not-set-up',
      summary: `${p.displayName} is not set up`,
      fix: fix(`add ${p.displayName}`, RECONFIGURE[p.id] ?? null),
    });
  const usage = p.usage === null ? '' : `; ${usageWords(p.usage)}`;
  const last = p.lastCall;
  if (last !== null && last.result === 'auth')
    return check({
      ...base,
      state: 'fail',
      summary: `${p.displayName}: the last call was refused, the key is not accepted (${at(f, last.at)})`,
      fix: fix(`replace the ${p.displayName} key`, RECONFIGURE[p.id] ?? null),
    });
  if (last !== null && last.result === 'quota')
    return check({
      ...base,
      state: 'fail',
      summary: `${p.displayName}: the last call was refused, the plan's quota is used up (${at(f, last.at)})`,
      fix: fix("wait for the plan's window to reopen, or change the plan"),
    });
  const near = p.usage !== null && capWarn(p.usage.used, p.usage.cap);
  const trial = p.trialLeft !== null && p.trialLeft <= TRIAL_WARN_CREDITS;
  const failedOther = last !== null && last.result === 'other';
  if (near || trial || failedOther) {
    const why = trial
      ? `${p.trialLeft} trial ${p.trialLeft === 1 ? 'credit' : 'credits'} left`
      : failedOther
        ? `the last call failed (${at(f, last.at)})`
        : `${capPercent(p.usage?.used ?? 0, p.usage?.cap ?? null)}% of its cap used`;
    return check({
      ...base,
      state: 'warn',
      summary: `${p.displayName}: ${why}${usage}`,
      fix: fix(
        failedOther
          ? 'check the Providers view and the app log'
          : 'watch the Providers view; raise the plan or wait for the window to reopen',
      ),
    });
  }
  return check({
    ...base,
    state: 'ok',
    summary: `${p.displayName}: ${last === null ? 'configured; not used yet' : `last successful call ${at(f, last.at)}`}${usage}`,
  });
}

function syntheticCheck(f: StatusFacts): StatusCheck {
  return check({
    fix: fixer(f)('development only: unset ALLOW_FIXTURE_PROVIDER to remove it'),
    id: 'provider-fixture',
    area: 'provider',
    providerId: 'fixture',
    state: 'warn',
    summary: 'synthetic test data, not fares',
  });
}

/** The recorded date of a not-shown record: its expiry is the check plus 13 months (spec §2). */
function minus13Months(iso: IsoDateTime): IsoDateTime {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() - 13);
  return isoDateTimeOfEpochMs(d.getTime());
}
function plus13Months(iso: IsoDateTime): IsoDateTime {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + 13);
  return isoDateTimeOfEpochMs(d.getTime());
}

export function consentCheckOf(f: Frame, w: WorkerFacts): StatusCheck {
  const fix = fixer(f);
  const consentFix = fix('capture consent again', 'pnpm gmt consent');
  const base = { id: 'consent', area: 'consent' } as const;
  const cannot = check({
    ...base,
    state: 'warn',
    summary: 'cannot check: the worker is not answering',
    fix: fix('start the worker', 'pnpm gmt start'),
  });
  const r = w.read;
  if (r.kind === 'disabled')
    return check({ ...base, state: 'off', offReason: 'not-set-up', summary: 'browser provider not enabled' });
  if (r.kind !== 'ok') {
    const ref = w.refusal;
    if (f.mode === 'native' && ref.kind === 'refusal') {
      if (ref.reason === 'flags-unset' || ref.reason === 'build-mismatch')
        return check({
          ...base,
          state: 'off',
          offReason: 'awaiting-verification',
          summary: 'awaiting verification for this build: consent is not checked yet',
        });
      if (ref.reason.startsWith('consent-'))
        return check({
          ...base,
          state: 'fail',
          summary: START_REFUSAL_TEXT[ref.reason].summary,
          fix: consentFix,
        });
    }
    return cannot;
  }
  const s = r.status;
  if (!s.formVerified)
    return check({
      ...base,
      state: 'off',
      offReason: 'awaiting-verification',
      summary: 'awaiting verification for this build: consent is not checked yet',
    });
  // why: a worker older than WP17 reports only when the SOCS record was captured; its expiry is that plus 13 months
  const c =
    s.consent ??
    (s.socsCapturedAt === null
      ? null
      : { kind: 'socs' as const, expiresAt: plus13Months(s.socsCapturedAt), boundedBy: 'capture' as const });
  if (c === null)
    return check({
      ...base,
      state: 'fail',
      summary: START_REFUSAL_TEXT['consent-missing'].summary,
      fix: consentFix,
    });
  if (c.kind === 'voided' || c.expiresAt === null)
    return check({
      ...base,
      state: 'fail',
      summary: START_REFUSAL_TEXT['consent-voided'].summary,
      fix: consentFix,
    });
  const state = consentWindowState(c.expiresAt, f.now);
  const words =
    c.kind === 'not-shown'
      ? `no consent screen in this region, recorded ${day(f, minus13Months(c.expiresAt))}`
      : `consent rejected, expires ${day(f, c.expiresAt)} (${c.boundedBy === 'cookie' ? 'cookie' : 'capture'})`;
  if (state === 'ok') return check({ ...base, state: 'ok', summary: words });
  return check({
    ...base,
    state,
    summary: state === 'fail' ? `consent expired on ${day(f, c.expiresAt)}` : `${words}; under 30 days left`,
    fix: consentFix,
  });
}

function workerCheckOf(f: StatusFacts, w: WorkerFacts): StatusCheck {
  const fix = fixer(f);
  const base = { id: 'worker', area: 'worker', providerId: 'camoufox' } as const;
  const r = w.read;
  if (r.kind === 'disabled')
    return check({ ...base, state: 'off', offReason: 'not-set-up', summary: 'browser provider not enabled' });
  const note: string = STATUS_TEXT.browserWindow[w.browserWindow];
  if (r.kind === 'keys-differ')
    return check({
      ...base,
      state: 'fail',
      summary: 'keys differ: the worker refused the key this app holds',
      note,
      fix: fix('set the browser provider up again', 'pnpm gmt setup --reconfigure browser'),
    });
  if (r.kind === 'unreadable')
    return check({
      ...base,
      state: 'warn',
      summary: 'the worker answered in a form this version cannot read',
      note,
      fix: fix('update the app and the worker together', 'pnpm gmt update'),
    });
  if (r.kind === 'unreachable') {
    if (f.mode === 'container')
      return check({
        ...base,
        state: 'fail',
        summary: 'not reachable from the container',
        note,
        fix: fix('start the worker on the host'),
      });
    const ref = w.refusal;
    if (ref.kind === 'refusal') {
      const t = START_REFUSAL_TEXT[ref.reason];
      if (ref.reason === 'flags-unset' || ref.reason === 'build-mismatch')
        return check({
          ...base,
          state: 'off',
          offReason: 'awaiting-verification',
          summary: `awaiting verification for this build: ${t.summary}`,
          note,
        });
      return check({
        ...base,
        state: 'fail',
        summary: `refused, not retrying: ${t.summary}`,
        note,
        fix: fix(t.summary, t.fixCommand),
      });
    }
    return check({
      ...base,
      state: 'fail',
      summary:
        ref.kind === 'unreadable' ? 'not answering, and its refusal file is unreadable' : 'not answering',
      note,
      fix: fix('start the worker', 'pnpm gmt start'),
    });
  }
  const s = r.status;
  if (!s.formVerified)
    return check({
      ...base,
      state: 'off',
      offReason: 'awaiting-verification',
      summary: 'awaiting verification for this build: browser flags are unset',
      note,
    });
  if (s.diffs.length > 0)
    return check({
      ...base,
      state: 'fail',
      summary: `settings differ between the app and the worker: ${s.diffs.join(', ')}`,
      note,
      fix: fix('set both to the same values', 'pnpm gmt setup --reconfigure browser'),
    });
  const monthly =
    s.monthly === null || !s.monthly.readable
      ? ''
      : `; this month: pages ${s.monthly.pages} of ${w.caps.pages}, scrolls ${s.monthly.scrolls} of ${w.caps.scrolls}`;
  if (s.coolingDownUntil !== null)
    return check({
      ...base,
      state: 'warn',
      summary: `cooling down until ${at(f, s.coolingDownUntil)}${s.cooldownCause === null ? '' : ` (${s.cooldownCause})`}${monthly}`,
      note,
      fix: fix('no action: the app tries again after the cool-down'),
    });
  if (s.appInstances !== null && s.appInstances >= 2)
    return check({
      ...base,
      state: 'warn',
      summary: `${s.appInstances} app instances called the worker this month, so its counts and the app's differ${monthly}`,
      note,
      fix: fix('run one app against one worker'),
    });
  if (s.monthly !== null && !s.monthly.readable)
    return check({
      ...base,
      state: 'warn',
      summary: "the worker's monthly counts cannot be read",
      note,
      fix: fix('restart the worker', 'pnpm gmt restart'),
    });
  const share = CAP_WARN_SHARE;
  if (
    s.monthly !== null &&
    (s.monthly.pages >= w.caps.pages * share || s.monthly.scrolls >= w.caps.scrolls * share) &&
    (w.caps.pages > 0 || w.caps.scrolls > 0)
  )
    return check({
      ...base,
      state: 'warn',
      summary: `reachable; a monthly cap is near${monthly}`,
      note,
      fix: fix('no action: the cap stops the worker; it resets next month'),
    });
  const superseded =
    w.refusal.kind === 'refusal' && s.socsCapturedAt !== null && w.refusal.at < s.socsCapturedAt;
  return check({
    ...base,
    state: 'ok',
    summary: `reachable${monthly}`,
    note: superseded ? `${note}; an earlier refusal was superseded by a newer consent record` : note,
  });
}

function emailCheck(f: StatusFacts): StatusCheck {
  const fix = fixer(f);
  const e = f.email;
  if (!e.configured)
    return check({
      id: 'email',
      area: 'email',
      state: 'off',
      offReason: 'not-set-up',
      summary: 'email is not set up',
      fix: fix('set email up to get alerts and notices', 'pnpm gmt setup --reconfigure email'),
    });
  if (e.last?.result === 'failed')
    return check({
      id: 'email',
      area: 'email',
      state: 'fail',
      summary: `the last test send failed (${at(f, e.last.at)}), since the app started`,
      fix: fix('check the SMTP settings and send a test again', 'pnpm gmt setup --reconfigure email'),
    });
  const last =
    e.last === null
      ? 'no test send since the app started'
      : `the last test send was ${e.last.result === 'sent' ? 'sent' : 'refused at the hourly limit'} at ${at(f, e.last.at)}, since the app started`;
  return check({ id: 'email', area: 'email', state: 'ok', summary: `configured; ${last}` });
}

/** Every check of brief WP18 §6 for these facts, worst first (core's `sortChecks`). */
export function buildChecks(f: StatusFacts): StatusCheck[] {
  const checks: StatusCheck[] = [
    appCheck(f),
    databaseCheck(f),
    backupsCheck(f),
    scheduleCheck(f),
    ...dataChecks(f),
    priceSourcesCheck(f),
    ...f.providers.map((p) => providerCheck(f, p)),
    ...(f.synthetic ? [syntheticCheck(f)] : []),
    workerCheckOf(f, f.worker),
    consentCheckOf(f, f.worker),
    emailCheck(f),
  ];
  return apiContract.sortChecks(checks);
}

export function buildStatus(f: StatusFacts): StatusResponse {
  return { generatedAt: f.now, mode: f.mode, version: f.version, checks: buildChecks(f) };
}
