import { describe, expect, it } from 'vitest';
import { currentPlatform } from '../../src/platform/current.js';
import { type Answers, defaultAnswers } from '../../src/setup/answers.js';
import { answersFromConfig, entriesFor, readSettings, renderAppEnv } from '../../src/setup/appEnv.js';

// why: U9 (ca-b1-012): an existing app.env is read back through core's parseConfig, so the CLI takes the app's own
// defaults and rules (port, time zone, AUTO_RESUME, SMTP TLS) rather than copies of them
const p = currentPlatform({ platform: 'darwin', arch: 'arm64', uid: 501, env: { HOME: '/Users/op' } });
const PASS = 'Abcdefghijklmnopqrstuvwxyz012345';
const text = (a: Answers) => renderAppEnv(entriesFor(a, { paths: p.paths, password: PASS }));
const base = defaultAnswers({ port: 3917, timezone: 'UTC' });

describe('readSettings and answersFromConfig', () => {
  it('a file the wizard wrote reads back to the same answers', () => {
    const full: Answers = {
      ...base,
      travelpayouts: { token: 'tp-token-0123456789' },
      searchApi: { plan: 'trial', key: 'sa-key-0123456789', billingDay: 4, trialUsed: 9 },
      email: {
        host: 'smtp.example.com',
        port: 587,
        tls: 'starttls',
        user: 'me',
        pass: 'p-0123456789',
        to: 'a@example.com',
        from: 'b@example.com',
      },
      browser: { window: 'any' },
    };
    for (const a of [base, full]) {
      const s = readSettings(text(a));
      if (!s.ok) throw new Error(s.fields.join(','));
      expect(answersFromConfig(s.config, s.record, { linger: 'skip' })).toEqual(a);
    }
  });
  it('takes the app’s defaults and AUTO_RESUME from the config', () => {
    const s = readSettings(`DATABASE_PATH="/d.db"\nBIND_ADDRESS="127.0.0.1"\nAUTO_RESUME=false\n`);
    if (!s.ok) throw new Error(s.fields.join(','));
    expect([s.config.port, s.config.autoResume, s.config.schedulerTimezone]).toEqual([
      3000,
      false,
      'Europe/London',
    ]);
    expect(answersFromConfig(s.config, s.record, { linger: 'enable' })).toMatchObject({
      port: 3000,
      timezone: 'Europe/London',
      linger: 'enable',
    });
  });
  it('a file the app would refuse is reported by its fields, never guessed from', () => {
    expect(readSettings('PORT=99999\nBIND_ADDRESS="127.0.0.1"\n')).toEqual({
      ok: false,
      fields: ['DATABASE_PATH', 'PORT'],
      record: { PORT: '99999', BIND_ADDRESS: '127.0.0.1' },
    });
  });
});
