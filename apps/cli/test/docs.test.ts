import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMMANDS, parseCommandLine } from '../src/args.js';
import { NO_SOURCE_TEXT } from '../src/setup/closing.js';
import { PASTE_TOKEN_QUESTION, PROMPTS, TP_SIGNUP_URL, TP_TOKEN_URL } from '../src/setup/prompts.js';

// why: brief §6 and Task 16b.12: docs/setup.md section 0 states the wizard as the CLI asks it, so a change to either
// shows here
const setup = readFileSync(join(import.meta.dirname, '..', '..', '..', 'docs', 'setup.md'), 'utf8');
const section0 = setup.slice(setup.indexOf('## 0. Quick start (macOS and Linux)'), setup.indexOf('\n## 1. '));
const flat = section0.replace(/\s+/g, ' ');

describe('docs/setup.md section 0 is the CLI’s own text', () => {
  it('exists, before section 1', () => {
    expect(section0.length).toBeGreaterThan(1000);
  });

  it('its prompt table is the CLI’s, row for row: number, question, default and help', () => {
    const table = section0.slice(section0.indexOf('| # | Question |'));
    const lines = table.split('\n').slice(2);
    const rows = lines
      .slice(
        0,
        lines.findIndex((l) => !l.startsWith('| ')),
      )
      .map((l) => l.split(' | ').map((c) => c.replace(/^\| |\s*\|$/g, '').trim()));
    expect(rows.map((r) => [Number(r[0]), r[1], r[2], r[3]])).toEqual(
      PROMPTS.map((p) => [p.row, p.question, p.default, p.help]),
    );
  });

  it('row 4’s help and the closing text carry both Travelpayouts URLs, word for word', () => {
    expect(section0).toContain(PROMPTS.find((p) => p.row === 4)?.help ?? 'missing');
    expect(flat).toContain(NO_SOURCE_TEXT);
    for (const url of [TP_SIGNUP_URL, TP_TOKEN_URL]) expect(NO_SOURCE_TEXT).toContain(url);
    expect(section0).toContain(`"${PASTE_TOKEN_QUESTION}"`);
  });

  it('names every gmt command', () => {
    for (const c of COMMANDS) expect(section0).toContain(`pnpm gmt ${c}`);
  });

  it('every fenced pnpm gmt line parses under the CLI’s own argument parser', () => {
    const fenced = [...section0.matchAll(/```bash\n([\s\S]*?)```/g)].flatMap((m) => (m[1] ?? '').split('\n'));
    const lines = fenced.map((l) => l.replace(/\s+#.*$/, '').trim()).filter((l) => l.startsWith('pnpm gmt '));
    expect(lines.length).toBeGreaterThanOrEqual(COMMANDS.length);
    for (const l of lines) {
      const argv = l.slice('pnpm gmt '.length).split(/\s+/);
      const p = parseCommandLine(argv);
      expect([l, p.kind]).toEqual([l, 'command']);
      expect(parseCommandLine([...argv, '--help']).kind).toBe('help');
    }
  });

  it('states the smoke’s spend as its --help does, and the native restore steps', () => {
    expect(flat).toContain('up to 4 SearchApi credits and one browser page');
    for (const s of [
      'pnpm gmt stop',
      'git checkout <commit>',
      'pnpm gmt restore <backup>',
      'git switch main',
      'PRAGMA integrity_check',
    ])
      expect(section0).toContain(s);
    expect(flat).toContain('a missed one is caught up once, without the browser provider');
    expect(flat).toContain('docker compose run --rm --no-deps --entrypoint rm app /data/MOVED-TO-NATIVE');
    expect(flat).toContain('Time Machine');
    expect(section0).toContain('newsyslog');
  });
});
