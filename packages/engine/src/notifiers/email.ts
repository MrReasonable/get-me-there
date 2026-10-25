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
/** The one transporter method used; nodemailer's Transporter satisfies it. */
export interface MailTransport {
  sendMail(m: MailMessage): Promise<{ messageId: string }>;
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

export interface EmailNotifierOptions {
  smtp: SmtpConfig;
  nodeEnv: Config['nodeEnv'];
  log: Logger;
  clock: Clock;
  /** ALERT_EMAIL_MAX_PER_HOUR (decision 56). */
  maxPerHour: number;
  createTransport?: TransportFactory;
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

  constructor(opts: EmailNotifierOptions) {
    // why: defence in depth for sec-001 — core's config already refuses anything but one mailbox per address
    if (!isMailbox(opts.smtp.to) || !isMailbox(opts.smtp.from))
      throw new Error('EmailNotifier: ALERT_EMAIL_TO and ALERT_EMAIL_FROM must each be one email address');
    this.#smtp = opts.smtp;
    this.#log = opts.log.child({ notifier: 'email' });
    this.#clock = opts.clock;
    this.#maxPerHour = opts.maxPerHour;
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
    const r = await this.#deliver(msg.kind, subject, body);
    return r.result === 'sent' ? { ok: true } : { ok: false, detail: r.detail };
  }

  /**
   * Spec §10 `POST /alerts/test-email`: sends the one fixed test message through the same ceiling and transport as any
   * other mail. The answer is a class only (`sent`, `refused` at the hourly ceiling, `failed`); the server's text is
   * logged scrubbed and never returned.
   */
  async sendTest(): Promise<'sent' | 'refused' | 'failed'> {
    return (await this.#deliver('test', TEST_EMAIL_SUBJECT, TEST_EMAIL_BODY)).result;
  }

  async #deliver(
    kind: string,
    subject: string,
    body: string,
  ): Promise<{ result: 'sent'; detail?: undefined } | { result: 'refused' | 'failed'; detail: string }> {
    const now = this.#clock.now();
    this.#recent = this.#recent.filter((t) => Date.parse(now) - Date.parse(t) < HOUR_MS);
    if (this.#recent.length >= this.#maxPerHour) {
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
    this.#recent.push(now);
    const mail: MailMessage = { from: this.#smtp.from, to: this.#smtp.to, subject, text: plainText(body) };
    try {
      const info = await this.#transport.sendMail(mail);
      this.#log.info({ messageId: info.messageId }, 'email sent');
      return { result: 'sent' };
    } catch (err) {
      // why: spec §12 — the ceiling counts delivered mail. A failed send returns its slot, so a run of SMTP failures
      // never turns later sends into "ceiling reached" and hides the real cause; retries stay bounded by the alert
      // passes, which follow executions (CodeRabbit batch 3).
      const slot = this.#recent.indexOf(now);
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
