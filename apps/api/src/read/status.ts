/**
 * The Status report's check builders (spec §10 `GET /status`, brief WP18 §6): pure functions from `StatusFacts` to the
 * checks. Every summary and note is a fixed template filled from typed fields and enums, never from vendor, worker,
 * ledger, file or SMTP text; none is cut short, because a fact a state rests on must never be truncated away (review
 * V6). No template uses "fresh", "complete", "all" or a banned word (tested over every template).
 */
import {
  ageEndsLine,
  apiContract,
  BACKUP_MAX_AGE_MS,
  backupState,
  CAP_WARN_SHARE,
  capPercent,
  capWarn,
  consentBoundOf,
  consentFixText,
  consentMadeAt,
  consentWindowState,
  coverageGapWarn,
  coverageLine,
  formatAgeShort,
  formatDuration,
  formatInstant,
  hoursSince,
  type IsoDateTime,
  PROVIDER_NAMES,
  SKIP_CODE_TEXT,
  START_REFUSAL_TEXT,
  TRIAL_WARN_CREDITS,
} from '@gmt/core';
import { BLOCKED_WORDS, GRID_NOT_VERIFIED, SIGNED_IN_REFUSED } from '@gmt/providers';
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

interface CheckInput {
  id: string;
  area: StatusCheck['area'];
  state: StatusCheck['state'];
  summary: string;
  providerId?: StatusCheck['providerId'];
  label?: string | null;
  note?: string | null;
  offReason?: StatusCheck['offReason'];
  fix?: StatusCheck['fix'];
}
function check(i: CheckInput): StatusCheck {
  return {
    id: i.id,
    area: i.area,
    providerId: i.providerId ?? null,
    label: i.label ?? null,
    state: i.state,
    summary: i.summary,
    note: i.note ?? null,
    offReason: i.state === 'off' ? (i.offReason ?? 'not-set-up') : null,
    fix: i.fix ?? null,
  };
}

type Cmd = `pnpm gmt ${string}`;
/** A fix: a `pnpm gmt` command in native mode; in container and dev mode no command, and the docs section named. */
/**
 * A refusal's own fix (core's START_REFUSAL_TEXT, a command that exists): a `pnpm gmt` one is the card's command; any
 * other (the worker's own scripts, such as clear-signed-in) goes into the text, since a card's command is `gmt`'s.
 */
const refusalFix = (
  fix: ReturnType<typeof fixer>,
  summary: string,
  command: `pnpm ${string}` | null,
): StatusCheck['fix'] =>
  command === null
    ? fix(summary)
    : isGmt(command)
      ? fix(summary, command)
      : fix(`${summary}: run ${command}`);
const isGmt = (c: string): c is Cmd => c.startsWith('pnpm gmt ');

function fixer(f: Pick<StatusFacts, 'mode'>) {
  return (text: string, command: Cmd | null = null): StatusCheck['fix'] =>
    f.mode === 'native' ? { text, command } : { text: `${text}: see ${STATUS_TEXT.docs}`, command: null };
}

/** What the time and mode words of a check need of the facts. */
export type Frame = Pick<StatusFacts, 'now' | 'tz' | 'mode'>;
const at = (f: Frame, iso: IsoDateTime) => formatInstant(iso, f.tz);

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
  const hours = BACKUP_MAX_AGE_MS / 3_600_000;
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
      summary: `the newest daily backup, ${at(f, f.backupNewestAt ?? f.now)}, is older than ${hours} hours`,
      fix: fix('take a backup now and check the daily job', 'pnpm gmt backup'),
    });
  return check({
    id: 'backups',
    area: 'backups',
    state: 'fail',
    summary: `no daily backup found, and the app has run for more than ${hours} hours`,
    fix: fix('take a backup now and check the daily job', 'pnpm gmt backup'),
  });
}

/** The words of a run that did not simply finish. */
const RUN_WORD: Readonly<Record<string, string>> = {
  cancelled: 'cancelled',
  interrupted: 'interrupted',
  paused_budget: 'paused at a budget cap',
  paused_error: 'paused after errors',
};

