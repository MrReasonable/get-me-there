import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
// why: the workspace root's TypeScript (a root devDependency); an AST, not a regex, so multi-line JSX
// text, ternaries and template literals are all seen (reviews tsr-007, arch-018).
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// why: under jsdom import.meta.url is not a file: URL, so the module's directory comes from import.meta.dirname.
const ROOT = resolve(import.meta.dirname, '../..');

/** Every .ts/.tsx file under a directory of apps/web, with its path relative to apps/web. */
function sources(dir: 'src' | 'test'): Array<{ file: string; text: string }> {
  const base = join(ROOT, dir);
  return readdirSync(base, { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => ({ file: relative(ROOT, join(base, f)), text: readFileSync(join(base, f), 'utf8') }));
}

const LETTER = /\p{L}/u;
/** Attributes whose value a person reads or hears: literal copy is forbidden in them. */
const COPY_ATTRS = new Set([
  'aria-label',
  'aria-description',
  'aria-roledescription',
  'aria-valuetext',
  'title',
  'placeholder',
  'alt',
  'label',
]);
/** The files allowed to format money: PriceCell for prices, and the views that show costs and caps (never a fare). */
const MONEY_FORMATTERS = new Set(['formatPence', 'formatMicroGbp']);
const MONEY_FILES = new Set([
  // why: decision 55 — a rule's threshold is a price quoted in text, rendered inside [data-quote], never a fare
  'src/views/Alerts/ruleText.ts',
  'src/format.ts',
  'src/components/PriceCell.tsx',
  'src/components/StatusBar.tsx',
  // WP19: the coverage section's ledger costs (moved from the Coverage view), and the overview legend's band ranges,
  // scale values in [data-scale], never fares
  'src/views/Dates/CoverageSection.tsx',
  'src/views/Dates/Legend.tsx',
  'src/views/Definitions/Confirmation.tsx',
  'src/views/Definitions/EstimatePanel.tsx',
  // WP10 (plan decision 52): the indicative route-level series, which spec §11 exempts from full provenance
  // ([data-indicative] rows). The charts print fares only through PriceCell and their axes without "£"
  // (format.ts formatAxisPounds), so they are not here. (WP19 retired the heatmap legend with the Calendar view.)
  'src/views/History/RouteTable.tsx',
]);

function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/** The literal text of a string or template node, or null for anything else. */
function literalText(n: ts.Node): string | null {
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isTemplateExpression(n))
    return [n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join(' ');
  return null;
}

const VALUE_OPERATORS = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);

/** True when `n` is a value its parent can render: a ternary branch, the right of `&&`/`||`/`??`, or parenthesised. */
function passesValueUp(n: ts.Node, p: ts.Node): boolean {
  if (ts.isParenthesizedExpression(p)) return true;
  if (ts.isConditionalExpression(p)) return n === p.whenTrue || n === p.whenFalse;
  return ts.isBinaryExpression(p) && VALUE_OPERATORS.has(p.operatorToken.kind) && n === p.right;
}

/** Where a literal ends up when it is rendered from a JSX expression; comparisons (`x === 'calendar'`) render nothing. */
function jsxSlot(n: ts.Node): 'child' | { attr: string } | null {
  let cur = n;
  let p = n.parent;
  while (p !== undefined && passesValueUp(cur, p)) {
    cur = p;
    p = p.parent;
  }
  if (p === undefined) return null;
  if (ts.isJsxAttribute(p)) return { attr: p.name.getText() };
  if (!ts.isJsxExpression(p)) return null;
  if (ts.isJsxAttribute(p.parent)) return { attr: p.parent.name.getText() };
  return ts.isJsxElement(p.parent) || ts.isJsxFragment(p.parent) ? 'child' : null;
}

/** Props of a component (a capitalised JSX tag) that carry identifiers or tokens, never copy. */
const NON_COPY_PROPS = new Set([
  'id',
  'className',
  'variant',
  'type',
  'name',
  'role',
  'key',
  'htmlFor',
  'inputMode',
  'value',
  // the departure board's flap groups: an alignment and a board slot's name, never copy
  'align',
  'slot',
  'flapSlot',
  // WP10: Recharts' identifier props (a data field, an axis scale, a legend position), never copy
  'dataKey',
  'scale',
  'verticalAlign',
]);

/** True when the literal is an attribute value on a component (`<Heading text="…">`), not on an HTML element. */
function onComponent(n: ts.Node): boolean {
  let p: ts.Node | undefined = n.parent;
  while (p !== undefined && !ts.isJsxOpeningElement(p) && !ts.isJsxSelfClosingElement(p)) p = p.parent;
  return p !== undefined && /^[A-Z]/.test(p.tagName.getText());
}

