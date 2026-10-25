/** Test-side readers of rendered unit files, written independently of the renderers. */

const unescapeXml = (s: string) =>
  s
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');

/** The <string> items of the array under `key` in a plist. */
export function plistArray(xml: string, key: string): string[] {
  const m = new RegExp(`<key>${key}</key>\\s*<array>([\\s\\S]*?)</array>`).exec(xml);
  if (m === null || m[1] === undefined) throw new Error(`no array ${key}`);
  return [...m[1].matchAll(/<string>([\s\S]*?)<\/string>/g)].map((x) => unescapeXml(x[1] ?? ''));
}
/** The <key>/<string> pairs of the dict under `key`. */
export function plistDict(xml: string, key: string): Record<string, string> {
  const m = new RegExp(`<key>${key}</key>\\s*<dict>([\\s\\S]*?)</dict>`).exec(xml);
  if (m === null || m[1] === undefined) throw new Error(`no dict ${key}`);
  return Object.fromEntries(
    [...m[1].matchAll(/<key>([^<]*)<\/key>\s*<string>([\s\S]*?)<\/string>/g)].map((x) => [
      unescapeXml(x[1] ?? ''),
      unescapeXml(x[2] ?? ''),
    ]),
  );
}

/**
 * systemd's command-line rules (systemd.service(5) "Command lines"): specifiers first (`%%` is `%`), then words split
 * on blanks with double or single quotes and C escapes inside them, then `$$` is `$`.
 */
export function tokeniseExecStart(line: string): string[] {
  const words: string[] = [];
  let i = 0;
  const unspec = (s: string) => s.replaceAll('%%', '%');
  const text = unspec(line);
  while (i < text.length) {
    while (text[i] === ' ') i++;
    if (i >= text.length) break;
    let w = '';
    if (text[i] === '"' || text[i] === "'") {
      const q = text[i];
      i++;
      while (i < text.length && text[i] !== q) {
        if (text[i] === '\\') {
          i++;
          const c = text[i] ?? '';
          w += c === 'n' ? '\n' : c === 't' ? '\t' : c;
        } else w += text[i];
        i++;
      }
      i++;
    } else {
      while (i < text.length && text[i] !== ' ') w += text[i++];
    }
    words.push(w.replaceAll('$$', '$'));
  }
  return words;
}

/** A unit file's `Key=value` lines under `[section]`. */
export function unitLines(text: string, section: string): string[] {
  const body = text.split(`[${section}]\n`)[1]?.split('\n[')[0] ?? '';
  return body.split('\n').filter((l) => l !== '');
}
