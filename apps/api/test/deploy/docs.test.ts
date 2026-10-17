// Spec §1, §11, §13 and plan decisions 26, 36, 61: the operator docs carry the importable London → New York example
// and no other route, the plan's single exit-code table as the code defines it, and no banned word.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { apiContract, BANNED_WORD_ALLOWLIST, findBannedWords } from '@gmt/core';
import { AIRPORTS_DATA_DIR, loadAirportsDataset } from '@gmt/db';
import { describe, expect, it } from 'vitest';
import { EXIT } from '../../src/tools/types.js';
import { between, REPO, read } from './files.js';

/** Operator-facing docs, held to the spec §11 word list and to the worked example. */
const OPERATOR_DOCS = ['api-limits.md', 'scheduling.md', 'setup.md'];
/** Research notes that quote vendor terminology verbatim; not operator-facing text. */
const RESEARCH_NOTES = ['providers.md'];
/** The worked example's airports and their metro codes: the only places the docs may name (spec §1). */
const WORKED_EXAMPLE = ['LHR', 'LGW', 'JFK', 'EWR', 'LON', 'NYC'];
/** Capitalised words in the docs that happen to be IATA codes too; extend only with a word, never a place. */
const NOT_PLACES = ['API', 'DIR', 'GBP', 'GET', 'PWD', 'TLS', 'VPS', 'WAL'];

const example: unknown = JSON.parse(read('docs/examples/london-new-york.json'));

describe('the example definition (spec §1, §11)', () => {
  it('parses with definitionCreateRequestSchema', () => {
    const r = apiContract.definitionCreateRequestSchema.safeParse(example);
    expect(r.success ? [] : r.error.issues).toEqual([]);
  });

  it('is the worked example with the spec §11 form defaults and the 40usd preset budget', () => {
    expect(example).toMatchObject({
      origins: ['LHR', 'LGW'],
      destinations: ['JFK', 'EWR'],
      window: { kind: 'relative', startOffsetDays: 7, lengthDays: 182 },
      minNights: 10,
      maxNights: 21,
      cabin: 'economy',
      verification: { maxCells: 10, topN: 10, expandTop: 2, bookingLinks: true, alwaysInclude: [] },
      budget: { maxCalls: 2000, maxFreeCalls: 2000, maxCostMicroGbp: 0 },
      providers: { discoveryRefreshHours: { travelpayouts: 168, searchapi: 168 } },
      scheduleCron: '0 5 * * 1',
      scheduleTz: 'Europe/London',
    });
  });

  it('the JSON block in setup.md is exactly docs/examples/london-new-york.json, byte for byte', () => {
    const block = between(
      read('docs/setup.md'),
      '<!-- example-definition:start -->\n```json\n',
      '```\n<!-- example-definition:end -->',
    );
    expect(block).toBe(read('docs/examples/london-new-york.json'));
  });
});

describe('docs/setup.md exit codes (the plan’s single table, apps/api EXIT)', () => {
  // why: the smoke test's 2 and 3 are documented by WP13 with its route (decision 63)
  it('lists every code of EXIT and nothing else', () => {
    const table = between(read('docs/setup.md'), '## 10. Exit codes', '\n## 11.');
    const codes = [...table.matchAll(/^\| (\d+) \|/gm)].map((m) => Number(m[1]));
    expect(codes).toEqual([...new Set(Object.values(EXIT))].sort((a, b) => a - b));
  });
});

describe('recorded vendor responses are local-only (decision 61)', () => {
  it('git ignores every recording but our params allowlists, and setup.md says recordings are never committed', () => {
    const lines = read('.gitignore').split('\n');
    expect(lines).toContain('packages/providers/fixtures/recorded/**/*.json');
    expect(lines).toContain('!packages/providers/fixtures/recorded/**/params-*.json');
    const setup = read('docs/setup.md').replace(/\s+/g, ' ');
    expect(setup).toContain('Recorded vendor responses are local-only and never committed');
    expect(setup).toContain('**Publishing the repository.**');
    // why: review sec-001 — the doc gives checks that see tracked files and history, not only the working tree
    expect(setup).toContain('git ls-files packages/providers/fixtures/recorded');
    expect(setup).toContain('git log --all --format= --name-only -- packages/providers/fixtures/recorded');
    for (const file of OPERATOR_DOCS)
      expect(read(`docs/${file}`)).not.toMatch(/private-repo|committed recorded|recorded tree is committed/i);
  });
});

