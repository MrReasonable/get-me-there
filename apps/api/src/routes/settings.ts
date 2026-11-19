/**
 * The Settings page's routes (UX redesign stage 3; settings plan rulings 5, 6, 8 and 11). `GET /settings` gives the
 * stored values and what this boot did with them, never a secret (`{ set, last4 }`, `last4` for the two API keys
 * only); `PUT /settings` checks the changes laid over the stored rows as the next boot will read them, writes the
 * changed names in one transaction and asks for the restart in place; `POST /settings/email-test` sends the fixed test
 * message through the server the form names. A secret in a request body joins the scrub lists before anything can fail.
 */
import {
  apiContract,
  type ConfigError,
  isMailbox,
  isOwnedName,
  layerSettings,
  OWNED_NAMES,
  type OwnedName,
  providerIdSchema,
  SETTING_LABELS,
  Secret,
  type SettingRow,
  settingRefusal,
  smtpPlaintextAllowed,
} from '@gmt/core';
import { budgetConfigFromConfig, SettingsRepo } from '@gmt/db';
import { sendTestEmail } from '@gmt/engine';
import { z } from 'zod';
import { newSearchSourcesFor } from '../defaults.js';
import { ApiError } from '../errors.js';
import { spendWarnings } from '../read/usage.js';
import { API_TEXT } from '../text.js';
import { parseLayered } from '../wiring.js';
import { NO_INPUT, route } from './define.js';
import type { HandlerTable, RouteContext, RouteHandler } from './types.js';

/** The two API keys, whose last four characters the page may show; never a password. */
const LAST4_NAMES: readonly OwnedName[] = ['TRAVELPAYOUTS_TOKEN', 'SEARCHAPI_KEY'];
/** A key shorter than this gives no last four: they would be most of it. */
const LAST4_MIN_LENGTH = 12;

const present = (v: string | undefined): v is string => v !== undefined && v !== '';

/** The body's `changes`, read loosely before the schema runs, so its secrets are scrubbed first. */
const looseChanges = z.object({ changes: z.record(z.string(), z.unknown()) });

/**
 * Every string a body sends under a secret name, or under a name the page does not own (a key pasted into the wrong
 * field): each joins the scrub lists before the body is checked.
 */
function bodySecrets(body: unknown): Secret[] {
  const loose = looseChanges.safeParse(body);
  if (!loose.success) return [];
  return Object.entries(loose.data.changes).flatMap(([name, value]) =>
    typeof value === 'string' &&
    value !== '' &&
    !apiContract.PLAIN_SETTING_NAMES.some((plain) => plain === name)
      ? [new Secret(value)]
      : [],
  );
}

/** The 422 of refused settings: each owned name once, in SETTINGS_NAMES order, with the page's label and words. */
function refusalError(message: string, errors: readonly ConfigError[]): ApiError {
  const fields: apiContract.SettingRefusal[] = [];
  for (const name of OWNED_NAMES) {
    const error = errors.find((e) => e.field === name);
    if (error === undefined) continue;
    const words = settingRefusal(name, error);
    fields.push({ field: name, message: words, name, label: SETTING_LABELS[name], words });
  }
  return new ApiError(422, 'invalid_settings', message, { fields });
}

/** The searches of the runs and the flight read in flight, by name, each once (ruling 14's "Applies when <names> finish"). */
function runningNames(ctx: RouteContext): string[] {
  const { repos } = ctx.ports;
  const nameOf = (definitionId: string): string => repos.definitions.get(definitionId)?.name ?? definitionId;
  const names = ctx.engine.status().running.flatMap((id) => {
    const e = repos.executions.get(id);
    return e === null ? [] : [repos.definitions.get(e.definitionId)?.name ?? e.snapshot.name];
  });
  const read = ctx.engine.flightReadInFlight();
  if (read !== null) names.push(nameOf(read.definitionId));
  return [...new Set(names)];
}

/** Ruling 5: the boot's spend warnings for a config a save would boot with, in the page's words. */
function warningsFor(config: Parameters<typeof spendWarnings>[0]): string[] {
  const budgets = budgetConfigFromConfig(config).providers;
  const w = spendWarnings(
    config,
    providerIdSchema.options.filter((id) => budgets[id] !== undefined),
  );
  return [
    ...(w.zeroCapBlocked.length > 0 ? [API_TEXT.settingsZeroSpendLimit] : []),
    ...(w.belowFees === null
      ? []
      : [API_TEXT.settingsSpendBelowFees(w.belowFees.capPence, w.belowFees.feesPence)]),
  ];
}

/** `GET /settings`: the stored values laid over the environment, as the next boot reads them. */
function settingsView(ctx: RouteContext): apiContract.SettingsView {
  const { ports } = ctx;
  const merged = layerSettings(ctx.settingsEnv, new SettingsRepo(ports.db).all()).merged;
  const values = Object.fromEntries(
    apiContract.PLAIN_SETTING_NAMES.map((name) => {
      const v = merged[name];
      return [name, present(v) ? v : null];
    }),
  );
  const secrets = Object.fromEntries(
    apiContract.SECRET_SETTING_NAMES.map((name) => {
      const v = merged[name];
      const last4 =
        present(v) && LAST4_NAMES.includes(name) && v.length >= LAST4_MIN_LENGTH ? v.slice(-4) : null;
      return [name, { set: present(v), last4 }];
    }),
  );
  return apiContract.settingsViewSchema.parse({
    values,
    secrets,
    // why: controller ruling R2 — the same function the new-search draft reads, so the switches and the draft agree
    newSearchSources: newSearchSourcesFor(ports.config, ports.providers),
    envOnly: {
      camoufoxEnabled: ports.config.providers.camoufox !== null,
      searchApiTrialUsed: ports.config.providers.searchapi?.trialUsed ?? 0,
    },
    envIgnored: ports.settingsReport.envIgnored,
    setAside: ports.settingsReport.setAside,
    pending: ctx.reload?.pending() === true ? { running: runningNames(ctx) } : null,
  });
}

