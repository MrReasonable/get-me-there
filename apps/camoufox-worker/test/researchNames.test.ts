// The recorder's research reads (WP21 Task 21.0 review: moved out of the served driver into their own module): every
// link name in `main`, every button and every tab name, each URL-stripped and at most NAMES_MAX.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buttonNames,
  headingLevels,
  linkNames,
  NAMES_MAX,
  roleCounts,
  tabNames,
} from '../src/researchNames.js';
import { FakePage, n, RESULTS_URL, shrinkAfterCount } from './support/fakePage.js';
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

// why: WP21 Task 21.3 fix round 2: the recorder reads these right after a selection, while the view re-renders; each
// list is read in one page call, so a link gone after the count holds no read (the race is against the fake's event)
describe('the research reads take every name in one page call (fix round 2)', () => {
  it('a name is the aria-label before the text', async () => {
    const { page, d } = setup(
      n('document', '', [n('main', '', [n('link', 'Label', [], { ariaLabel: 'Label', text: 'Card text' })])]),
    );
    expect(await linkNames(page, d)).toEqual(['Label']);
  });
  it('linkNames answers the links the page held at once', async () => {
    const main = n(
      'main',
      '',
      ['A', 'B', 'C', 'D', 'E'].map((x) => n('link', x)),
    );
    const { page, d } = setup(n('document', '', [main]));
    const hung = shrinkAfterCount(page, main, { whenCount: 5, keep: 3 });
    const read = linkNames(page, d);
    read.catch(() => undefined);
    const out = await Promise.race([read, hung]);
    await page.close();
    expect(out).toEqual(['A', 'B', 'C', 'D', 'E']);
  });
});

describe('the booking view’s structure reads', () => {
  it('headingLevels counts the headings at each level 1 to 6; roleCounts counts the roles inside main', async () => {
    const { page, d } = setup(
      n('document', '', [
        n('heading', 'Page', [], { level: 1 }),
        n('main', '', [
          n('heading', 'Section', [], { level: 2 }),
          n('heading', 'Row', [], { level: 3 }),
          n('heading', 'Row', [], { level: 3 }),
          n('list', '', [
            n('listitem', '', [n('link', 'A'), n('button', 'B')]),
            n('listitem', '', [n('button', 'C')]),
          ]),
          n('dialog', 'D'),
        ]),
      ]),
    );
    expect(await headingLevels(page, d)).toEqual([1, 1, 2, 0, 0, 0]);
    expect(await roleCounts(page, d)).toEqual({
      link: 1,
      button: 2,
      listitem: 2,
      list: 1,
      row: 0,
      gridcell: 0,
      heading: 3,
      dialog: 1,
      alertdialog: 0,
      region: 0,
    });
  });
});
