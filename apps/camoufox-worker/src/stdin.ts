/**
 * Standard input, up to `max` bytes; `too-long` as soon as more arrives (the rest is never read). Shared by the
 * entries that read one line from stdin: `consent import` and `session seed` and `merge` (WP17 Tasks 17.5 and 17.8).
 */
export async function readBounded(input: AsyncIterable<unknown>, max: number): Promise<string | 'too-long'> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const c of input) {
    const b = Buffer.isBuffer(c) ? c : Buffer.from(String(c));
    total += b.length;
    if (total > max) return 'too-long';
    chunks.push(b);
  }
  return Buffer.concat(chunks).toString('utf8');
}
