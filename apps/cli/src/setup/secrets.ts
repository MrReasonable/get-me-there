/**
 * Secrets in setup (spec §13): generated values from `crypto.randomBytes` in `[A-Za-z0-9_-]`, operator values checked
 * for the characters `app.env` cannot carry, and secret inputs resolved from a literal, a named environment variable or
 * standard input. No function here ever puts a secret's value into an error or a return it does not own.
 */

/** A generated password: 24 random bytes as base64url, 32 characters of `[A-Za-z0-9_-]` (brief Task 16b.6). */
export function generatePassword(randomBytes: (n: number) => Buffer): string {
  return randomBytes(24).toString('base64url');
}

/** Spec §12: an operator value is written double-quoted, so `"`, `\`, CR and LF are refused (parseEnv would alter them). */
export const UNSAFE_VALUE = /["\\\r\n]/;

/**
 * Why a value cannot be written, naming only the field; null when it can. A secret must also be non-empty and at most
 * 512 characters.
 */
export function valueProblem(field: string, value: string, opts: { secret: boolean }): string | null {
  if (UNSAFE_VALUE.test(value)) return `${field}: holds a character app.env cannot carry (", \\, CR or LF)`;
  if (opts.secret && value === '') return `${field}: is empty`;
  if (opts.secret && value.length > 512) return `${field}: is longer than 512 characters`;
  return null;
}

/** A secret as an answers file may give it. */
export type SecretInput = string | { fromEnv: string } | { fromStdin: true };

/**
 * Resolves secret inputs in one pass: environment names through `env`, at most one `fromStdin` through `readStdin`
 * (read once, its trailing newline dropped). Errors name the field and the variable, never a value.
 */
export async function resolveSecrets(
  inputs: ReadonlyArray<{ field: string; input: SecretInput }>,
  env: (name: string) => string | undefined,
  readStdin: () => Promise<string>,
): Promise<{ ok: true; values: Map<string, string> } | { ok: false; error: string }> {
  const fromStdin = inputs.filter((i) => typeof i.input === 'object' && 'fromStdin' in i.input);
  if (fromStdin.length > 1)
    return {
      ok: false,
      error: `only one secret may come from standard input (${fromStdin.map((i) => i.field).join(', ')}); use fromEnv for the others`,
    };
  const values = new Map<string, string>();
  for (const { field, input } of inputs) {
    if (typeof input === 'string') values.set(field, input);
    else if ('fromEnv' in input) {
      const v = env(input.fromEnv);
      if (v === undefined)
        return { ok: false, error: `${field}: the environment variable ${input.fromEnv} is not set` };
      values.set(field, v);
    } else values.set(field, (await readStdin()).replace(/\r?\n$/, ''));
  }
  return { ok: true, values };
}
