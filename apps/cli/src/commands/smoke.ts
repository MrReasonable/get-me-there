import { apiContract } from '@gmt/core';
import type { z } from 'zod';
import { type AppCreds, appUrl, authHeaders, credsFrom } from '../appClient.js';
import type { Flags } from '../args.js';
import { type Deps, EXIT } from '../deps.js';
import { appEnvPath } from '../services/specs.js';
import { readEnvText } from '../setup/appEnv.js';
import { NO_SOURCE_TEXT } from '../setup/closing.js';

type SmokePlan = z.infer<typeof apiContract.smokePlanResponseSchema>;

/** The plan route's worst case, one line a provider (spec §13 `smoke`). */
export function spendLines(p: SmokePlan): string[] {
  const out: string[] = [];
  if (p.searchApi !== null) {
    const trial = p.searchApi.trialLeft === null ? '' : `; trial: ${p.searchApi.trialLeft} left`;
    out.push(
      `SearchApi: up to ${p.searchApi.calendar + p.searchApi.itinerary} calls (calendar ${p.searchApi.calendar}, itinerary ${p.searchApi.itinerary}${trial})`,
    );
  }
  if (p.travelpayouts !== null) out.push(`Travelpayouts: up to ${p.travelpayouts.freeCalls} free calls`);
  if (p.camoufox !== null) {
    const pages = `${p.camoufox.pages} page${p.camoufox.pages === 1 ? '' : 's'}`;
    out.push(
      `browser provider: ${pages}${p.camoufox.scrolls > 0 ? `, up to ${p.camoufox.scrolls} scrolls` : ''}`,
    );
  }
  return out;
}

const MUTATING = { 'Content-Type': 'application/json', 'X-Requested-With': 'get-me-there' } as const;

async function postSmoke(
  deps: Deps,
  c: AppCreds,
  body: Record<string, unknown>,
): Promise<z.infer<typeof apiContract.toolRunResponseSchema> | string> {
  const r = await deps.http({
    method: 'POST',
    url: appUrl(c.port, '/api/tools/smoke'),
    headers: { ...authHeaders(c), ...MUTATING },
    body: JSON.stringify(body),
    timeoutMs: 600_000,
  });
  if ('error' in r) return `no answer from the app on port ${c.port}`;
  try {
    const parsed = apiContract.toolRunResponseSchema.safeParse(JSON.parse(r.body));
    return parsed.success ? parsed.data : `the app answered ${r.status}`;
  } catch {
    return `the app answered ${r.status}`;
  }
}

/**
 * `gmt smoke --from <IATA> --to <IATA>` (spec §13): states the route's worst case from `GET /api/tools/smoke/plan`
 * before anything is posted; refuses with no provider configured, and when the SearchApi trial has fewer credits left;
 * posts a dry run (it ledgers nothing) and shows its lines, stopping on its refusal; states the credits tool runs
 * already used in this window (the dry run's `searchApiCreditsLedgered`, U7) and asks for a typed `yes` for that
 * running total (`--yes` in scripts, with `--accept-total` once earlier tool runs used credits: decision 20); then
 * posts the smoke with that total as its budget. Basic auth from app.env travels in the request header only.
 */
