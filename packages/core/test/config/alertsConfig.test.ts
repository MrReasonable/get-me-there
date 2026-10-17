import { describe, expect, it } from 'vitest';
import { isMailbox, parseConfig, smtpPlaintextAllowed } from '../../src/config/schema.js';

// Spec §8.3, §12; decision 56 and the WP11 round-1 review (sec-001, sec-004, arch-wp11-007).
const realpath = (p: string) => p;
const minimal = {
  NODE_ENV: 'production',
  DATABASE_PATH: '/data/get-me-there.db',
  APP_BASIC_AUTH_USER: 'ian',
  APP_BASIC_AUTH_PASS: 'correct-horse-battery',
  IN_CONTAINER: '1',
};
const smtp = {
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '465',
  SMTP_USER: 'alerts',
  SMTP_PASS: 'test-smtp-pass-0123456789abcdef',
  ALERT_EMAIL_TO: 'operator@example.com',
  ALERT_EMAIL_FROM: 'get-me-there@example.com',
};
function parse(env: Record<string, string>) {
  return parseConfig({ ...minimal, ...env }, { realpath });
}
function failedFields(env: Record<string, string>): string[] {
  const r = parse(env);
  return r.ok ? [] : r.errors.map((e) => e.field);
}

describe('ALERT_EMAIL_TO and ALERT_EMAIL_FROM are one mailbox each (spec §8.3)', () => {
  it('a plain address is accepted', () => {
    const r = parse(smtp);
    expect(r.ok && r.config.smtp?.to).toBe('operator@example.com');
  });
  it.each([
    ['a list', 'a@example.com, b@example.org'],
    ['a semicolon list', 'a@example.com;b@example.org'],
    ['a display name', 'Ops <ops@example.com>'],
    ['a CRLF header', 'ops@example.com\r\nBcc: victim@example.org'],
    ['a bare LF', 'ops@example.com\nBcc: victim@example.org'],
    ['no domain', 'ops'],
  ])('%s is refused for both fields', (_name, value) => {
    expect(isMailbox(value)).toBe(false);
    expect(failedFields({ ...smtp, ALERT_EMAIL_TO: value })).toEqual(['ALERT_EMAIL_TO']);
    expect(failedFields({ ...smtp, ALERT_EMAIL_FROM: value })).toEqual(['ALERT_EMAIL_FROM']);
  });
});

describe('APP_BASE_URL is an https base with no credentials, query or fragment (spec §12)', () => {
  it.each(['https://gmt.example.ts.net', 'https://gmt.example.ts.net/', 'https://example.org/gmt'])(
    '%s is accepted',
    (v) => {
      const r = parse({ APP_BASE_URL: v });
      expect(r.ok && r.config.appBaseUrl).toBe(v);
    },
  );
  it.each([
    'http://gmt.example.ts.net',
    'https://user:pw@gmt.example.ts.net',
    'https://user@gmt.example.ts.net',
    'https://gmt.example.ts.net/?a=1',
    'https://gmt.example.ts.net/?',
    'https://gmt.example.ts.net/#x',
    'https://gmt.example.ts.net/#',
    'not a url',
  ])('%s is refused', (v) => {
    expect(failedFields({ APP_BASE_URL: v })).toEqual(['APP_BASE_URL']);
  });
});

describe('ALERT_EMAIL_MAX_PER_HOUR (decision 56)', () => {
  it('defaults to 20, takes a positive integer, refuses 0 and fractions', () => {
    const d = parse({});
    expect(d.ok && d.config.alertEmailMaxPerHour).toBe(20);
    const five = parse({ ALERT_EMAIL_MAX_PER_HOUR: '5' });
    expect(five.ok && five.config.alertEmailMaxPerHour).toBe(5);
    expect(failedFields({ ALERT_EMAIL_MAX_PER_HOUR: '0' })).toEqual(['ALERT_EMAIL_MAX_PER_HOUR']);
    expect(failedFields({ ALERT_EMAIL_MAX_PER_HOUR: '2.5' })).toEqual(['ALERT_EMAIL_MAX_PER_HOUR']);
  });
});

describe('smtpPlaintextAllowed: the one SMTP_TLS=none rule (spec §8.3)', () => {
  it.each([
    ['localhost', 'production', true],
    ['127.0.0.1', 'production', true],
    ['127.0.0.2', 'test', true],
    ['::1', 'production', true],
    ['mailpit', 'development', true],
    ['mailpit', 'production', false],
    ['mailpit', 'test', false],
    ['LOCALHOST', 'production', false],
    ['[::1]', 'production', false],
    ['127.evil.example', 'production', false],
    ['localhost.evil.example', 'production', false],
    ['127.0.0.1.evil.example', 'production', false],
    ['evil-localhost', 'production', false],
    ['smtp.example.com', 'development', false],
  ] as const)('%s under %s → %s', (host, env, allowed) => {
    expect(smtpPlaintextAllowed(host, env)).toBe(allowed);
  });
});