function scheduleCheck(f: StatusFacts): StatusCheck {
  const fix = fixer(f);
  const s = f.schedule;
  const notes: string[] = [];
  if (s.catchUp !== null) {
    const c = s.catchUp;
    const missed = c.scheduledFor === null ? 'a missed run' : `the run missed at ${at(f, c.scheduledFor)}`;
    notes.push(
      c.status === 'completed'
        ? `caught up ${missed}, ran ${at(f, c.ranAt)}`
        : `a catch-up of ${missed} started ${at(f, c.ranAt)} and is ${RUN_WORD[c.status] ?? c.status}`,
    );
  }
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
          ? `schedule blocked since ${at(f, s.blockedSince)}`
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
      summary: `${clash.a} and ${clash.b} both fire at ${at(f, clash.at)}; stagger them so neither waits for the other's browser pages`,
      note,
      fix: fix('change one of the two schedules'),
    });
  return check({
    id: 'schedule',
    area: 'schedule',
    state: 'ok',
    summary: `${s.jobCount} ${s.jobCount === 1 ? 'job' : 'jobs'} registered; last firing ${s.lastExecutionAt === null ? 'none yet' : at(f, s.lastExecutionAt)}; next firing ${s.nextRun === null ? 'none' : at(f, s.nextRun)}`,
    note,
  });
}

/** Why a skipped firing was skipped, and what the operator does about it (the engine's own next steps, V6). */
const SKIPPED: Readonly<Record<string, { reason: string; fix: string }>> = {
  skipped_budget: {
    reason: 'it would exceed a budget cap',
    fix: 'a budget cap was reached: the Providers view shows when its window reopens; raise the cap or search less, or the next firing skips again',
  },
  skipped_confirm: {
    reason: 'its cost estimate needs your confirmation',
    fix: 'open the definition and confirm the new estimate; until then every scheduled firing is skipped',
  },
  skipped_window: {
    reason: 'its window has no departure dates left',
    fix: 'the schedule is now off: edit the window, then enable the definition again',
  },
  skipped_missed: {
    reason: 'it was missed and not caught up',
    fix: 'the next scheduled run goes ahead as normal; start one now for newer prices',
  },
};
const BEHIND_FIX =
  'no run has finished since the schedule last fired: start one now; a machine asleep at the firing time is the usual cause (the schedule card notes a missed firing)';

