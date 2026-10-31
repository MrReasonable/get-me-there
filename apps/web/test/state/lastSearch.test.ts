import { afterEach, describe, expect, it, vi } from 'vitest';
import { LAST_SEARCH_KEY, readLastSearch, writeLastSearch } from '../../src/state/lastSearch.js';

// Spec rev 55 §11: the search last opened is kept in the browser as `gmt.lastSearch`; a storage that throws reads as
// "none opened" and a write it refuses is ignored (a per-viewer convenience, never state the page needs).

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('the search last opened (gmt.lastSearch)', () => {
  it('reads null until a search has been opened', () => {
    expect(readLastSearch()).toBeNull();
  });

  it('writeLastSearch then readLastSearch round-trips, under the gmt.lastSearch key', () => {
    writeLastSearch('def-0001');
    expect(readLastSearch()).toBe('def-0001');
    expect(window.localStorage.getItem('gmt.lastSearch')).toBe('def-0001');
    expect(LAST_SEARCH_KEY).toBe('gmt.lastSearch');
    writeLastSearch('def-0002');
    expect(readLastSearch()).toBe('def-0002');
  });

  it('an empty stored value is no search', () => {
    window.localStorage.setItem(LAST_SEARCH_KEY, '');
    expect(readLastSearch()).toBeNull();
  });

  it('a throwing localStorage reads null and a refused write does not throw', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(readLastSearch()).toBeNull();
    expect(() => writeLastSearch('def-0001')).not.toThrow();
  });
});
