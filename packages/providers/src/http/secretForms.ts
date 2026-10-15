// The one list of a secret's textual forms (spec §5.3 "base64 and URL-encoded forms where feasible"). why: a leaf with
// no imports and only erasable TypeScript, so scripts/secret-scan.mjs imports this very file through Node's native type
// stripping: the scrubber, the recorder's fail-closed check and the secret scan cannot drift apart (WP4b N-1).

/**
 * Every textual form in which a secret can reach a sink: raw, encodeURIComponent, URLSearchParams form-encoding, JSON
 * string escaping, base64 (padded and not) and base64url.
 */
export function secretForms(value: string): string[] {
  if (value === '') return [];
  const b64 = Buffer.from(value, 'utf8').toString('base64');
  return [
    value,
    encodeURIComponent(value),
    new URLSearchParams({ v: value }).toString().slice(2),
    JSON.stringify(value).slice(1, -1),
    b64,
    b64.replace(/=+$/, ''),
    Buffer.from(value, 'utf8').toString('base64url'),
  ];
}
