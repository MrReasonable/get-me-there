// Spec §1, §11, §13 and plan decisions 26, 36, 61: the operator docs carry the importable London → New York example
// and no other route, the plan's single exit-code table as the code defines it, and no banned word.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { AUTH_MISSING, apiContract, BANNED_WORD_ALLOWLIST, findBannedWords, parseConfig } from '@gmt/core';
import { AIRPORTS_DATA_DIR, loadAirportsDataset } from '@gmt/db';
import { describe, expect, it } from 'vitest';
import { SHUTDOWN_DEADLINE_MS } from '../../src/bootstrap/app.js';
import { EXIT } from '../../src/tools/types.js';
import { between, REPO, read } from './files.js';

/** Operator-facing docs, held to the spec §11 word list and to the worked example. */
const OPERATOR_DOCS = ['api-limits.md', 'release-notes.md', 'scheduling.md', 'setup.md'];
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

// why: the paths in these checks (/data) do not exist on the test host, and the checks are about other rules
const identity = (p: string): string => p;

/** The environment compose gives the container, reduced to what these checks need. */
function containerEnv(extra: Record<string, string>): Record<string, string> {
  return {
    NODE_ENV: 'production',
    IN_CONTAINER: '1',
    DATABASE_PATH: '/data/get-me-there.db',
    APP_BASIC_AUTH_USER: 'operator',
    APP_BASIC_AUTH_PASS: 'a-long-random-password-0123',
    ...extra,
  };
}

