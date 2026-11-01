// The recorder's research reads (WP21 Task 21.0 review: moved out of the served driver into their own module): every
// link name in `main`, every button and every tab name, each URL-stripped and at most NAMES_MAX.
import { beforeEach, describe, expect, it } from 'vitest';
import { buttonNames, linkNames, NAMES_MAX, tabNames } from '../src/researchNames.js';
import { FakePage, n, RESULTS_URL } from './support/fakePage.js';
import { fakeTimers } from './support/timers.js';

function setup(tree: ReturnType<typeof n>) {
  const page = new FakePage(null);
  page.setUrl(RESULTS_URL);
  page.setTrees([tree]);
  return { page, d: fakeTimers().deadline(90_000) };
}

beforeEach(() => {
  expect.hasAssertions();
});

describe('the research reads', () => {
  it('linkNames lists every link name in main with each https://… run replaced by <url>, at most 200', async () => {
    const { page, d } = setup(
      n('document', '', [
        n('link', 'Outside main'),
        n('main', '', [
          n('link', 'See https://www.example.test/a?b=c for more'),
          n('link', 'Plain'),
          n('link', 'Unread', [], { ariaLabel: null, text: null }),
        ]),
      ]),
    );
    expect(await linkNames(page, d)).toEqual(['See <url> for more', 'Plain', '']);
    page.setTrees([
      n('document', '', [
        n(
          'main',
          '',
          Array.from({ length: 205 }, (_, i) => n('link', `Link ${i}`)),
        ),
      ]),
    ]);
    const names = await linkNames(page, d);
    expect(NAMES_MAX).toBe(200);
    expect(names).toHaveLength(200);
    expect(names[199]).toBe('Link 199');
  });
  it('buttonNames and tabNames have the same shape, over the whole page; a name falls back to the text', async () => {
    const { page, d } = setup(
      n('document', '', [
        n('button', 'Close https://www.example.test/x'),
        n('main', '', [n('button', 'Select', [], { ariaLabel: null, text: 'Select' })]),
        n('tablist', '', [n('tab', 'Best'), n('tab', 'Cheapest from £1')]),
      ]),
    );
    expect(await buttonNames(page, d)).toEqual(['Close <url>', 'Select']);
    expect(await tabNames(page, d)).toEqual(['Best', 'Cheapest from £1']);
    page.setTrees([
      n(
        'document',
        '',
        Array.from({ length: 201 }, (_, i) => n('tab', `T${i}`)),
      ),
    ]);
    expect(await tabNames(page, d)).toHaveLength(200);
  });
});