/** Literal copy in a .tsx file: JSX text with a letter, or a lettered literal rendered as a child or a copy attribute. */
export function copyOffenders(file: string, text: string): string[] {
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isJsxText(n) && LETTER.test(n.text)) out.push(`${file}: text "${n.text.trim()}"`);
    const lit = literalText(n);
    if (lit !== null && LETTER.test(lit)) {
      const slot = jsxSlot(n);
      if (slot === 'child') out.push(`${file}: literal child "${lit}"`);
      else if (slot !== null && COPY_ATTRS.has(slot.attr)) out.push(`${file}: ${slot.attr}="${lit}"`);
      else if (
        slot !== null &&
        onComponent(n) &&
        !NON_COPY_PROPS.has(slot.attr) &&
        !slot.attr.startsWith('data-')
      )
        out.push(`${file}: prop ${slot.attr}="${lit}"`);
    }
    ts.forEachChild(n, visit);
  };
  visit(parse(file, text));
  return out;
}

/** Files whose string literals may hold a pound sign: the catalogue (labels such as "Max price (£)") and the formatter. */
const POUND_FILES = new Set(['src/copy.ts', 'src/format.ts']);

/**
 * A price printed without PriceCell (reviews tsr-003, prov-r2-007, tsr2-008): outside the allowlisted
 * files, any call to a money formatter (bare or through a namespace), any import of one (renamed or
 * not), and outside the catalogue any string or template literal holding "£". A value passed through
 * a variable to a non-allowlisted file is the accepted gap; the rendered sweep of Task 9.14 checks the DOM.
 */
export function moneyOffenders(file: string, text: string): string[] {
  const out: string[] = [];
  const money = !MONEY_FILES.has(file);
  const visit = (n: ts.Node): void => {
    if (money && ts.isCallExpression(n)) {
      const callee = ts.isPropertyAccessExpression(n.expression) ? n.expression.name : n.expression;
      if (ts.isIdentifier(callee) && MONEY_FORMATTERS.has(callee.text))
        out.push(`${file}: ${callee.text}(…)`);
    }
    if (money && ts.isImportSpecifier(n) && MONEY_FORMATTERS.has((n.propertyName ?? n.name).text)) {
      out.push(`${file}: imports ${(n.propertyName ?? n.name).text}`);
    }
    const lit = literalText(n);
    if (lit?.includes('£') && !POUND_FILES.has(file)) out.push(`${file}: "£" in "${lit}"`);
    ts.forEachChild(n, visit);
  };
  visit(parse(file, text));
  return out;
}

describe('source guards (spec §11 copy, spec §9 item 6 prices)', () => {
  const src = sources('src');
  const tests = sources('test');

  it('finds files to scan (a vacuous pass is a failure)', () => {
    expect(src.filter((s) => s.file.endsWith('.tsx')).length).toBeGreaterThan(3);
    expect(tests.length).toBeGreaterThan(5);
  });

  it('no literal copy in any component: all copy comes from src/copy.ts', () => {
    expect(src.filter((s) => s.file.endsWith('.tsx')).flatMap((s) => copyOffenders(s.file, s.text))).toEqual(
      [],
    );
  });

  it('money is formatted only by PriceCell and the cost and cap views', () => {
    expect(src.flatMap((s) => moneyOffenders(s.file, s.text))).toEqual([]);
  });

  it('every allowlisted file exists, so a mistyped or removed entry cannot silently exempt a future file', () => {
    const files = new Set(src.map((s) => s.file));
    expect([...MONEY_FILES, ...POUND_FILES].filter((f) => !files.has(f))).toEqual([]);
  });

  it('the guards catch planted offenders, multi-line and conditional ones included', () => {
    const planted = [
      'const a = <p>\n  Live fares\n</p>;',
      "const b = <p>{ok ? 'Yes' : null}</p>;",
      "const f = <p>{kind === 'calendar' ? COPY.notChecked : null}</p>;",
      'const c = <button aria-label="Close" />;',
      // why: assembled from pieces so this file has no "${" inside a plain string.
      ['const d = <p>{`Hello $', '{name}`}</p>;'].join(''),
    ].join('\n');
    expect(copyOffenders('planted.tsx', planted)).toHaveLength(4);
    expect(copyOffenders('ok.tsx', 'const e = <p className="text-sm">{COPY.loading}{\' \'}</p>;')).toEqual(
      [],
    );
    expect(moneyOffenders('src/views/Elsewhere.tsx', 'formatPence(100);')).toHaveLength(1);
    expect(
      moneyOffenders(
        'src/views/Elsewhere.tsx',
        "import { formatPence as fp } from '../format.js'; fmt.formatMicroGbp(1);",
      ),
    ).toEqual(['src/views/Elsewhere.tsx: imports formatPence', 'src/views/Elsewhere.tsx: formatMicroGbp(…)']);
    expect(moneyOffenders('src/views/Elsewhere.tsx', ['const p = `£$', '{n}`;'].join(''))).toHaveLength(1);
    expect(copyOffenders('planted.tsx', 'const g = <Heading text="Cheapest" id="h1" />;')).toEqual([
      'planted.tsx: prop text="Cheapest"',
    ]);
  });
});