export async function smokeCommand(flags: Flags, _p: string | null, deps: Deps): Promise<number> {
  // why: po-b1-013: the Definitions form's rule; lowercase is upper-cased, anything but three letters refused
  const from = typeof flags.from === 'string' ? flags.from.toUpperCase() : null;
  const to = typeof flags.to === 'string' ? flags.to.toUpperCase() : null;
  if (from === null || to === null || !/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) {
    deps.io.err(
      'smoke needs a route: --from <IATA> --to <IATA>, three letters each (for example --from LHR --to JFK)\n',
    );
    return EXIT.usage;
  }
  const text = deps.files.read(appEnvPath(deps.platform.paths));
  const creds = text === null ? null : credsFrom(readEnvText(text));
  if (creds === null) {
    deps.io.err('no app settings to call the app with: run pnpm gmt setup first\n');
    return EXIT.badConfig;
  }
  const r = await deps.http({
    method: 'GET',
    url: appUrl(creds.port, '/api/tools/smoke/plan'),
    headers: authHeaders(creds),
    timeoutMs: 30_000,
  });
  let plan: SmokePlan | null = null;
  if (!('error' in r) && r.status === 200) {
    try {
      const p = apiContract.smokePlanResponseSchema.safeParse(JSON.parse(r.body));
      plan = p.success ? p.data : null;
    } catch {
      plan = null;
    }
  }
  if (plan === null) {
    deps.io.err(
      `cannot read the smoke's plan from the app on port ${creds.port}; is it running? (pnpm gmt status)\n`,
    );
    return EXIT.badConfig;
  }
  if (plan.searchApi === null && plan.travelpayouts === null && plan.camoufox === null) {
    // why: po-b1-012, U3: nothing could answer; say why before any question
    deps.io.err(`${NO_SOURCE_TEXT}\nNothing was sent.\n`);
    return EXIT.badConfig;
  }
  const lines = spendLines(plan);
  deps.io.out(
    `The smoke test of ${from} to ${to} spends real calls, at most:\n${lines.map((l) => `  ${l}`).join('\n')}\n`,
  );
  const credits = plan.searchApi === null ? 0 : plan.searchApi.calendar + plan.searchApi.itinerary;
  const left = plan.searchApi?.trialLeft ?? null;
  if (left !== null && left < credits) {
    deps.io.err(
      `the smoke needs up to ${credits} SearchApi credits and the trial has ${left} left; nothing was sent\n`,
    );
    return EXIT.spendRefused;
  }
  const dry = await postSmoke(deps, creds, {
    origin: from,
    destination: to,
    budget: Math.max(1, credits),
    dryRun: true,
  });
  if (typeof dry === 'string') {
    deps.io.err(`the smoke's dry run failed: ${dry}; nothing was sent\n`);
    return EXIT.failed;
  }
  if (dry.exitCode !== 0) {
    // why: CodeRabbit …k7a: the app refused the route or the spend; nothing real is posted
    deps.io.err(`${[dry.summary, ...dry.lines].join('\n')}\nNothing was sent.\n`);
    return dry.exitCode;
  }
  deps.io.out(`${dry.lines.map((l) => `  ${l}`).join('\n')}\n`);
  const ledgered = dry.searchApiCreditsLedgered ?? 0;
  const total = ledgered + credits;
  if (ledgered > 0)
    deps.io.out(
      `Tool runs have already used ${ledgered} SearchApi credits in this budget window; this smoke takes that to at most ${total}.\n`,
    );
  if (flags.yes === true) {
    if (ledgered > 0 && flags['accept-total'] !== true) {
      deps.io.err(
        `earlier tool runs used ${ledgered} SearchApi credits in this window: confirm the total of ${total} on a terminal, or add --accept-total to --yes; nothing was sent\n`,
      );
      return EXIT.spendRefused;
    }
  } else {
    if (!deps.io.stdinIsTTY) {
      deps.io.err('the smoke needs a typed yes on a terminal, or --yes; nothing was sent\n');
      return EXIT.badConfig;
    }
    const question =
      ledgered > 0
        ? `Send the smoke test now, taking tool runs to at most ${total} SearchApi credits?`
        : 'Send the smoke test now? It spends the calls above.';
    if (!(await deps.ask.typed(question, 'yes'))) {
      deps.io.err('not sent\n');
      return EXIT.badConfig;
    }
  }
  const run = await postSmoke(deps, creds, { origin: from, destination: to, budget: Math.max(1, total) });
  if (typeof run === 'string') {
    deps.io.err(`the smoke failed: ${run}\n`);
    return EXIT.failed;
  }
  if (run.exitCode === EXIT.spendRefused) {
    // why: cb-b1-012: the app's advice names a --budget flag this command does not have
    deps.io.err(
      'another tool run spent SearchApi credits since the check; run pnpm gmt smoke again to see the new total. Nothing was sent.\n',
    );
    return EXIT.spendRefused;
  }
  deps.io.out(`${[run.summary, ...run.lines].join('\n')}\n`);
  return run.exitCode;
}
