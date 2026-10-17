import { Socket } from 'node:net';
import { asIsoDateTime, fixedClock, type OperatorMessage, Secret } from '@gmt/core';
import nodemailer from 'nodemailer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { renderBody, renderSubject } from '../../src/alerts/templates.js';
import {
  EmailNotifier,
  type EmailNotifierOptions,
  type MailMessage,
  SMTP_TIMEOUTS,
  type SmtpConfig,
  type SmtpTransportOptions,
  smtpTransportOptions,
  type TransportFactory,
} from '../../src/notifiers/email.js';
import { buildNotifiers } from '../../src/notifiers/index.js';
import { calendarItem, digestOf, HASH, NOW, renderInput, verifiedItem } from '../alerts/builders.js';
import { captureLogger } from '../alerts/fixtures.js';

// Engine tests make no outbound connection (plan decisions 18, 20: test/support/setup.ts refuses DNS and unmatched
// requests); the transport is nodemailer's jsonTransport, and buildNotifiers is checked to open no socket.
const PASS = 'test-smtp-pass-0123456789abcdef';
const smtp = (over: Partial<SmtpConfig> = {}): SmtpConfig => ({
  host: 'smtp.example.com',
  port: 465,
  tls: 'implicit',
  user: 'alerts',
  pass: new Secret(PASS),
  to: 'operator@example.com',
  from: 'get-me-there@example.com',
  ...over,
});
const AUTH = { user: 'alerts', pass: PASS };
/** nodemailer's jsonTransport message (info.message), parsed rather than cast. */
const jsonMessage = z.object({
  subject: z.string(),
  text: z.string(),
  html: z.unknown().optional(),
  headers: z.record(z.string(), z.unknown()).optional(),
  bcc: z.unknown().optional(),
});

/** A factory that records the SMTP options and sends through nodemailer's jsonTransport. */
function jsonFactory() {
  const options: SmtpTransportOptions[] = [];
  const messages: Array<{
    envelope: { from: string | false; to: string[] };
    parsed: z.output<typeof jsonMessage>;
  }> = [];
  const factory: TransportFactory = (o) => {
    options.push(o);
    const json = nodemailer.createTransport({ jsonTransport: true });
    return {
      async sendMail(m: MailMessage) {
        const info = await json.sendMail(m);
        messages.push({
          envelope: { from: info.envelope.from, to: info.envelope.to },
          parsed: jsonMessage.parse(JSON.parse(String(info.message))),
        });
        return { messageId: info.messageId };
      },
    };
  };
  return { factory, options, messages };
}

function notifier(over: Partial<EmailNotifierOptions> = {}) {
  const t = jsonFactory();
  const log = captureLogger();
  const clock = fixedClock(NOW);
  const n = new EmailNotifier({
    smtp: smtp(),
    nodeEnv: 'production',
    log,
    clock,
    maxPerHour: 20,
    createTransport: t.factory,
    ...over,
  });
  return { n, t, log, clock };
}

function digestMessage(items = [verifiedItem()]) {
  const input = renderInput({ digest: digestOf(items) });
  const first = items[0] ?? verifiedItem();
  return {
    kind: 'digest' as const,
    digest: input.digest,
    subject: renderSubject(first, NOW),
    body: renderBody(input),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SMTP_TLS → transport options (spec §8.3; review TS-17, sec-006, arch-wp11-004)', () => {
  it('implicit → secure from connect, with the explicit timeouts and no tls override', () => {
    const o = smtpTransportOptions(smtp(), 'production');
    expect(o).toEqual({ host: 'smtp.example.com', port: 465, secure: true, auth: AUTH, ...SMTP_TIMEOUTS });
    expect(o).not.toHaveProperty('tls');
    expect(SMTP_TIMEOUTS).toEqual({
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    });
  });
  it('starttls → requireTLS (the upgrade is mandatory)', () => {
    expect(smtpTransportOptions(smtp({ tls: 'starttls', port: 587 }), 'production')).toEqual({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: AUTH,
      ...SMTP_TIMEOUTS,
    });
  });
  it.each([
    ['localhost', 'production'],
    ['127.0.0.1', 'production'],
    ['127.0.0.2', 'test'],
    ['::1', 'production'],
    ['mailpit', 'development'],
  ] as const)('none is allowed for %s under %s, and never attempts STARTTLS', (host, env) => {
    expect(smtpTransportOptions(smtp({ tls: 'none', host, port: 1025 }), env)).toMatchObject({
      secure: false,
      ignoreTLS: true,
    });
  });
  it.each([
    ['mailpit', 'production'],
    ['mailpit', 'test'],
    ['smtp.example.com', 'development'],
    ['127.evil.example', 'production'],
    ['localhost.evil.example', 'production'],
    ['127.0.0.1.evil.example', 'production'],
    ['[::1]', 'production'],
    ['LOCALHOST', 'production'],
  ] as const)('none is refused for %s under %s', (host, env) => {
    expect(() => smtpTransportOptions(smtp({ tls: 'none', host }), env)).toThrow(/SMTP_TLS=none/);
  });
});