describe('docs/setup.md operations rules (plan decision 63; round-1 review)', () => {
  const setup = read('docs/setup.md');
  const flat = setup.replace(/\s+/g, ' ');

  it('names the commands that destroy the volume and its backups, and the copy off the volume', () => {
    for (const command of [
      'docker compose down -v',
      'docker volume rm get-me-there_gmt-data',
      'docker system prune --volumes',
    ])
      expect(flat).toContain(command);
    expect(flat).toContain('docker compose cp app:/data/backups/. /var/backups/get-me-there/');
    expect(flat).toContain('install -d -m 0700');
  });

  it('turns auth off only through the Tailscale-only override file', () => {
    expect(setup).toContain('ALLOW_UNAUTHENTICATED: "true"');
    expect(setup).toContain('COMPOSE_FILE=docker-compose.yml:tailscale-only.yml');
  });

  it('calls the health check liveness only and says where a degraded app shows', () => {
    expect(flat).toContain('liveness check only, and Docker does not restart an unhealthy container');
    expect(flat).toContain('the status bar shows it and the log records it');
  });

  it('restores through check-backup, keeping the current database aside', () => {
    expect(setup).toContain('scripts/check-backup.mjs /data/restore.db');
    expect(setup).toContain('.pre-restore');
    const heading = 'Restoring a backup resets month-to-date spend';
    expect(read('docs/api-limits.md')).toContain(`## ${heading}`);
    expect(setup).toContain(`("${heading}")`);
  });

  it('puts the Mailpit settings in the shell, never in a dotenv block', () => {
    const dotenvBlocks = [...setup.matchAll(/```dotenv\n([\s\S]*?)```/g)].map((m) => m[1] ?? '');
    expect(dotenvBlocks.some((b) => b.includes('SMTP_TLS=none'))).toBe(false);
    expect(setup).toContain('export SMTP_HOST=127.0.0.1');
  });

  it('uses a placeholder password the config refuses, and a private .env', () => {
    expect(setup).toContain('APP_BASIC_AUTH_PASS=CHANGE-ME');
    expect('CHANGE-ME'.length).toBeLessThan(12);
    expect(setup).toContain('chmod 600 .env');
  });

  it('leaves the smoke test to WP13 (decision 63)', () => {
    expect(setup).not.toMatch(/smoke:live|\/api\/tools\/smoke/);
  });
});

describe('operator docs (spec §11 banned words; spec §1 worked example only)', () => {
  it('covers every docs/*.md: the operator docs and the research notes', () => {
    const all = readdirSync(join(REPO, 'docs'))
      .filter((f) => f.endsWith('.md'))
      .sort();
    expect(all).toEqual([...OPERATOR_DOCS, ...RESEARCH_NOTES].sort());
  });

  it.each(OPERATOR_DOCS)('%s contains no banned word', (file) => {
    const text = read(`docs/${file}`);
    const hits = findBannedWords(text, BANNED_WORD_ALLOWLIST).map(
      (h) => `${h.word} @${h.index}: …${text.slice(Math.max(0, h.index - 30), h.index + 30)}…`,
    );
    expect(hits).toEqual([]);
  });

  it.each([...OPERATOR_DOCS.map((f) => `docs/${f}`), 'docs/examples/london-new-york.json'])(
    '%s names no airport or metro code but the worked example’s',
    (path) => {
      const dataset = loadAirportsDataset(AIRPORTS_DATA_DIR);
      const places = new Set([...dataset.airports.map((a) => a.iata), ...Object.keys(dataset.metros)]);
      const named = [...read(path).matchAll(/\b[A-Z]{3}\b/g)].map((m) => m[0]);
      const others = named.filter(
        (w) => places.has(w) && !WORKED_EXAMPLE.includes(w) && !NOT_PLACES.includes(w),
      );
      expect([...new Set(others)]).toEqual([]);
    },
  );
});
