/**
 * True for a Unicode general-category Cc code point: C0 controls U+0000–U+001F, DEL U+007F and C1
 * controls U+0080–U+009F. CR and LF are controls, which is the point: they split headers and lines.
 */
function isControl(code: number): boolean {
  // why: charCodeAt on an astral character gives its high surrogate (U+D800+), never a control.
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
}

/**
 * Whether a vendor string holds any control character. A code-point scan rather than a regex, so no
 * lint suppression is needed (review arch-r2-003). Used by core to drop a POST body; WP11 imports
 * it for email headers.
 */
export function hasControlChars(s: string): boolean {
  for (const ch of s) if (isControl(ch.charCodeAt(0))) return true;
  return false;
}

/**
 * The string with every control character removed, or replaced one for one by `replacement`
 * (spec §8.3: provider strings are control-stripped). Character set: Unicode Cc only; U+2028 and
 * U+2029 are not controls and are left for the caller (WP11's email templates) to handle.
 */
export function stripControlChars(s: string, replacement = ''): string {
  let out = '';
  for (const ch of s) out += isControl(ch.charCodeAt(0)) ? replacement : ch;
  return out;
}