function dataCheck(f: StatusFacts, d: DataFacts): StatusCheck {
  const fix = fixer(f);
  const base = { id: `data-${d.definitionId}`, area: 'data', label: d.name } as const;
  const running = d.runningSince === null ? null : `running since ${at(f, d.runningSince)}`;
  const l = d.latest;
  const run = d.lastRun;
  if (!d.enabled)
    return check({
      ...base,
      state: 'off',
      offReason: 'disabled',
      summary: `disabled${run === null ? '; it never finished a run' : `; its last run was ${at(f, run.at)}`}`,
    });
  const left = d.leftNotes
    .map((n) => `${n.text} (${n.cells} ${n.cells === 1 ? 'cell' : 'cells'})`)
    .join('; ');
  const note = left === '' ? null : left;
  const parts: string[] = [];
  if (running !== null) parts.push(running);
  const skippedRow = l !== null && l.status.startsWith('skipped_');
  const skipInfo = skippedRow
    ? (SKIPPED[l.status] ?? { reason: 'it did not run', fix: 'start a run now' })
    : null;
  if (l !== null && skippedRow && skipInfo !== null) {
    const reason =
      l.status === 'skipped_missed' && l.skipCode !== null ? SKIP_CODE_TEXT[l.skipCode] : skipInfo.reason;
    parts.push(`last firing skipped (${reason}) on ${at(f, l.at)}`);
  }
  if (run !== null) {
    const word = RUN_WORD[run.status];
    parts.push(
      `last run ${at(f, run.at)}${word === undefined ? '' : ` (${word})`}: ${
        d.coverage === null ? 'no cells recorded' : coverageLine(d.coverage.buckets, d.coverage.total)
      }`,
    );
    parts.push(
      d.ages === null
        ? 'no prices yet'
        : ageEndsLine(formatAgeShort(d.ages.newest), formatAgeShort(d.ages.oldest)),
    );
  }
  if (run === null && !skippedRow) {
    parts.push(
      running === null
        ? 'no prices yet: this search has not finished a run'
        : 'first run in progress: no prices yet',
    );
    return check({
      ...base,
      state: 'warn',
      summary: parts.join('; '),
      note,
      fix: fix(
        running === null ? 'start a run from the Definitions view' : 'wait for the first run to finish',
      ),
    });
  }
  const gap = d.coverage !== null && coverageGapWarn(d.coverage.buckets, d.coverage.total);
  const browserOnlyCatchUp =
    d.browserOnlyScheduled && (run?.isCatchUp === true || l?.skipCode === 'browser-only-definition');
  const unfinished = run !== null && RUN_WORD[run.status] !== undefined && run.status !== 'paused_budget';
  let problem: StatusCheck['fix'] = null;
  if (skippedRow && skipInfo !== null)
    problem = fix(l?.skipCode === 'browser-only-definition' ? STATUS_TEXT.browserOnlyFix : skipInfo.fix);
  else if (browserOnlyCatchUp) problem = fix(STATUS_TEXT.browserOnlyFix);
  else if (unfinished) problem = fix('start a run to finish the cells it left');
  else if (gap)
    problem = fix('the Coverage view shows which cells were left; run again or widen the sources');
  else if (d.ages?.stale === true) problem = fix('start a run for newer prices');
  else if (d.ages === null) problem = fix('start a run, or check that a price source is set up');
  else if (d.behindSchedule) problem = fix(BEHIND_FIX);
  return check({
    ...base,
    state: problem === null ? 'ok' : 'warn',
    summary: parts.join('; '),
    note,
    fix: problem,
  });
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
  const names = f.priceSources.usable.map((id) => PROVIDER_NAMES[id]);
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
  const name = PROVIDER_NAMES[p.id];
  const base = { id: `provider-${p.id}`, area: 'provider', providerId: p.id } as const;
  if (!p.configured)
    return check({
      ...base,
      state: 'off',
      offReason: 'not-set-up',
      summary: `${name} is not set up`,
      fix: fix(`add ${name}`, RECONFIGURE[p.id] ?? null),
    });
  const usage = p.usage === null ? '' : `; ${usageWords(p.usage)}`;
  const last = p.lastCall;
  if (last !== null && last.result === 'auth')
    return check({
      ...base,
      state: 'fail',
      summary: `${name}: the last call was refused, the key is not accepted (${at(f, last.at)})`,
      fix: fix(`replace the ${name} key`, RECONFIGURE[p.id] ?? null),
    });
  if (last !== null && last.result === 'quota')
    return check({
      ...base,
      state: 'fail',
      summary: `${name}: the last call was refused, the plan's quota is used up (${at(f, last.at)})`,
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
      summary: `${name}: ${why}${usage}`,
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
    summary: `${name}: ${last === null ? 'configured; not used yet' : `last successful call ${at(f, last.at)}`}${usage}`,
  });
}

function syntheticCheck(f: StatusFacts): StatusCheck {
  return check({
    id: 'provider-fixture',
    area: 'provider',
    providerId: 'fixture',
    state: 'warn',
    summary: 'synthetic test data, not fares',
    fix: fixer(f)('development only: unset ALLOW_FIXTURE_PROVIDER to remove it'),
  });
}

/** Why the consent card reads as it does: the cause the daily notice's subject comes from (V2). */
export type ConsentCause = 'expiring' | 'expired' | 'missing' | 'voided' | 'cannot-check' | 'none';

const NOT_VERIFIED = 'awaiting verification for this build: consent is not checked yet';