/**
 * Ruling 5: the changes laid over the stored rows and parsed as the next boot will (a stored value the save leaves
 * alone that the schema refuses is set aside, as at boot); a refusal of a changed name, or of email when the save
 * changes email, is 422 with nothing saved. Valid: the changed names are written in one transaction and the restart
 * in place is asked for.
 */
function save(ctx: RouteContext, changes: apiContract.SettingChanges): apiContract.SettingsUpdateResponse {
  const { ports } = ctx;
  const repo = new SettingsRepo(ports.db);
  const changed: SettingRow[] = OWNED_NAMES.flatMap((name) => {
    const value = changes[name];
    return value === undefined ? [] : [{ name, value: value ?? '' }];
  });
  const keep = new Set(changed.map((r) => r.name));
  // why: the read, the check and the write in one immediate transaction, so a second save cannot slip between them
  const warnings = ports.db.immediateTransaction(() => {
    const stored = repo.all();
    const next = [...stored.filter((r) => !keep.has(r.name)), ...changed];
    const parsed = parseLayered(ctx.settingsEnv, next, keep);
    if (!parsed.ok) throw refusalError(API_TEXT.settingsRefused, parsed.errors);
    if (changed.length > 0) repo.write(changed, ports.clock.now());
    return warningsFor(parsed.config);
  });
  const applies = ctx.reload?.request() ?? 'now';
  return applies === 'now' ? { warnings, applies } : { warnings, applies, running: runningNames(ctx) };
}

/** The PUT: secrets scrubbed first; a name the page does not own is 422 without echoing it; then the contract schema. */
const putSettings: RouteHandler = (() => {
  const inner = route(
    { request: apiContract.settingsUpdateRequestSchema, query: NO_INPUT },
    (c, { body }, ctx) => c.json(save(ctx, body.changes)),
  );
  return {
    ...inner,
    handle: (c, raw, ctx) => {
      ctx.scrub(bodySecrets(raw.body));
      const loose = looseChanges.safeParse(raw.body);
      // why: zod's own refusal names the unknown key, which may be a pasted secret; the 422 never echoes it
      if (loose.success && Object.keys(loose.data.changes).some((name) => !isOwnedName(name)))
        throw new ApiError(422, 'unknown_setting', API_TEXT.unknownSetting);
      return inner.handle(c, raw, ctx);
    },
  };
})();

/**
 * Ruling 11: the form's values, with the stored password used only when host, port, TLS and user equal the stored ones
 * (else the body must carry one); refusals before any connection; TLS `none` follows the loopback rule; addresses are
 * one mailbox each. A failure is 502 with one of four fixed sentences; a second test within a minute (of either test
 * route) is 429.
 */
const emailTest: RouteHandler = (() => {
  const inner = route(
    { request: apiContract.settingsEmailTestRequestSchema, query: NO_INPUT },
    async (c, { body }, ctx) => {
      const { ports } = ctx;
      const stored = layerSettings(ctx.settingsEnv, new SettingsRepo(ports.db).all()).merged;
      const storedTls = present(stored.SMTP_TLS) ? stored.SMTP_TLS : 'implicit';
      const sameServer =
        body.host === stored.SMTP_HOST &&
        String(body.port) === stored.SMTP_PORT &&
        body.tls === storedTls &&
        body.user === stored.SMTP_USER;
      const pass = body.pass ?? (sameServer && present(stored.SMTP_PASS) ? stored.SMTP_PASS : null);
      const errors: ConfigError[] = [];
      const refuse = (field: OwnedName): void => {
        errors.push({ field, message: '' });
      };
      if (body.tls === 'none' && !smtpPlaintextAllowed(body.host, ports.config.nodeEnv)) refuse('SMTP_TLS');
      if (pass === null) refuse('SMTP_PASS');
      if (!isMailbox(body.to)) refuse('ALERT_EMAIL_TO');
      if (!isMailbox(body.from)) refuse('ALERT_EMAIL_FROM');
      if (errors.length > 0 || pass === null) throw refusalError(API_TEXT.emailTestRefused, errors);
      const r = await sendTestEmail({
        smtp: {
          host: body.host,
          port: body.port,
          tls: body.tls,
          user: body.user,
          pass: new Secret(pass),
          to: body.to,
          from: body.from,
        },
        nodeEnv: ports.config.nodeEnv,
        log: ports.log,
        clock: ports.clock,
        limit: ctx.testSendLimit,
        ...(ctx.emailTransport === undefined ? {} : { createTransport: ctx.emailTransport }),
      });
      if (r.result === 'limited') throw new ApiError(429, 'email_limit', API_TEXT.emailLimit);
      if (r.result === 'failed')
        throw new ApiError(502, 'email_test_failed', API_TEXT.emailTestFailed[r.reason], {
          reason: r.reason,
        });
      return c.json({ result: 'sent', at: ports.clock.now() });
    },
  );
  return {
    ...inner,
    handle: (c, raw, ctx) => {
      const pass = z.object({ pass: z.string().min(1) }).safeParse(raw.body);
      if (pass.success) ctx.scrub([new Secret(pass.data.pass)]);
      return inner.handle(c, raw, ctx);
    },
  };
})();

export const settingsHandlers: HandlerTable = {
  'GET /api/settings': route({ request: NO_INPUT, query: NO_INPUT }, (c, _input, ctx) =>
    c.json(settingsView(ctx)),
  ),
  'PUT /api/settings': putSettings,
  'POST /api/settings/email-test': emailTest,
};
