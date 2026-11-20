/**
 * EmailNotifier (spec §8.3): nodemailer SMTP, plain text only, SMTP_TLS mapped to transport options with short
 * timeouts, one mailbox per address, subjects and bodies cleaned by the engine's one cleaner, synthetic data refused,
 * an outgoing ceiling per hour (decision 56), and the SMTP password scrubbed from every error.
 */
import {
  type Clock,
  type Config,
  type IsoDateTime,
  isMailbox,
  type Logger,
  type Notifier,
  smtpPlaintextAllowed,
  stripUrlsInText,
} from '@gmt/core';
import { scrubSecrets } from '@gmt/providers';
import nodemailer from 'nodemailer';
import { controlFree, stripControl } from '../text.js';
import { HOUR_MS } from '../units.js';
import { containsSynthetic } from './log.js';

export type SmtpConfig = NonNullable<Config['smtp']>;

/**
 * Socket timeouts, in milliseconds (arch-wp11-004). nodemailer's defaults (2 min to connect, 30 s greeting, 10 min of
 * inactivity) would let a stalled server hold the alerts step, which runs before the execution's status write.
 */
export const SMTP_TIMEOUTS = {
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 30_000,
} as const;

/** The subset of nodemailer SMTP options this app sets; certificate checks stay at nodemailer's default (on). */
export interface SmtpTransportOptions {
  host: string;
  port: number;
  secure: boolean;
  requireTLS?: boolean;
  ignoreTLS?: boolean;
  auth: { user: string; pass: string };
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
}
export interface MailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
}
/** The transporter methods used; nodemailer's Transporter satisfies it. */
export interface MailTransport {
  sendMail(m: MailMessage): Promise<{ messageId: string }>;
  /** Closes the transport's connections (nodemailer's `close`); a test send past its deadline calls it. */
  close?(): void;
}
export type TransportFactory = (o: SmtpTransportOptions) => MailTransport;

/**
 * SMTP_TLS → nodemailer options: implicit = TLS from connect; starttls = mandatory upgrade; none = core's
 * smtpPlaintextAllowed only (loopback, or the dev Mailpit host), re-checked here because a Config could be built by
 * hand. Throws on a refused combination.
 */
export function smtpTransportOptions(smtp: SmtpConfig, nodeEnv: Config['nodeEnv']): SmtpTransportOptions {
  const base = {
    host: smtp.host,
    port: smtp.port,
    auth: { user: smtp.user, pass: smtp.pass.reveal() },
    ...SMTP_TIMEOUTS,
  };
  switch (smtp.tls) {
    case 'implicit':
      return { ...base, secure: true };
    case 'starttls':
      return { ...base, secure: false, requireTLS: true };
    case 'none':
      if (!smtpPlaintextAllowed(smtp.host, nodeEnv))
        throw new Error(
          `SMTP_TLS=none is permitted only for a loopback host or the dev Mailpit profile; host ${smtp.host} refused (spec §8.3)`,
        );
      return { ...base, secure: false, ignoreTLS: true };
  }
}

const defaultFactory: TransportFactory = (o) => nodemailer.createTransport(o);

/** A plain-text body: LF line endings (CRLF, a lone CR and a lone LF all end a line), every line control-free. */
function plainText(body: string): string {
  return body
    .split(/\r\n|\r|\n/)
    .map(controlFree)
    .join('\n');
}

/** nodemailer's error code and SMTP response code, the only parts of a failure that are logged (sec-008). */
function failureCodes(err: unknown): { code: string | null; responseCode: number | null } {
  if (typeof err !== 'object' || err === null) return { code: null, responseCode: null };
  const code = 'code' in err && typeof err.code === 'string' ? err.code : null;
  const responseCode =
    'responseCode' in err && typeof err.responseCode === 'number' ? err.responseCode : null;
  return { code, responseCode };
}

/** The fixed test message (spec §10 `POST /alerts/test-email`). */
export const TEST_EMAIL_SUBJECT = '[get-me-there] test email';
export const TEST_EMAIL_BODY =
  'This is a test message from get-me-there. If you can read it, email alerts and notices are set up.';

/** A test send is allowed once a minute, apart from the alert ceiling (V7). */
export const TEST_EMAIL_MIN_GAP_MS = 60_000;

