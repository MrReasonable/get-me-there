/**
 * The one argv reader both tools share (`record:fixtures`, `smoke:live`; spec §9 item 7, plan decision 66): `--flag
 * value` and `--flag=value` for the value flags, bare switches, pnpm's own `--` skipped. Each tool keeps only its own
 * validation; the refusal wording here is the same for both.
 */

/** The flags and switches read, or the refusal (without the usage line, which each tool appends). */
export type ReadFlags =
  | { ok: true; flags: ReadonlyMap<string, string>; switches: ReadonlySet<string> }
  | { ok: false; message: string };

export function readFlags(
  argv: readonly string[],
  valueFlags: ReadonlySet<string>,
  switchNames: ReadonlySet<string>,
): ReadFlags {
  const flags = new Map<string, string>();
  const switches = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue; // why: pnpm may forward its own separator
    if (a === undefined || !a.startsWith('--'))
      return { ok: false, message: `unexpected argument ${String(a)}` };
    const eq = a.indexOf('=');
    const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
    if (switchNames.has(name) && eq === -1) {
      switches.add(name);
      continue;
    }
    if (!valueFlags.has(name)) return { ok: false, message: `unknown flag --${name}` };
    if (flags.has(name)) return { ok: false, message: `--${name} is given twice` };
    const value = eq === -1 ? argv[i + 1] : a.slice(eq + 1);
    if (value === undefined || value === '' || value.startsWith('--'))
      return { ok: false, message: `--${name} needs a value` };
    flags.set(name, value);
    if (eq === -1) i++;
  }
  return { ok: true, flags, switches };
}

/** A positive integer of at most six digits, or null (a budget is never 0, never a float, never huge). */
export function positiveInt(s: string): number | null {
  return /^[1-9]\d{0,5}$/.test(s) ? Number(s) : null;
}
