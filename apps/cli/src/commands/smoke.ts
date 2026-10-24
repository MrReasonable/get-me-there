import { apiContract } from '@gmt/core';
import type { z } from 'zod';
import { type AppCreds, appUrl, authHeaders, credsFrom } from '../appClient.js';
import type { Flags } from '../args.js';
import { type Deps, EXIT } from '../deps.js';
import { appEnvPath } from '../services/specs.js';
import { readEnvText } from '../setup/appEnv.js';

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
const LEDGERED = /SearchApi credits already ledgered to tool runs in this budget window: (\d+)/;

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
 * before anything is posted, refuses when the SearchApi trial has fewer credits left, asks for a typed `yes` (`--yes`
 * in scripts), learns the credits tool runs already ledgered from a dry run, then posts the smoke with that plus the
 * worst case as its budget. Basic auth from app.env travels in the request header only.
 */
export async function smokeCommand(flags: Flags, _p: string | null, deps: Deps): Promise<number> {
  const from = flags.from;
  const to = flags.to;
  if (
    typeof from !== 'string' ||
    typeof to !== 'string' ||
    !/^[A-Z]{3}$/.test(from) ||
    !/^[A-Z]{3}$/.test(to)
  ) {
    deps.io.err(
      'smoke needs a route: --from <IATA> --to <IATA>, three capital letters each (for example --from LHR --to JFK)\n',
    );
    return EXIT.usage;
  }
  const text = deps.files.read(appEnvPath(deps.platform.paths));
  const creds = text === null ? null : credsFrom(readEnvText(text));
  if (creds === null) {
    deps.io.err('no app settings to call the app with: run pnpm gmt setup first\n');
    return EXIT.refused;
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
    return EXIT.refused;
  }
  const lines = spendLines(plan);
  deps.io.out(
    `The smoke test of ${from} to ${to} spends real calls, at most:\n${lines.map((l) => `  ${l}`).join('\n') || '  nothing: no provider is configured'}\n`,
  );
  const credits = plan.searchApi === null ? 0 : plan.searchApi.calendar + plan.searchApi.itinerary;
  const left = plan.searchApi?.trialLeft ?? null;
  if (left !== null && left < credits) {
    deps.io.err(
      `the smoke needs up to ${credits} SearchApi credits and the trial has ${left} left; nothing was sent\n`,
    );
    return EXIT.refused;
  }
  if (flags.yes !== true) {
    if (!deps.io.stdinIsTTY) {
      deps.io.err('the smoke needs a typed yes on a terminal, or --yes; nothing was sent\n');
      return EXIT.refused;
    }
    if (!(await deps.ask.typed('Send the smoke test now? It spends the calls above.', 'yes'))) {
      deps.io.err('not sent\n');
      return EXIT.refused;
    }
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
  const ledgered = Number(dry.lines.map((l) => LEDGERED.exec(l)?.[1]).find((v) => v !== undefined) ?? '0');
  const run = await postSmoke(deps, creds, {
    origin: from,
    destination: to,
    budget: Math.max(1, ledgered + credits),
  });
  if (typeof run === 'string') {
    deps.io.err(`the smoke failed: ${run}\n`);
    return EXIT.failed;
  }
  deps.io.out(`${[run.summary, ...run.lines].join('\n')}\n`);
  return run.exitCode === 0 ? EXIT.ok : EXIT.failed;
}
