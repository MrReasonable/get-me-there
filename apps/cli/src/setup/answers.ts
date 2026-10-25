import { isMailbox, isValidTimeZone } from '@gmt/core';
import { z } from 'zod';
import type { Deps } from '../deps.js';
import { resolveSecrets, type SecretInput, valueProblem } from './secrets.js';

/**
 * Setup's answers (brief §6): what the operator chose, row by row. `--answers <file>` gives them as JSON under a strict
 * schema (an unknown key is refused, so a file can never set `ALLOW_FIXTURE_PROVIDER`, `DATABASE_PATH` or a
 * `.fixture.db`), with secrets as a literal (the file must then be 0600), `{ "fromEnv": "NAME" }` or
 * `{ "fromStdin": true }`.
 */
export interface Answers {
  port: number;
  timezone: string;
  pointOfSale: string;
  travelpayouts: { token: string } | null;
  searchApi: { plan: 'trial' | '40usd'; key: string; billingDay: number; trialUsed: number | null } | null;
  email: {
    host: string;
    port: number;
    tls: 'implicit' | 'starttls' | 'none';
    user: string;
    pass: string;
    to: string;
    from: string;
  } | null;
  linger: 'skip' | 'enable';
  /**
   * Row 9 (decision 83), and the answers file's row 8 (WP17 Task 17.6): turn the browser provider on, accept a server's
   * own address (a machine with no display), and generate a new worker key under `--reconfigure browser`.
   */
  browser: {
    window: 'scheduled' | 'any';
    enabled?: boolean;
    acceptServerAddress?: boolean;
    rotateKey?: boolean;
  } | null;
}

/** Pressing Enter at every prompt: a running app with no price source, no email and no linger. */
export function defaultAnswers(d: { port: number; timezone: string }): Answers {
  return {
    port: d.port,
    timezone: d.timezone,
    pointOfSale: 'GB',
    travelpayouts: null,
    searchApi: null,
    email: null,
    linger: 'skip',
    browser: null,
  };
}

const secretInputSchema = z.union([
  z.string(),
  z.strictObject({ fromEnv: z.string().regex(/^[A-Z_][A-Z0-9_]*$/) }),
  z.strictObject({ fromStdin: z.literal(true) }),
]);
export const PORT_RANGE = { min: 1024, max: 65535 } as const;
const portSchema = z.number().int().min(PORT_RANGE.min).max(PORT_RANGE.max);

export const answersFileSchema = z.strictObject({
  port: portSchema.optional(),
  timezone: z.string().optional(),
  pointOfSale: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  travelpayouts: z.strictObject({ token: secretInputSchema }).nullable().optional(),
  searchApi: z
    .strictObject({
      plan: z.enum(['trial', '40usd']),
      key: secretInputSchema,
      billingDay: z.number().int().min(1).max(28).optional(),
      trialUsed: z.number().int().min(0).max(100).optional(),
    })
    .nullable()
    .optional(),
  email: z
    .strictObject({
      host: z.string().min(1),
      port: z.number().int().min(1).max(65535),
      tls: z.enum(['implicit', 'starttls', 'none']),
      user: z.string(),
      pass: secretInputSchema,
      to: z.string(),
      from: z.string(),
    })
    .nullable()
    .optional(),
  linger: z.enum(['skip', 'enable']).optional(),
  browser: z
    .strictObject({
      window: z.enum(['scheduled', 'any']),
      enabled: z.boolean().exactOptional(),
      acceptServerAddress: z.boolean().exactOptional(),
      rotateKey: z.boolean().exactOptional(),
    })
    .optional(),
});
type AnswersFile = z.infer<typeof answersFileSchema>;

/** The plain (not secret) values of answers that are not checked by their own schema, each as field → problem. */
export function plainProblems(a: Answers): string[] {
  const out: string[] = [];
  if (!isValidTimeZone(a.timezone)) out.push('timezone: not a time zone this machine knows');
  if (!/^[A-Z]{2}$/.test(a.pointOfSale))
    out.push('pointOfSale: must be two capital letters (an ISO 3166 country)');
  if (a.email !== null) {
    for (const [f, v] of [
      ['email.host', a.email.host],
      ['email.user', a.email.user],
      ['email.to', a.email.to],
      ['email.from', a.email.from],
    ] as const) {
      const p = valueProblem(f, v, { secret: false });
      if (p !== null) out.push(p);
    }
    if (!isMailbox(a.email.to)) out.push('email.to: not an email address');
    if (!isMailbox(a.email.from)) out.push('email.from: not an email address');
  }
  return out;
}