describe('EmailNotifier with a jsonTransport (spec §8.3)', () => {
  it('envelope, exact subject and a plain-text body with provenance, coverage caveat and a validated link', async () => {
    const { n, t } = notifier();
    expect(await n.send(digestMessage())).toEqual({ ok: true });
    expect(t.options[0]).toMatchObject({ secure: true, ...SMTP_TIMEOUTS });
    const [m] = t.messages;
    expect(m?.envelope).toEqual({ from: 'get-me-there@example.com', to: ['operator@example.com'] });
    expect(m?.parsed.subject).toBe(
      "[get-me-there] £412 LHR→JFK 14 Mar–28 Mar (14n) · Google Flights via SearchApi · fetched 5h ago · vendor's cache age unknown · 1 constraint unverified",
    );
    expect(m?.parsed.html).toBeUndefined();
    expect(m?.parsed.text).toContain(
      "   Provenance: Google Flights via SearchApi · fetched 5h ago · vendor's cache age unknown",
    );
    expect(m?.parsed.text).toContain('Coverage: itinerary-searched 3 of 10 cells, 2 outbounds each');
    expect(m?.parsed.text).toContain(
      '   Link: https://www.google.com/travel/clk?tfs=abc (host www.google.com, expires in 3h)',
    );
  });

  it('a POST booking links to the app results row instead', async () => {
    const { n, t } = notifier();
    await n.send(
      digestMessage([
        verifiedItem({
          booking: {
            kind: 'post',
            url: 'https://www.google.com/travel/clk/f',
            postData: 'x=1',
            host: 'www.google.com',
          },
        }),
      ]),
    );
    expect(t.messages[0]?.parsed.text).toContain(`/?view=results&def=def-1&basis=verified&row=${HASH}`);
  });

  it('refuses synthetic rows before anything is sent', async () => {
    const { n, t } = notifier();
    const synthetic = calendarItem({
      provenance: { ...calendarItem().provenance, providerId: 'fixture', sourceKind: 'synthetic' },
    });
    const msg = {
      kind: 'digest' as const,
      digest: digestOf([calendarItem()], { newItems: [synthetic] }),
      subject: 's',
      body: 'b',
    };
    expect(await n.send(msg)).toEqual({
      ok: false,
      detail: 'synthetic data is never delivered by a notifier',
    });
    expect(t.messages).toHaveLength(0);
  });

  it('a digest with a hostile seller, carrier and booking host: exact subject, no extra header (review TS-9)', async () => {
    const { n, t } = notifier();
    const hostile = verifiedItem({
      seller: 'Cheap\r\nBcc: victim@example.org',
      booking: {
        kind: 'get',
        url: 'https://www.google.com/travel/clk?tfs=abc',
        host: 'www.google.com\r\nBcc: x@example.org',
      },
    });
    await n.send(digestMessage([hostile]));
    const parsed = t.messages[0]?.parsed;
    expect(parsed?.subject).toBe(
      "[get-me-there] £412 LHR→JFK 14 Mar–28 Mar (14n) · Google Flights via SearchApi · fetched 5h ago · vendor's cache age unknown · 1 constraint unverified",
    );
    expect(parsed?.bcc).toBeUndefined();
    expect(Object.keys(parsed?.headers ?? {})).toEqual([]);
    expect(parsed?.text).toContain('   Seller: Cheap Bcc: victim@example.org');
    expect(parsed?.text).toContain('Link: none (the stored link failed validation)');
  });

  it('an operator message with every kind of control character: exact subject, LF-only body with its indentation kept (review TS-14)', async () => {
    const { n, t } = notifier();
    const message: OperatorMessage = {
      kind: 'paused_error',
      executionId: 'ex-1',
      definitionId: 'def-1',
      subject: '[get-me-there] paused\r\nBcc: victim@example.org\u0000\u007F\u0085\u2028\u202E\u200B\uFEFF!',
      body: 'line one\r\n   line two\u0007\rline three\nline four\u2029end',
    };
    await n.send({ kind: 'operator', message });
    expect(t.messages[0]?.parsed.subject).toBe('[get-me-there] paused Bcc: victim@example.org !');
    expect(t.messages[0]?.parsed.text).toBe('line one\n   line two \nline three\nline four end');
  });

  it('refuses at construction an address that is not one mailbox (review sec-001)', () => {
    for (const to of [
      'a@example.com, b@example.org',
      'ops@example.com\r\nBcc: x@example.org',
      'Ops <ops@example.com>',
    ])
      expect(() => notifier({ smtp: smtp({ to }) })).toThrow(/one email address/);
    expect(() => notifier({ smtp: smtp({ from: 'a@example.com;b@example.org' }) })).toThrow(
      /one email address/,
    );
  });

  it(`sends at most ALERT_EMAIL_MAX_PER_HOUR in any hour; beyond it the message is logged and dropped (decision 56)`, async () => {
    const { n, t, log, clock } = notifier({ maxPerHour: 2 });
    expect((await n.send(digestMessage())).ok).toBe(true);
    clock.advance(30 * 60_000);
    expect((await n.send(digestMessage())).ok).toBe(true);
    expect(await n.send(digestMessage())).toEqual({
      ok: false,
      detail: 'outgoing email ceiling reached (2 per hour); message dropped',
    });
    expect(t.messages).toHaveLength(2);
    expect(
      log.lines.some((l) => l.level === 'warn' && l.msg === 'email ceiling reached; message dropped'),
    ).toBe(true);
    clock.set(asIsoDateTime('2026-10-14T16:00:00.000Z')); // the first send is now an hour old
    expect((await n.send(digestMessage())).ok).toBe(true);
    expect(t.messages).toHaveLength(3);
  });

  it('a transport failure returns ok:false; the password reaches neither the detail nor the log, and the log holds codes only (review sec-008)', async () => {
    const log = captureLogger();
    const failing: TransportFactory = () => ({
      sendMail: async () => {
        throw Object.assign(
          new Error(
            `535 authentication failed for alerts:${PASS} at https://smtp.example.com/x?token=${PASS}`,
          ),
          {
            code: 'EAUTH',
            responseCode: 535,
          },
        );
      },
    });
    const { n } = notifier({ log, createTransport: failing });
    const msg = digestMessage();
    const r = await n.send(msg);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('535 authentication failed');
    expect(r.detail).not.toContain(PASS);
    expect(r.detail).not.toContain('token=');
    const warn = log.lines.find((l) => l.msg === 'email not sent');
    expect(warn?.fields).toMatchObject({ code: 'EAUTH', responseCode: 535 });
    const all = JSON.stringify(log.lines);
    expect(all).not.toContain(PASS);
    expect(all).not.toContain('535 authentication failed');
    expect(all).not.toContain('Seller: British Airways'); // the body is never logged
  });

  it('when scrubSecrets throws (a secret survived it), send still answers ok:false with a fixed detail (review sec-002)', async () => {
    const failing: TransportFactory = () => ({
      sendMail: async () => {
        throw new Error('535 refused');
      },
    });
    const providers = await import('@gmt/providers');
    vi.spyOn(providers, 'scrubSecrets').mockImplementation(() => {
      throw new Error('scrubSecrets: a secret survived scrubbing');
    });
    const log = captureLogger();
    const { n } = notifier({ log, createTransport: failing });
    expect(await n.send(digestMessage())).toEqual({ ok: false, detail: 'smtp send failed; detail withheld' });
    expect(log.lines.find((l) => l.msg === 'email failure detail withheld')?.fields).toMatchObject({
      code: 'scrub_refused',
    });
  });
});

describe('buildNotifiers', () => {
  it('log only without SMTP; log and email with it; creating the transporter opens no connection', () => {
    const connect = vi.spyOn(Socket.prototype, 'connect');
    const clock = fixedClock(NOW);
    expect(
      buildNotifiers(
        { smtp: null, nodeEnv: 'production', alertEmailMaxPerHour: 20 },
        captureLogger(),
        clock,
      ).map((n) => n.id),
    ).toEqual(['log']);
    expect(
      buildNotifiers(
        { smtp: smtp(), nodeEnv: 'production', alertEmailMaxPerHour: 20 },
        captureLogger(),
        clock,
      ).map((n) => n.id),
    ).toEqual(['log', 'email']);
    expect(connect).not.toHaveBeenCalled();
  });
});
