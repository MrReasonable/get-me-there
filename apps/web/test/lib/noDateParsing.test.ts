import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

// why: under jsdom `new URL(…, import.meta.url)` is not a file: URL that node:url accepts; import.meta.dirname is a path.
const SRC = join(import.meta.dirname, '..', '..', 'src');
const E2E = join(import.meta.dirname, '..', '..', 'e2e');
// why: a Date object renders in the browser's zone: built from 'YYYY-MM-DD' it is UTC midnight, and its local getters
// and toLocale*String show the previous day west of Greenwich. So no file but now.tsx (WP9: the current instant) builds a
// Date. Date.parse, Date.UTC and Date.now return epoch milliseconds, which carry no zone, so they are not hazards; the
// formatters take those milliseconds into an Intl.DateTimeFormat with an explicit timeZone (src/format.ts).
const ALLOWLIST = new Set(['now.tsx']);
const FORBIDDEN: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'new Date(', re: /\bnew\s+Date\s*\(/g },
  { name: 'Date(', re: /(?<![.\w])Date\s*\(/g },
  {
    name: 'local date getter',
    re: /\.\s*(getDate|getDay|getMonth|getFullYear|getHours|getMinutes|getTimezoneOffset)\s*\(/g,
  },
  { name: 'toLocale*String(', re: /\.\s*toLocale(Date|Time)?String\s*\(/g },
  { name: 'date library import', re: /from\s+['"](dayjs|moment|date-fns|luxon)(\/[^'"]*)?['"]/g },
];

/**
 * Comments are blanked (newlines kept, so line numbers hold) before scanning: a comment is never a hit. A `//` or
 * `/*` inside a string or template literal is text, not a comment, so the code after it is still scanned. Code inside
 * a template's `${ }` is code. (A regex literal holding a quote is not modelled; no file under src/ has one.)
 */
export function stripComments(source: string): string {
  const out: string[] = [];
  // why: each open template literal remembers the brace depth of its current `${ }`, so the matching `}` returns to the template.
  const templates: number[] = [];
  let depth = 0;
  let i = 0;
  const blank = (c: string) => (c === '\n' ? '\n' : ' ');
  while (i < source.length) {
    const c = source.charAt(i);
    const next = source.charAt(i + 1);
    if (c === '/' && next === '/') {
      while (i < source.length && source.charAt(i) !== '\n') {
        out.push(' ');
        i++;
      }
    } else if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      for (; i < stop; i++) out.push(blank(source.charAt(i)));
    } else if (c === "'" || c === '"') {
      out.push(c);
      i++;
      while (i < source.length && source.charAt(i) !== c && source.charAt(i) !== '\n') {
        if (source.charAt(i) === '\\') out.push(source.charAt(i++));
        out.push(source.charAt(i++));
      }
      if (i < source.length) out.push(source.charAt(i++));
    } else if (c === '`' || (c === '}' && templates.at(-1) === depth)) {
      // inside template text until the closing backtick, or until a `${` opens code again
      if (c === '}') templates.pop();
      out.push(c);
      i++;
      while (i < source.length && source.charAt(i) !== '`') {
        if (source.charAt(i) === '\\') out.push(source.charAt(i++));
        else if (source.charAt(i) === '$' && source.charAt(i + 1) === '{') {
          out.push('${');
          i += 2;
          templates.push(depth);
          break;
        }
        out.push(source.charAt(i++));
      }
      if (source.charAt(i) === '`') out.push(source.charAt(i++));
    } else {
      if (c === '{') depth++;
      if (c === '}') depth--;
      out.push(c);
      i++;
    }
  }
  return out.join('');
}

/** Every forbidden use in a file's text, scanned whole (a call split across lines is still found), with its line. */
export function scan(source: string): string[] {
  const text = stripComments(source);
  const hits: string[] = [];
  for (const f of FORBIDDEN) {
    for (const m of text.matchAll(f.re)) hits.push(`${text.slice(0, m.index).split('\n').length}: ${f.name}`);
  }
  return hits.sort();
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe('no Date object outside WP9’s clock (review focus 3)', () => {
  it('the scanner finds each forbidden form, across lines, and ignores comments and string helpers', () => {
    expect(scan(`const d = new Date('2027-03-14');`)).toEqual(['1: Date(', '1: new Date(']);
    expect(scan(`const d = new\n  Date(\n'2027-03-14');`)).toEqual(['1: new Date(', '2: Date(']);
    // why: epoch milliseconds carry no zone; only a Date object (or a library around one) can shift a day.
    expect(scan(`const t = Date.parse(day.at) + Date.UTC(2027, 2, 14) + Date.now();`)).toEqual([]);
    expect(scan(`const s = Date();`)).toEqual(['1: Date(']);
    expect(scan(`const n = when.getDate();`)).toEqual(['1: local date getter']);
    expect(scan(`label = x.toLocaleDateString('en-GB');`)).toEqual(['1: toLocale*String(']);
    expect(scan(`import { format } from 'date-fns';`)).toEqual(['1: date library import']);
    expect(
      scan(`// new Date('2027-03-14')\n/* Date.parse(x) */ const ok = formatDayShort(day.date);`),
    ).toEqual([]);
    expect(scan(`const ok = formatDayShort(day.date); const url = 'http://x//y';`)).toEqual([]);
    // why: a `//` inside a string is text, so a Date after it on the same line is still found (CodeRabbit, major)
    expect(scan(`const url = 'http://x//y'; new Date()`)).toEqual(['1: Date(', '1: new Date(']);
    expect(scan('const u = "a//b"; const d = new Date();')).toEqual(['1: Date(', '1: new Date(']);
    expect(scan(`const u = \`a//$${'{'}new Date()}//b\`;`)).toEqual(['1: Date(', '1: new Date(']);
    expect(scan("const s = 'it\\'s // here'; new Date()")).toEqual(['1: Date(', '1: new Date(']);
    expect(scan('/* a */ const d = new Date(); // tail Date()')).toEqual(['1: Date(', '1: new Date(']);
  });
  it('finds no Date object in apps/web/src outside the allowlist', () => {
    const files = walk(SRC);
    expect(files.length).toBeGreaterThan(20); // why: a wrong SRC path must not make this vacuous
    const hits = files
      .filter((f) => !ALLOWLIST.has(relative(SRC, f).split(sep).join('/')))
      .flatMap((f) => scan(readFileSync(f, 'utf8')).map((h) => `${relative(SRC, f)}:${h}`));
    expect(hits).toEqual([]);
  });
  // why: the e2e fixtures build the bodies the app reads, so their days follow the same rule: core's epoch-day helpers
  // (`addDays`, `asIsoDate`), and an ISO instant handed to Playwright as a string (CodeRabbit on PR #32)
  it('finds no Date object in apps/web/e2e', () => {
    const files = walk(E2E);
    expect(files.length).toBeGreaterThan(2); // why: a wrong E2E path must not make this vacuous
    const hits = files.flatMap((f) => scan(readFileSync(f, 'utf8')).map((h) => `${relative(E2E, f)}:${h}`));
    expect(hits).toEqual([]);
  });
  it('the allowlist is exactly WP9’s clock, and it exists', () => {
    expect([...ALLOWLIST]).toEqual(['now.tsx']);
    for (const f of ALLOWLIST) expect(statSync(join(SRC, f)).isFile()).toBe(true);
  });
});