/** The consent card and its cause. */
export function consentOutcome(f: Frame, w: WorkerFacts): { check: StatusCheck; cause: ConsentCause } {
  const fix = fixer(f);
  const base = { id: 'consent', area: 'consent' } as const;
  const consentFix = fix(consentFixText());
  const out = (c: StatusCheck, cause: ConsentCause) => ({ check: c, cause });
  const cannot = (why: string, fixFor: StatusCheck['fix']) =>
    out(check({ ...base, state: 'warn', summary: `cannot check: ${why}`, fix: fixFor }), 'cannot-check');
  const r = w.read;
  if (r.kind === 'disabled')
    return out(
      check({ ...base, state: 'off', offReason: 'not-set-up', summary: 'browser provider not enabled' }),
      'none',
    );
  if (r.kind === 'keys-differ')
    return cannot(
      "the worker refused this app's key",
      fix('set the browser provider up again', 'pnpm gmt setup --reconfigure browser'),
    );
  if (r.kind === 'unreadable')
    return cannot(
      "the worker's answer could not be read by this version",
      fix('update the app and the worker together', 'pnpm gmt update'),
    );
  if (r.kind === 'unreachable') {
    const ref = w.refusal;
    if (f.mode === 'native' && ref.kind === 'refusal') {
      // why: W1: a build mismatch means the pinned build (whose flags are set, or flags-unset would come first) is not
      // installed yet: a refusal whose fix is `pnpm gmt browser install`, never awaiting verification
      if (ref.reason === 'flags-unset')
        return out(
          check({ ...base, state: 'off', offReason: 'awaiting-verification', summary: NOT_VERIFIED }),
          'none',
        );
      if (ref.reason.startsWith('consent-')) {
        const cause =
          ref.reason === 'consent-voided'
            ? 'voided'
            : ref.reason === 'consent-missing' || ref.reason === 'consent-not-shown'
              ? 'missing'
              : 'expired';
        return out(
          check({ ...base, state: 'fail', summary: START_REFUSAL_TEXT[ref.reason].summary, fix: consentFix }),
          cause,
        );
      }
      const t = START_REFUSAL_TEXT[ref.reason];
      return cannot(`the worker will not start (${t.summary})`, refusalFix(fix, t.summary, t.fixCommand));
    }
    return cannot('the worker is not answering', fix('start the worker', 'pnpm gmt start'));
  }
  const s = r.status;
  if (!s.formVerified)
    return out(
      check({ ...base, state: 'off', offReason: 'awaiting-verification', summary: NOT_VERIFIED }),
      'none',
    );
  // spec §2: a capture expires at the earlier of the cookie's own expiry and 13 months after it was made. A worker that
  // reports no consent record gives only the capture time, so the date it can state is an upper bound, said as one
  const c = s.consent;
  if (c?.kind === 'voided')
    return out(
      check({
        ...base,
        state: 'fail',
        summary: START_REFUSAL_TEXT['consent-voided'].summary,
        fix: consentFix,
      }),
      'voided',
    );
  // why: a not-shown record has no capture: it expires 13 months after its own check, which this worker's status does not
  // carry, so with no stated expiry nothing can be said (CodeRabbit)
  if (c?.kind === 'not-shown' && c.expiresAt === null)
    return cannot('the worker did not state when its no-consent-screen check expires', consentFix);
  // why: a record that states no expiry still has its capture time; the capture bound stands in, said as an upper bound
  const stated = c?.expiresAt ?? null;
  const bound = stated ?? (s.socsCapturedAt === null ? null : consentBoundOf(s.socsCapturedAt));
  if (bound === null)
    return out(
      check({
        ...base,
        state: 'fail',
        summary: START_REFUSAL_TEXT['consent-missing'].summary,
        fix: consentFix,
      }),
      'missing',
    );
  const state = consentWindowState(bound, f.now);
  const words =
    stated === null && s.socsCapturedAt !== null
      ? `consent rejected, captured ${at(f, s.socsCapturedAt)}; expires by ${at(f, bound)} at the latest (this worker does not report the cookie's expiry)`
      : c?.kind === 'not-shown'
        ? `no consent screen in this region, recorded ${at(f, consentMadeAt(bound))}`
        : `consent rejected, expires ${at(f, bound)} (${c?.boundedBy === 'cookie' ? 'cookie' : 'capture'})`;
  if (state === 'ok') return out(check({ ...base, state: 'ok', summary: words }), 'none');
  return out(
    check({
      ...base,
      state,
      summary: state === 'fail' ? `consent expired on ${at(f, bound)}` : `${words}; 30 days or less left`,
      fix: consentFix,
    }),
    state === 'fail' ? 'expired' : 'expiring',
  );
}