/** The secret values of answers, field → problem (never the value). */
export function secretProblems(a: Answers): string[] {
  const fields: Array<[string, string | undefined]> = [
    ['travelpayouts.token', a.travelpayouts?.token],
    ['searchApi.key', a.searchApi?.key],
    ['email.pass', a.email?.pass],
  ];
  return fields.flatMap(([f, v]) => {
    const p = v === undefined ? null : valueProblem(f, v, { secret: true });
    return p === null ? [] : [p];
  });
}

const hasLiteralSecret = (f: AnswersFile): boolean =>
  typeof f.travelpayouts?.token === 'string' ||
  typeof f.searchApi?.key === 'string' ||
  typeof f.email?.pass === 'string';

/** Reads, checks and resolves an answers file; every error names a field or the file, never a secret's value. */
export async function loadAnswersFile(
  path: string,
  deps: Deps,
  ctx: { defaults?: Answers } = {},
): Promise<{ ok: true; answers: Answers } | { ok: false; error: string }> {
  const text = deps.files.read(path);
  if (text === null) return { ok: false, error: `cannot read ${path}` };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: `${path} is not JSON` };
  }
  const parsed = answersFileSchema.safeParse(json);
  if (!parsed.success)
    return {
      ok: false,
      error: `${path}: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(top level)'}: ${i.code}`).join('; ')}`,
    };
  const f = parsed.data;
  const mode = deps.files.mode(path) ?? 0;
  if (hasLiteralSecret(f) && (mode & 0o077) !== 0)
    return { ok: false, error: `${path} holds a secret and is readable by others: chmod 600 ${path}` };
  if (f.searchApi?.plan === '40usd' && f.searchApi.trialUsed !== undefined)
    return { ok: false, error: 'searchApi.trialUsed applies to the trial plan only' };

  const inputs: Array<{ field: string; input: SecretInput }> = [];
  if (f.travelpayouts) inputs.push({ field: 'travelpayouts.token', input: f.travelpayouts.token });
  if (f.searchApi) inputs.push({ field: 'searchApi.key', input: f.searchApi.key });
  if (f.email) inputs.push({ field: 'email.pass', input: f.email.pass });
  const secrets = await resolveSecrets(inputs, deps.secretEnv, deps.io.readStdin);
  if (!secrets.ok) return secrets;
  const secret = (field: string): string => secrets.values.get(field) ?? '';

  const base = ctx.defaults ?? defaultAnswers({ port: 3000, timezone: deps.machineTimeZone });
  const answers: Answers = {
    port: f.port ?? base.port,
    timezone: f.timezone ?? base.timezone,
    pointOfSale: f.pointOfSale ?? base.pointOfSale,
    travelpayouts:
      f.travelpayouts === undefined
        ? base.travelpayouts
        : f.travelpayouts && { token: secret('travelpayouts.token') },
    searchApi:
      f.searchApi === undefined
        ? base.searchApi
        : f.searchApi && {
            plan: f.searchApi.plan,
            key: secret('searchApi.key'),
            billingDay: f.searchApi.billingDay ?? 1,
            // why: U2: the trial's searches spent outside any ledger are never in an imported database, so the count
            // is kept (from the file, else the current settings, else 0) whatever the database's origin
            trialUsed:
              f.searchApi.plan === 'trial' ? (f.searchApi.trialUsed ?? base.searchApi?.trialUsed ?? 0) : null,
          },
    email: f.email === undefined ? base.email : f.email && { ...f.email, pass: secret('email.pass') },
    linger: f.linger ?? base.linger,
    browser: f.browser ?? base.browser,
  };
  const problems = [...secretProblems(answers), ...plainProblems(answers)];
  return problems.length === 0 ? { ok: true, answers } : { ok: false, error: problems.join('; ') };
}

/**
 * Whether the answers give searches a price source (U3): Travelpayouts, or SearchApi on its monthly plan. The SearchApi
 * trial is not one: scheduled and definition runs never use it (spec §5.3); it serves `pnpm gmt smoke`.
 */
export const searchSource = (a: Answers): boolean =>
  a.travelpayouts !== null || a.searchApi?.plan === '40usd';
