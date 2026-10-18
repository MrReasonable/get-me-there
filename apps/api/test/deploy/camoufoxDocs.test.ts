// WP14 Task 14.12 (SEC-R2-005, SEC-R2-009, ruling 2): the operator docs for the camoufox provider: the setup section
// keeps the worker key off every command line, says nothing about Linux, and carries the costs and the provenance note
// exactly as the app states them.
import { CAMOUFOX_DISCOVERY_INFO } from '@gmt/providers';
import { beforeEach, describe, expect, it } from 'vitest';
import { read } from './files.js';

const setup = read('docs/setup.md');
const section = setup.slice(setup.indexOf('## 14. The Camoufox provider'));
const providers = read('docs/providers.md');
const limits = read('docs/api-limits.md');
const COSTS = [
  "**Google's terms:**",
  "**The operator's IP and account:**",
  '**Brittleness:**',
  '**Speed:**',
  '**Availability:**',
  '**Image size:**',
  '**The worker key:**',
  '**Money:**',
];
const flat = (s: string) => s.replace(/\s+/g, ' ');

beforeEach(() => {
  expect.hasAssertions();
});

describe('docs/setup.md section 14 (the Camoufox provider)', () => {
  it('has the heading and every step the brief names', () => {
    expect(setup).toContain('## 14. The Camoufox provider (optional, off by default; macOS only)');
    for (const w of [
      'capture-socs',
      'pnpm --filter @gmt/camoufox-worker status',
      'set -a; . ~/.config/get-me-there/dev-camoufox.env; set +a',
      'worker.env',
      'mkdir -p -m 700 ~/.local/state/get-me-there/camoufox',
      'http://host.docker.internal:8090',
      'http://127.0.0.1:8090',
      'Never put that URL in `.env`',
      'launchctl bootout gui/$(id -u)/uk.dominey.get-me-there.camoufox-worker',
      'clear-signed-in',
    ])
      expect(section, w).toContain(w);
    expect(flat(section)).toContain('is stopped only by `CAMOUFOX_WORKER_KEY`');
  });
  it('never puts the key on a command line, and has no Linux, docker0 or systemd setup text', () => {
    expect(setup).not.toMatch(/\$\(grep[^)]*CAMOUFOX_WORKER_KEY/);
    expect(setup).not.toMatch(/export CAMOUFOX_WORKER_KEY=/);
    expect(section).not.toMatch(/CAMOUFOX_WORKER_KEY=[0-9a-f]/);
    for (const bad of ['docker0', 'systemd', 'Linux']) expect(section, bad).not.toContain(bad);
  });
  it('states every cost, the robots.txt disallow and the coverage arithmetic', () => {
    for (const c of COSTS) expect(section, c).toContain(c);
    expect(section).toContain('/travel/flights/search');
    expect(flat(section)).toContain('100 a run and 1,500 a month, against 2,184 day pairs');
  });
});

describe('docs/providers.md and docs/api-limits.md', () => {
  it('each names every cost and the robots.txt path', () => {
    for (const doc of [providers, limits]) {
      for (const c of COSTS) expect(doc, c).toContain(c.slice(0, -3));
      expect(doc).toContain('/travel/flights/search');
    }
  });
  it('providers.md quotes the provenance note exactly and no longer calls the provider unbuilt', () => {
    expect(providers).toContain(`"${CAMOUFOX_DISCOVERY_INFO.provenanceNote}"`);
    expect(providers).not.toContain('Phase 4 continuity fallback only (spec §2); not built');
  });
  it('api-limits.md names both row classes', () => {
    expect(limits).toContain('class\n   `page`');
    expect(limits).toContain('class `no-page`');
  });
  it('no doc offers CAMOFOX_ACCESS_KEY or the camofox-browser REST routes as something to configure', () => {
    for (const doc of [setup, providers, limits, read('docs/scheduling.md')]) {
      expect(doc).not.toContain('CAMOFOX_ACCESS_KEY');
      expect(doc).not.toMatch(/POST \/sessions\//);
    }
  });
});