export const consentCheckOf = (f: Frame, w: WorkerFacts): StatusCheck => consentOutcome(f, w).check;

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
      // why: W1: a build mismatch means the pinned build (whose flags are set, or flags-unset would come first) is not
      // installed yet: a refusal whose fix is `pnpm gmt browser install`, never awaiting verification
      if (ref.reason === 'flags-unset')
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
        fix: ref.reason.startsWith('consent-')
          ? fix(consentFixText())
          : refusalFix(fix, t.summary, t.fixCommand),
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
  const monthly =
    s.monthly === null || !s.monthly.readable
      ? ''
      : `; this month: pages ${s.monthly.pages} of ${w.caps.pages}, scrolls ${s.monthly.scrolls} of ${w.caps.scrolls}`;
  const refuses = (summary: string, fixFor: StatusCheck['fix']) =>
    check({ ...base, state: 'fail', summary: `refusing pages: ${summary}`, note, fix: fixFor });
  const found = s.finding;
  if (found !== null) {
    switch (found.kind) {
      case 'signed-in': {
        const t = START_REFUSAL_TEXT['signed-in'];
        return refuses(SIGNED_IN_REFUSED, refusalFix(fix, t.summary, t.fixCommand));
      }
      // why: W3: the worker refuses every page while its counts cannot be read; a rewrite from the ledger repairs it
      case 'counts-unreadable':
        return refuses(
          "the worker's monthly counts file cannot be read",
          fix('rewrite the counts from the ledger', 'pnpm gmt browser counts'),
        );
      case 'settings':
        return refuses(
          `settings differ between the app and the worker: ${found.names.join(', ')}`,
          fix('set both to the same values', 'pnpm gmt setup --reconfigure browser'),
        );
      case 'grid-unverified':
        return refuses(
          GRID_NOT_VERIFIED,
          fix('set the worker up for grid mode again', 'pnpm gmt setup --reconfigure browser'),
        );
      case 'grid-setting':
        return refuses(
          `${found.name} differs between the app and the worker`,
          fix('set both to the same value', 'pnpm gmt setup --reconfigure browser'),
        );
      case 'cooling':
        return check({
          ...base,
          state: 'warn',
          summary: `cooling down until ${at(f, found.until)}${found.cause === null ? '' : ` (${BLOCKED_WORDS[found.cause]})`}${monthly}`,
          note,
          fix: fix('no action: the app tries again after the cool-down'),
        });
    }
  }
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
      fix: fix('rewrite the counts from the ledger', 'pnpm gmt browser counts'),
    });
  if (
    s.monthly !== null &&
    (capWarn(s.monthly.pages, w.caps.pages) || capWarn(s.monthly.scrolls, w.caps.scrolls))
  )
    return check({
      ...base,
      state: 'warn',
      summary: `reachable; a monthly cap is near (${CAP_WARN_SHARE * 100}% or more used)${monthly}`,
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

/** The words for the kind of send the email card reports. */
const SEND_KIND: Readonly<Record<string, string>> = {
  digest: 'alert',
  operator: 'notice',
  system: 'notice',
  test: 'test',
};

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
      summary: `the last ${SEND_KIND[e.last.kind] ?? 'email'} email failed (${at(f, e.last.at)}), since the app started`,
      fix: fix('check the SMTP settings and send a test again', 'pnpm gmt setup --reconfigure email'),
    });
  const last =
    e.last === null
      ? 'no email sent since the app started'
      : `the last ${SEND_KIND[e.last.kind] ?? 'email'} email was ${e.last.result === 'sent' ? 'sent' : 'held back at the hourly limit'} at ${at(f, e.last.at)}, since the app started`;
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
    consentOutcome(f, f.worker).check,
    emailCheck(f),
  ];
  return apiContract.sortChecks(checks);
}

export function buildStatus(f: StatusFacts): StatusResponse {
  return { generatedAt: f.now, mode: f.mode, version: f.version, checks: buildChecks(f) };
}
