import { describe, expect, it } from 'vitest';
import { NoteCounter } from '../../src/shared/notes.js';

describe('NoteCounter (plan decision 24: one notes grammar for every adapter)', () => {
  it('counts keys, ignores zero counts, and lists `key:n` sorted by key', () => {
    const n = new NoteCounter();
    n.add('rows-received', 3);
    n.add('dropped-outside-band');
    n.add('dropped-outside-band');
    n.add('offers-dropped', 0);
    expect(n.get('dropped-outside-band')).toBe(2);
    expect(n.get('offers-dropped')).toBe(0);
    expect(n.list()).toEqual(['dropped-outside-band:2', 'rows-received:3']);
  });
});
