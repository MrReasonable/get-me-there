// Spec §5.3: "the sentinel-key test … asserts none appears in any … fixture file"; CI runs the same scan over
// fixtures/. The WP0 scan runs with the sentinels in its environment over (a) a tree just recorded through the real
// recorder with sentinel keys, (b) that tree with a planted sentinel, (c) the committed tree — which proves only the
// shape rules there, since CI has no real keys; the real-value scan is the operator gate of Task 12b (sec-004).
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { secretForms } from '@gmt/providers';
import { describe, expect, it } from 'vitest';
import { SENTINEL_AUTH, SENTINEL_SA, SENTINEL_SMTP, SENTINEL_TP } from '../helpers/env.js';
import { runRecording } from '../helpers/recording.js';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const SCAN = join(REPO, 'scripts', 'secret-scan.mjs');
const SENTINEL_ENV = {
  PATH: process.env.PATH ?? '',
  SEARCHAPI_KEY: SENTINEL_SA,
  TRAVELPAYOUTS_TOKEN: SENTINEL_TP,
  SMTP_PASS: SENTINEL_SMTP,
  APP_BASIC_AUTH_PASS: SENTINEL_AUTH,
};

function scan(cwd: string, env: Record<string, string> = SENTINEL_ENV) {
  return spawnSync(process.execPath, [SCAN], { cwd, env, encoding: 'utf8', timeout: 30_000 });
}

describe('no key reaches any recorded file (spec §5.3 sentinel test)', () => {
  it('a tree recorded with sentinel keys, raw bodies included, is clean; planting a sentinel makes the scan fail without printing it', async () => {
    const run = await runRecording();
    const clean = scan(run.repo);
    expect(clean.stdout).toContain('secret scan: checked 4 configured secret value(s)');
    expect(clean.stdout).toContain('secret scan: clean');
    expect(clean.status).toBe(0);
    const plantDir = join(run.root, 'planted');
    mkdirSync(plantDir, { recursive: true });
    writeFileSync(join(plantDir, 'p.json'), JSON.stringify({ leaked: SENTINEL_SA }));
    const dirty = scan(run.repo);
    expect(dirty.status).toBe(1);
    expect(dirty.stderr).toContain('secret value found');
    expect(dirty.stderr).not.toContain(SENTINEL_SA);
  });

  it("every encoded form WP4's scrubber knows (secretForms) also fails the scan: one shared list (sec minor 2, N-1)", async () => {
    const run = await runRecording();
    const forms = [
      ...new Set([SENTINEL_SA, SENTINEL_TP, SENTINEL_SMTP, SENTINEL_AUTH].flatMap((v) => secretForms(v))),
    ];
    // why: the padded and unpadded base64 forms differ for these values, so the list is not just the raw value
    expect(forms.length).toBeGreaterThan(8);
    for (const [i, form] of forms.entries()) {
      const dir = join(run.root, `encoded-${i}`);
      mkdirSync(dir, { recursive: true });
      // why: written raw, not JSON-encoded, so the planted text is exactly the form
      writeFileSync(join(dir, 'p.txt'), `leaked: ${form}\n`);
      const r = scan(run.repo);
      expect(r.status, form).toBe(1);
      expect(r.stderr).not.toContain(form);
      rmSync(dir, { recursive: true });
    }
  });

  it('with no secret loaded it still passes, but says that only the shape rules ran (sec minor 2)', () => {
    const r = scan(REPO, { PATH: process.env.PATH ?? '' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('secret scan: checked 0 configured secret value(s)');
    expect(r.stderr).toContain('no configured secret value is loaded');
  });

  it('the committed fixture tree passes the shape rules (the real-value scan is the operator gate in Task 12b)', () => {
    const r = scan(REPO);
    expect(r.stdout).toContain('secret scan: clean');
    expect(r.status).toBe(0);
  });

  // why: plan decision 61 — recorded vendor responses (raw or redacted) are not ours to republish, so git
  // ignores them all; only our own parameter allowlists stay trackable.
  it('raw and redacted recordings are ignored by git; parameter allowlists are not', () => {
    const base = 'packages/providers/fixtures/recorded/searchapi/_api_v1_search/2026-10-20-0123456789ab';
    const ignored = (p: string) => spawnSync('git', ['check-ignore', '-q', p], { cwd: REPO }).status;
    expect(ignored(`${base}.raw.json`)).toBe(0);
    expect(ignored(`${base}.json`)).toBe(0);
    expect(ignored('packages/providers/fixtures/recorded/searchapi/params-2026-10-20.json')).toBe(1);
  });
});