describe('docs/setup.md operations rules (plan decision 63; round-1 review)', () => {
  const setup = read('docs/setup.md');
  const flat = setup.replace(/\s+/g, ' ');
  const composeText = read('docker-compose.yml');

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

  it('every documented `docker compose up --wait` bounds the wait at 120 s and says what to look at then (devops-final-003, ruling 14)', () => {
    const waits = [...setup.matchAll(/docker compose up [^\n`]*--wait\b[^\n`]*/g)].map((m) => m[0]);
    expect(waits.length).toBeGreaterThanOrEqual(4);
    for (const w of waits) expect(w).toContain('--wait --wait-timeout 120');
    expect(flat).toContain('If it has not reported healthy after 2 minutes, run docker compose logs app');
  });

  it("section 1 names the two lines the refusal asks for, in the refusal's own words (devops-final-001, ruling 14)", () => {
    const section1 = setup.slice(setup.indexOf('## 1.'), setup.indexOf('## 2.'));
    expect(section1).toContain(AUTH_MISSING);
  });

  it('explains that trial definitions allow 0 billed calls and how to verify a cell anyway (N3, ruling 9)', () => {
    expect(flat).toContain(
      "On the trial plan new definitions allow 0 billed calls per run, so Verify in the calendar is unavailable until you raise the definition's call cap in Definitions → Run budget (Max billed calls per run); 6 covers one cell.",
    );
    const limits = read('docs/api-limits.md').replace(/\s+/g, ' ');
    expect(limits).not.toContain('that call cap is the only stop');
    expect(limits).toContain(
      "that call cap and each definition's call cap (Max billed calls per run) are the stops",
    );
  });

  it('tells an operator moving to 40usd to remove SEARCHAPI_TRIAL_USED, which otherwise exits 78 (N5, cost-007)', () => {
    expect(flat).toContain(
      'If `.env` has a `SEARCHAPI_TRIAL_USED` line from the trial, delete it (or set it to 0): on `40usd` the app refuses to start with it (exit 78).',
    );
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
    // why: review code-architect M1 — the claim is about the config, so the config parses it (not a literal length)
    const refused = parseConfig(containerEnv({ APP_BASIC_AUTH_PASS: 'CHANGE-ME' }), { realpath: identity });
    expect(refused.ok ? [] : refused.errors.map((e) => e.field)).toContain('APP_BASIC_AUTH_PASS');
    expect(parseConfig(containerEnv({}), { realpath: identity }).ok).toBe(true);
    expect(setup).toContain('chmod 600 .env');
  });

  it('states the real SMTP_TLS=none rule: loopback only, which inside the container is the container itself', () => {
    // why: review code-architect I1 — the config accepts `none` for a loopback host under any NODE_ENV and does not
    // look at IN_CONTAINER, so the docs must not say the container refuses it.
    const mail = {
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: '1025',
      SMTP_TLS: 'none',
      SMTP_USER: 'dev',
      SMTP_PASS: 'dev',
    };
    const to = { ALERT_EMAIL_TO: 'operator@example.com', ALERT_EMAIL_FROM: 'get-me-there@example.com' };
    expect(parseConfig(containerEnv({ ...mail, ...to }), { realpath: identity }).ok).toBe(true);
    expect(flat).not.toContain('is refused in the container');
    expect(flat).not.toContain('the container refuses');
    expect(flat).not.toContain('would exit 78');
    expect(flat).toContain('`SMTP_TLS=none` is accepted only for a loopback host');
    expect(flat).toContain('inside the container, loopback is the container itself');
    expect(flat).toContain('mail fails when it is sent');
  });

  it('gets the pre-migration backup off the volume and tells the cron user how to reach docker', () => {
    // why: review devops M3 and M5
    expect(flat).toContain('run the cron command of section 6 once by hand');
    expect(flat).toContain('The cron user must be in the `docker` group');
  });

  it('documents the in-process shutdown deadline beside the 90 s stale-lock takeover', () => {
    // why: review devops M4 — the deadline (25 s) sits below compose's 30 s grace period
    const seconds = SHUTDOWN_DEADLINE_MS / 1000;
    const section9 = between(setup, '## 9.', '## 10.').replace(/\s+/g, ' ');
    expect(section9).toContain(`${seconds} seconds`);
    expect(section9).toContain('shutdown timed out');
    expect(section9).toContain('exits 1');
    expect(section9).toContain('taking over a stale app_lock');
    expect(composeText).toContain('stop_grace_period: 30s');
    expect(SHUTDOWN_DEADLINE_MS).toBeLessThan(30_000);
  });

  it('documents the smoke test: a dry run first, the route with a prompted password and valid bodies, the budget per database, the command line, where fixtures go (WP13, decision 66)', () => {
    expect(setup).toContain(
      "curl -u operator -H 'Content-Type: application/json' -H 'X-Requested-With: get-me-there' \\",
    );
    expect(setup).toContain('-X POST http://127.0.0.1:3000/api/tools/smoke');
    const body = /-d '(\{[^']*\})'/.exec(setup)?.[1] ?? '';
    expect(apiContract.toolSmokeRequestSchema.parse(JSON.parse(body))).toMatchObject({ dryRun: true });
    expect(flat).toContain('Each database keeps its own count of the SearchApi credits tool runs have used');
    expect(flat).toContain('SEARCHAPI_TRIAL_USED');
    expect(setup).toContain('pnpm smoke:live --origin LHR --destination JFK --budget 8 --dry-run');
    expect(flat).toContain('smoke/fixtures/recorded');
    expect(flat).toContain('The app writes no fixtures for a smoke test it runs');
    expect(flat).toContain('`2` and `3`');
    // why: provenance review, fix round 1: the docs say which line to read and what each check proves
    expect(flat).toContain(
      'the line that starts `SearchApi credits already ledgered to tool runs in this budget window: N`',
    );
    expect(flat).not.toContain('first report line');
    expect(flat).toContain(
      "each price shown carries the source kind, age limit and point of sale its provider's adapter declares, and was fetched during this run",
    );
    expect(flat).not.toContain("This checks the providers' answers");
    expect(flat).not.toContain('--confirm-rerun');
  });
});

describe('operator docs (spec §11 banned words; spec §1 worked example only)', () => {
  it('covers every docs/*.md: the operator docs and the research notes', () => {
    const all = readdirSync(join(REPO, 'docs'))
      .filter((f) => f.endsWith('.md'))
      .sort();
    expect(all).toEqual([...OPERATOR_DOCS, ...RESEARCH_NOTES].sort());
  });

  it('the root README points a fresh clone at setup section 1 and the other operator docs (devops-final-006)', () => {
    const readme = read('README.md');
    expect(readme).toContain('docs/setup.md');
    expect(readme).toContain('section 1');
    for (const doc of ['docs/api-limits.md', 'docs/scheduling.md', 'docs/providers.md'])
      expect(readme).toContain(doc);
  });

  it.each([...OPERATOR_DOCS.map((f) => `docs/${f}`), 'README.md'])('%s contains no banned word', (path) => {
    const text = read(path);
    const hits = findBannedWords(text, BANNED_WORD_ALLOWLIST).map(
      (h) => `${h.word} @${h.index}: …${text.slice(Math.max(0, h.index - 30), h.index + 30)}…`,
    );
    expect(hits).toEqual([]);
  });

  it.each([...OPERATOR_DOCS.map((f) => `docs/${f}`), 'README.md', 'docs/examples/london-new-york.json'])(
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