/**
 * Settings plan ruling 11: the test send's own timeouts. A server named in the Settings form that never answers fails
 * the test in ten seconds, connect, greeting and socket alike, so the page is never left waiting on it.
 */
export const TEST_SEND_TIMEOUTS = {
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 10_000,
} as const;

/**
 * A test send's whole deadline. why: the socket timeout bounds a silence, not a send: a server that answers a fragment
 * every few seconds would hold the one test limit (and both test routes) for ever. Past it the send is answered
 * `timed-out`, its transport closed and the limit released; it is never retried, as the server may have taken it.
 */
export const TEST_SEND_DEADLINE_MS = 30_000;

/** `send` within TEST_SEND_DEADLINE_MS, else `onTimeout` runs and it rejects coded ETIMEDOUT (`timed-out`). */
async function withinTestDeadline<T>(send: Promise<T>, onTimeout: () => void): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(Object.assign(new Error('the test send ran past its deadline'), { code: 'ETIMEDOUT' }));
    }, TEST_SEND_DEADLINE_MS);
  });
  try {
    // why: the send that loses the race settles later into this race's own handlers, never unhandled
    return await Promise.race([send, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The one-a-minute limit on test sends, with its in-flight guard (V7). Settings plan ruling 11: one limit for the
 * process (TEST_SEND_LIMIT), shared by the alerts test (`EmailNotifier.sendTest`) and the Settings page's test
 * (`sendTestEmail`), and kept across a restart in place, which builds a new notifier.
 */
export class TestSendLimit {
  #testing = false;
  #lastAt = Number.NEGATIVE_INFINITY;

  /** Takes the one slot at `nowMs`: false while a test is in flight or within a minute of the last; else true. */
  take(nowMs: number): boolean {
    if (this.#testing || nowMs - this.#lastAt < TEST_EMAIL_MIN_GAP_MS) return false;
    this.#testing = true;
    this.#lastAt = nowMs;
    return true;
  }

  /** The test taken has finished, sent or not. */
  release(): void {
    this.#testing = false;
  }
}

/** The process's one test-send limit (settings plan ruling 11). */
export const TEST_SEND_LIMIT = new TestSendLimit();

/** Why a test send failed, in one of four fixed words (settings plan ruling 11); never the server's reply. */
export type TestSendFailure = 'refused' | 'timed-out' | 'sign-in-refused' | 'not-a-mail-server';

/**
 * A failed send's fixed reason from nodemailer's codes alone (its own `code`, and `originalCode`, the system code it
 * replaced): a refused sign-in; a timeout; a connection refused or a name that does not resolve (the server cannot be
 * reached); anything else (no greeting, a TLS or protocol failure) is not a mail server.
 */
export function testSendFailureOf(err: unknown): TestSendFailure {
  const { code } = failureCodes(err);
  const original =
    typeof err === 'object' && err !== null && 'originalCode' in err && typeof err.originalCode === 'string'
      ? err.originalCode
      : null;
  const codes = [code, original];
  if (codes.includes('EAUTH')) return 'sign-in-refused';
  if (codes.includes('ETIMEDOUT')) return 'timed-out';
  if (codes.some((c) => c === 'ECONNREFUSED' || c === 'EDNS' || c === 'ENOTFOUND' || c === 'EHOSTUNREACH'))
    return 'refused';
  return 'not-a-mail-server';
}

/**
 * Settings plan ruling 11 (`POST /api/settings/email-test`): the fixed test message through the server the form names,
 * with TEST_SEND_TIMEOUTS, inside the process's one test limit (`limited` while a test is in flight or within a minute
 * of the last). A failure answers one of four fixed reasons; only nodemailer's codes are logged, never its message, the
 * reply, the user or the password.
 */
export async function sendTestEmail(o: {
  smtp: SmtpConfig;
  nodeEnv: Config['nodeEnv'];
  log: Logger;
  clock: Clock;
  limit?: TestSendLimit;
  createTransport?: TransportFactory;
}): Promise<{ result: 'sent' } | { result: 'limited' } | { result: 'failed'; reason: TestSendFailure }> {
  const limit = o.limit ?? TEST_SEND_LIMIT;
  if (!limit.take(Date.parse(o.clock.now()))) return { result: 'limited' };
  const log = o.log.child({ notifier: 'email' });
  try {
    const options = { ...smtpTransportOptions(o.smtp, o.nodeEnv), ...TEST_SEND_TIMEOUTS };
    const transport = (o.createTransport ?? defaultFactory)(options);
    await withinTestDeadline(
      transport.sendMail({
        from: o.smtp.from,
        to: o.smtp.to,
        subject: TEST_EMAIL_SUBJECT,
        text: TEST_EMAIL_BODY,
      }),
      () => transport.close?.(),
    );
    log.info({}, 'settings test email sent');
    return { result: 'sent' };
  } catch (err) {
    const reason = testSendFailureOf(err);
    log.warn({ ...failureCodes(err), reason }, 'settings test email not sent');
    return { result: 'failed', reason };
  } finally {
    limit.release();
  }
}

export interface EmailNotifierOptions {
  smtp: SmtpConfig;
  nodeEnv: Config['nodeEnv'];
  log: Logger;
  clock: Clock;
  /** ALERT_EMAIL_MAX_PER_HOUR (decision 56). */
  maxPerHour: number;
  createTransport?: TransportFactory;
  /** The test-send limit; the process's one (TEST_SEND_LIMIT) unless a test passes its own. */
  testLimit?: TestSendLimit;
}

/** Sends alert digests and operator messages as plain-text email. Spec §8.3. */
export class EmailNotifier implements Notifier {
  readonly id = 'email';
  readonly #transport: MailTransport;
  readonly #smtp: SmtpConfig;
  readonly #log: Logger;
  readonly #clock: Clock;
  readonly #maxPerHour: number;
  /**
   * Instants of the sends in the last hour that succeeded or are in flight (in process; a restart starts a fresh hour).
   * A send takes its slot before it starts, so concurrent sends stop at the ceiling, and gives it back when it fails.
   */
  #recent: IsoDateTime[] = [];
  #last: { at: IsoDateTime; kind: string; result: 'sent' | 'refused' | 'failed' } | null = null;
  readonly #testLimit: TestSendLimit;

  constructor(opts: EmailNotifierOptions) {
    // why: defence in depth for sec-001 — core's config already refuses anything but one mailbox per address
    if (!isMailbox(opts.smtp.to) || !isMailbox(opts.smtp.from))
      throw new Error('EmailNotifier: ALERT_EMAIL_TO and ALERT_EMAIL_FROM must each be one email address');
    this.#smtp = opts.smtp;
    this.#log = opts.log.child({ notifier: 'email' });
    this.#clock = opts.clock;
    this.#maxPerHour = opts.maxPerHour;
    this.#testLimit = opts.testLimit ?? TEST_SEND_LIMIT;
    this.#transport = (opts.createTransport ?? defaultFactory)(smtpTransportOptions(opts.smtp, opts.nodeEnv));
  }

  async send(msg: Parameters<Notifier['send']>[0]): Promise<{ ok: boolean; detail?: string }> {
    // why: spec §5.5 — notifiers refuse synthetic rows; the same check and answer as WP7's LogNotifier.
    if (containsSynthetic(msg))
      return { ok: false, detail: 'synthetic data is never delivered by a notifier' };
    // why: the digest and operator variants carry a subject and a body; the system variant has both beside its kind
    const subject = stripControl(
      msg.kind === 'digest' ? msg.subject : msg.kind === 'operator' ? msg.message.subject : msg.subject,
    );
    const body = msg.kind === 'digest' ? msg.body : msg.kind === 'operator' ? msg.message.body : msg.body;
    const r = await this.#deliver(msg.kind, subject, body, true);
    return r.result === 'sent' ? { ok: true } : { ok: false, detail: r.detail };
  }

  /**
   * V7 (spec §10, brief §6 email): the newest send of any kind since the app started (an alert digest, an operator or
   * system notice, or a test), its class only: `sent`, `refused` at the hourly ceiling, or `failed`. Null before any.
   */
  lastResult(): { at: IsoDateTime; kind: string; result: 'sent' | 'refused' | 'failed' } | null {
    return this.#last;
  }

  /**
   * Spec §10 `POST /alerts/test-email`: sends the one fixed test message through the same transport as any other mail, but
   * apart from the alert ceiling: a test has its own limit (one every TEST_EMAIL_MIN_GAP_MS) and an in-flight guard,
   * the process's one, shared with the Settings page's test (settings plan ruling 11). The
   * answer is a class only: `sent`; `refused` for a test sent too soon after the last or one already in flight (the route
   * answers 429); `failed`. The server's text is logged scrubbed and never returned.
   */
  async sendTest(): Promise<'sent' | 'refused' | 'failed'> {
    // why: V7 (sec-b1-001): a test send has its own small limit and an in-flight guard, and never draws on the alert
    // ceiling, so pressing the button cannot crowd out a price alert or a consent notice
    if (!this.#testLimit.take(Date.parse(this.#clock.now()))) return 'refused';
    try {
      // why: bounded as the Settings test is (TEST_SEND_DEADLINE_MS); the transport is the alerts' own, so it is not
      // closed: the late send ends by its own timeouts and only the limit is handed back
      return (
        await withinTestDeadline(
          this.#deliver('test', TEST_EMAIL_SUBJECT, TEST_EMAIL_BODY, false),
          () => undefined,
        )
      ).result;
    } catch {
      this.#log.warn({ code: 'ETIMEDOUT', deadlineMs: TEST_SEND_DEADLINE_MS }, 'test email not sent');
      this.#last = { at: this.#clock.now(), kind: 'test', result: 'failed' };
      return 'failed';
    } finally {
      this.#testLimit.release();
    }
  }

  async #deliver(
    kind: string,
    subject: string,
    body: string,
    countsTowardCeiling: boolean,
  ): Promise<{ result: 'sent'; detail?: undefined } | { result: 'refused' | 'failed'; detail: string }> {
    const r = await this.#attempt(kind, subject, body, countsTowardCeiling);
    this.#last = { at: this.#clock.now(), kind, result: r.result };
    return r;
  }

  async #attempt(
    kind: string,
    subject: string,
    body: string,
    countsTowardCeiling: boolean,
  ): Promise<{ result: 'sent'; detail?: undefined } | { result: 'refused' | 'failed'; detail: string }> {
    const now = this.#clock.now();
    this.#recent = this.#recent.filter((t) => Date.parse(now) - Date.parse(t) < HOUR_MS);
    if (countsTowardCeiling && this.#recent.length >= this.#maxPerHour) {
      // why: decision 56 — beyond the ceiling a message is logged and dropped; a digest's events stay queued for the next pass
      this.#log.warn(
        { kind, subject, maxPerHour: this.#maxPerHour },
        'email ceiling reached; message dropped',
      );
      return {
        result: 'refused',
        detail: `outgoing email ceiling reached (${this.#maxPerHour} per hour); message dropped`,
      };
    }
    if (countsTowardCeiling) this.#recent.push(now);
    const mail: MailMessage = { from: this.#smtp.from, to: this.#smtp.to, subject, text: plainText(body) };
    try {
      const info = await this.#transport.sendMail(mail);
      this.#log.info({ messageId: info.messageId }, 'email sent');
      return { result: 'sent' };
    } catch (err) {
      // why: spec §12 — the ceiling counts delivered mail. A failed send returns its slot, so a run of SMTP failures
      // never turns later sends into "ceiling reached" and hides the real cause; retries stay bounded by the alert
      // passes, which follow executions (CodeRabbit batch 3).
      const slot = countsTowardCeiling ? this.#recent.indexOf(now) : -1;
      if (slot !== -1) this.#recent.splice(slot, 1);
      this.#log.warn(failureCodes(err), 'email not sent');
      return { result: 'failed', detail: this.#detail(err) };
    }
  }

  /**
   * The failure for the event reason (spec §5.3): the SMTP password scrubbed and URLs stripped; when scrubbing itself
   * refuses (a secret form it cannot remove), a fixed text, so `send` still answers instead of rejecting (sec-002).
   * The SMTP user is an account name, not a secret, and may appear.
   */
  #detail(err: unknown): string {
    try {
      return stripUrlsInText(
        scrubSecrets(err instanceof Error ? err.message : String(err), [this.#smtp.pass]),
      );
    } catch {
      // why: decision 59 — no silent catch: the operator needs to know a failure detail was withheld
      this.#log.warn({ code: 'scrub_refused' }, 'email failure detail withheld');
      return 'smtp send failed; detail withheld';
    }
  }
}
