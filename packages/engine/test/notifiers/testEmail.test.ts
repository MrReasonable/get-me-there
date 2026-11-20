// Settings plan ruling 11: the Settings page's test email goes to the server the form names, with 10 s connect, greeting
// and socket timeouts; a failure is one of four fixed reasons, never the server's reply, the user or the password; and
// the one-a-minute test limit is held once for the process, so the alerts test and the Settings test share it.
import { fixedClock, Secret } from '@gmt/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EmailNotifier,
  type MailMessage,
  type SmtpConfig,
  type SmtpTransportOptions,
  sendTestEmail,
  TEST_EMAIL_BODY,
  TEST_EMAIL_MIN_GAP_MS,
  TEST_EMAIL_SUBJECT,
  TEST_SEND_DEADLINE_MS,
  TEST_SEND_LIMIT,
  TEST_SEND_TIMEOUTS,
  TestSendLimit,
  type TransportFactory,
  testSendFailureOf,
} from '../../src/notifiers/email.js';
import { NOW } from '../alerts/builders.js';
import { captureLogger } from '../alerts/fixtures.js';

const PASS = 'test-smtp-pass-for-the-settings-test-0123';
const USER = 'distinct-user-name-for-the-settings-test';
const smtp = (over: Partial<SmtpConfig> = {}): SmtpConfig => ({
  host: 'smtp.example.com',
  port: 465,
  tls: 'implicit',
  user: USER,
  pass: new Secret(PASS),
  to: 'operator@example.com',
  from: 'alerts@example.com',
  ...over,
});

/** A nodemailer-shaped failure: its own code, the system code it replaced, and a reply that echoes the credentials. */
function failure(code: string | null, originalCode?: string): Error {
  return Object.assign(new Error(`535 ${USER} ${PASS} rejected at smtp.example.com`), {
    ...(code === null ? {} : { code }),
    ...(originalCode === undefined ? {} : { originalCode }),
    responseCode: 535,
    response: `535 ${USER} ${PASS}`,
  });
}

