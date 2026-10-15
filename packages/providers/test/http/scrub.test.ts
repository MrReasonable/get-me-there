import { Secret } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { containsSecret, scrubSecrets, secretForms, stripUrl } from '../../src/http/scrub.js';

const key = new Secret('test-searchapi-key-0123456789abcdef');
const odd = new Secret('p@ss/word+0123456789 "q"\\');

describe('stripUrl (spec §5.3: origin + path only)', () => {
  it('drops query, fragment and userinfo', () => {
    expect(stripUrl('https://user:pw@www.searchapi.io/api/v1/search?api_key=x&engine=y#frag')).toBe(
      'https://www.searchapi.io/api/v1/search',
    );
  });
  it('keeps a non-default port', () =>
    expect(stripUrl('http://fixture.local:8080/calendar?a=1')).toBe('http://fixture.local:8080/calendar'));
  it('returns <url> for anything unparseable', () => expect(stripUrl('not a url')).toBe('<url>'));
});

describe('secret forms (sec-002)', () => {
  const v = odd.reveal();
  const b64 = Buffer.from(v, 'utf8').toString('base64');
  it.each([
    ['raw', v],
    ['URL-encoded', encodeURIComponent(v)],
    ['form-encoded', new URLSearchParams({ v }).toString().slice(2)],
    ['JSON-escaped', JSON.stringify(v).slice(1, -1)],
    ['base64', b64],
    ['base64 without padding', b64.replace(/=+$/, '')],
    ['base64url', Buffer.from(v, 'utf8').toString('base64url')],
  ])('%s form is detected and scrubbed', (_label, form) => {
    expect(secretForms(v)).toContain(form);
    expect(containsSecret(`prefix ${form} suffix`, [odd])).toBe(true);
    expect(scrubSecrets(`prefix ${form} suffix`, [odd])).toBe('prefix [redacted] suffix');
  });
});

describe('scrubSecrets (deep, keys included)', () => {
  it('replaces secrets anywhere in a structure, object keys included', () => {
    const value = {
      a: `Invalid API key ${key.reveal()}`,
      list: [`x${encodeURIComponent(odd.reveal())}y`, 3, null, true],
      [key.reveal()]: { nested: odd.reveal() },
    };
    const out = scrubSecrets(value, [key, odd]);
    const text = JSON.stringify(out);
    expect(containsSecret(text, [key, odd])).toBe(false);
    expect(out).toEqual({
      a: 'Invalid API key [redacted]',
      list: ['x[redacted]y', 3, null, true],
      '[redacted]': { nested: '[redacted]' },
    });
  });
  it('leaves values without secrets unchanged', () => {
    expect(scrubSecrets({ n: 1, s: 'plain' }, [key])).toEqual({ n: 1, s: 'plain' });
  });
  it('ignores an empty secret instead of redacting everything', () => {
    expect(scrubSecrets('abc', [new Secret('')])).toBe('abc');
    expect(secretForms('')).toEqual([]);
  });
});