/** A transport that records its options and messages, or throws `err` from every send. */
function transport(err?: Error) {
  const options: SmtpTransportOptions[] = [];
  const sent: MailMessage[] = [];
  const factory: TransportFactory = (o) => {
    options.push(o);
    return {
      sendMail: async (m) => {
        if (err !== undefined) throw err;
        sent.push(m);
        return { messageId: 'm' };
      },
    };
  };
  return { factory, options, sent };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('sendTestEmail (settings plan ruling 11)', () => {
  it('sends the fixed test message to the server named, with 10 s connect, greeting and socket timeouts', async () => {
    const t = transport();
    const r = await sendTestEmail({
      smtp: smtp({ host: 'mail.example.org', port: 587, tls: 'starttls' }),
      nodeEnv: 'production',
      log: captureLogger(),
      clock: fixedClock(NOW),
      limit: new TestSendLimit(),
      createTransport: t.factory,
    });
    expect(r).toEqual({ result: 'sent' });
    expect(TEST_SEND_TIMEOUTS).toEqual({
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 10_000,
    });
    expect(t.options).toEqual([
      {
        host: 'mail.example.org',
        port: 587,
        secure: false,
        requireTLS: true,
        auth: { user: USER, pass: PASS },
        ...TEST_SEND_TIMEOUTS,
      },
    ]);
    expect(t.sent).toEqual([
      {
        from: 'alerts@example.com',
        to: 'operator@example.com',
        subject: TEST_EMAIL_SUBJECT,
        text: TEST_EMAIL_BODY,
      },
    ]);
  });

  it.each([
    ['EAUTH', undefined, 'sign-in-refused'],
    ['ETIMEDOUT', undefined, 'timed-out'],
    ['ESOCKET', 'ETIMEDOUT', 'timed-out'],
    ['ESOCKET', 'ECONNREFUSED', 'refused'],
    ['ECONNREFUSED', undefined, 'refused'],
    ['EDNS', 'ENOTFOUND', 'refused'],
    ['EPROTOCOL', undefined, 'not-a-mail-server'],
    ['ETLS', undefined, 'not-a-mail-server'],
    [null, undefined, 'not-a-mail-server'],
  ] as const)(
    'a failure coded %s (%s) is %s, and nothing of the reply reaches the answer or the log',
    async (code, original, reason) => {
      expect(testSendFailureOf(failure(code, original))).toBe(reason);
      const log = captureLogger();
      const r = await sendTestEmail({
        smtp: smtp(),
        nodeEnv: 'production',
        log,
        clock: fixedClock(NOW),
        limit: new TestSendLimit(),
        createTransport: transport(failure(code, original)).factory,
      });
      expect(r).toEqual({ result: 'failed', reason });
      const logged = JSON.stringify(log.lines);
      for (const echoed of [PASS, USER, 'smtp.example.com', '535 ']) expect(logged).not.toContain(echoed);
    },
  );

  it('a second test within a minute, or while one is in flight, is limited; a minute later it goes', async () => {
    const limit = new TestSendLimit();
    const clock = fixedClock(NOW);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held: TransportFactory = () => ({
      sendMail: async () => {
        await gate;
        return { messageId: 'm' };
      },
    });
    const send = (createTransport: TransportFactory) =>
      sendTestEmail({
        smtp: smtp(),
        nodeEnv: 'production',
        log: captureLogger(),
        clock,
        limit,
        createTransport,
      });
    const first = send(held);
    expect(await send(transport().factory)).toEqual({ result: 'limited' });
    // why: a minute on, the first is still in flight: the in-flight guard alone limits this one
    clock.advance(TEST_EMAIL_MIN_GAP_MS);
    expect(await send(transport().factory)).toEqual({ result: 'limited' });
    release();
    expect(await first).toEqual({ result: 'sent' });
    // the first was taken a minute ago and has ended, so this one goes; the next, at once after it, is limited
    expect(await send(transport().factory)).toEqual({ result: 'sent' });
    expect(await send(transport().factory)).toEqual({ result: 'limited' });
    clock.advance(TEST_EMAIL_MIN_GAP_MS);
    expect(await send(transport().factory)).toEqual({ result: 'sent' });
  });

  it('a send still going at its 30 s deadline is timed-out, sent once, and the limit handed back', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    expect(TEST_SEND_DEADLINE_MS).toBe(30_000);
    const limit = new TestSendLimit();
    const clock = fixedClock(NOW);
    let sends = 0;
    // why: the connection is not ended (nodemailer cannot end one in flight); the send is simply never answered
    const trickling: TransportFactory = () => ({
      sendMail: () => {
        sends += 1;
        return new Promise(() => undefined);
      },
    });
    const r = sendTestEmail({
      smtp: smtp(),
      nodeEnv: 'production',
      log: captureLogger(),
      clock,
      limit,
      createTransport: trickling,
    });
    await vi.advanceTimersByTimeAsync(TEST_SEND_DEADLINE_MS - 1);
    // still in flight just before the deadline: the limit is held
    clock.advance(TEST_EMAIL_MIN_GAP_MS);
    expect(limit.take(Date.parse(clock.now()))).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await r).toEqual({ result: 'failed', reason: 'timed-out' });
    expect(sends).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    // the limit is free again (its minute since the take has passed)
    expect(limit.take(Date.parse(clock.now()))).toBe(true);
  });

  it('the alerts test is bounded by the same deadline and hands the limit back', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const limit = new TestSendLimit();
    const clock = fixedClock(NOW);
    const notifier = new EmailNotifier({
      smtp: smtp(),
      nodeEnv: 'production',
      log: captureLogger(),
      clock,
      maxPerHour: 20,
      testLimit: limit,
      createTransport: () => ({ sendMail: () => new Promise(() => undefined) }),
    });
    const r = notifier.sendTest();
    await vi.advanceTimersByTimeAsync(TEST_SEND_DEADLINE_MS);
    expect(await r).toBe('failed');
    expect(notifier.lastResult()).toMatchObject({ kind: 'test', result: 'failed' });
    clock.advance(TEST_EMAIL_MIN_GAP_MS);
    expect(limit.take(Date.parse(clock.now()))).toBe(true);
  });

  it('an alerts test answered after its deadline keeps the failure recorded at the deadline', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const clock = fixedClock(NOW);
    let late: () => void = () => undefined;
    let calls = 0;
    const notifier = new EmailNotifier({
      smtp: smtp(),
      nodeEnv: 'production',
      log: captureLogger(),
      clock,
      maxPerHour: 20,
      testLimit: new TestSendLimit(),
      createTransport: () => ({
        sendMail: () => {
          calls += 1;
          // the first (the test) answers only when the test says; a later send answers at once
          return calls === 1
            ? new Promise((resolve) => {
                late = () => resolve({ messageId: 'late' });
              })
            : Promise.resolve({ messageId: 'next' });
        },
      }),
    });
    const r = notifier.sendTest();
    await vi.advanceTimersByTimeAsync(TEST_SEND_DEADLINE_MS);
    expect(await r).toBe('failed');
    const atDeadline = notifier.lastResult();
    expect(atDeadline).toMatchObject({ kind: 'test', result: 'failed' });
    late();
    await vi.advanceTimersByTimeAsync(0);
    expect(notifier.lastResult()).toEqual(atDeadline);
    // a later send of its own still records its result
    clock.advance(60_000);
    expect(await notifier.send({ kind: 'system', subject: 'notice', body: 'b' })).toEqual({ ok: true });
    expect(notifier.lastResult()).toMatchObject({ kind: 'system', result: 'sent' });
  });

  it('the process holds one limit: the alerts test and the Settings test share it by default', async () => {
    const clock = fixedClock(NOW);
    const notifier = new EmailNotifier({
      smtp: smtp(),
      nodeEnv: 'production',
      log: captureLogger(),
      clock,
      maxPerHour: 20,
      createTransport: transport().factory,
    });
    expect(await notifier.sendTest()).toBe('sent');
    const r = await sendTestEmail({
      smtp: smtp(),
      nodeEnv: 'production',
      log: captureLogger(),
      clock,
      createTransport: transport().factory,
    });
    expect(r).toEqual({ result: 'limited' });
    // why: a second notifier (the next pass of a restart in place builds one) is held by the same limit
    const next = new EmailNotifier({
      smtp: smtp(),
      nodeEnv: 'production',
      log: captureLogger(),
      clock,
      maxPerHour: 20,
      createTransport: transport().factory,
    });
    expect(await next.sendTest()).toBe('refused');
    clock.advance(TEST_EMAIL_MIN_GAP_MS);
    expect(TEST_SEND_LIMIT.take(Date.parse(clock.now()))).toBe(true);
    TEST_SEND_LIMIT.release();
  });
});
