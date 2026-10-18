// A fake Playwright page shaped like playwright-core 1.59.1's (PageLike): a synthetic accessibility tree of roles,
// accessible names and text that locators query, scripted navigation (hops, the route guard, framenavigated), and a
// record of every call's timeout. Synthetic only; nothing here is copied from a recording.
import type { FrameLike, LocatorLike, PageLike, RequestLike } from '../../src/driver.js';
import type { Role } from '../../src/selectors.js';
import type { FakeContext } from './fakeContext.js';

export interface FakeNode {
  role?: string;
  /** The accessible name. */
  name?: string;
  /** `aria-label`; defaults to `name`; `null` makes the driver fall back to the text. */
  ariaLabel?: string | null;
  /** textContent; defaults to `name`. */
  text?: string | null;
  value?: string;
  children?: FakeNode[];
  /** Every read of this node never resolves (a hanging browser call). */
  hang?: boolean;
  /** Not visible (a hidden label inside another control's name). */
  hidden?: boolean;
  /** `aria-selected="true"` (a selected tab). */
  selected?: boolean;
  /** A click on this node never resolves (every other read answers). */
  clickHang?: boolean;
  /** A `selected: true` role query that would match this node never answers (a re-rendering tab). */
  selectedQueryHang?: boolean;
  /** Any locator whose matches include this node never answers its count (a lookup that overruns). */
  countHang?: boolean;
  /** What `getAttribute('aria-selected')` answers, when it differs from the role state (a replaced node). */
  ariaSelectedAttr?: string;
  /** `innerText()` on this node never answers (every other read does). */
  innerTextHang?: boolean;
  /** A link's target, which the printed snapshot shows as a `/url:` line (as Playwright's does). */
  href?: string;
}
export const n = (
  role: string,
  name: string,
  children: FakeNode[] = [],
  extra: Partial<FakeNode> = {},
): FakeNode => ({
  role,
  name,
  children,
  ...extra,
});
export const text = (t: string): FakeNode => ({ role: 'text', name: t, text: t });

export const RESULTS_URL = 'https://www.google.com/travel/flights/search?tfs=x';

/** One result option's accessible name in the feasibility grammar (synthetic airline). */
export function optionName(
  pounds: number | string,
  o: { on?: string; from?: string; to?: string } = {},
): string {
  const on = o.on ?? 'Thursday, November 5';
  return `From ${pounds} British pounds round trip total. 1 stop flight with Example Air. Leaves ${o.from ?? 'Heathrow Airport'} at 12:25 on ${on} and arrives at ${o.to ?? 'John F. Kennedy International Airport'} at 20:05 on ${on}. Total duration 12 hrs 40 min. Select flight`;
}
export const option = (pounds: number, o: { on?: string; from?: string; to?: string } = {}): FakeNode =>
  n('listitem', '', [n('link', optionName(pounds, o))]);

/** The search form's controls (the brief's round-1 hypothesis; Task 14.2's recording replaces the names). */
export function formNodes(
  o: { trip?: string; adults?: string; dep?: string; ret?: string } = {},
): FakeNode[] {
  return [
    n('combobox', `Change ticket type. ${o.trip ?? 'Round trip'}`),
    n('button', `${o.adults ?? '1'} passenger, change number of passengers.`),
    n('textbox', 'Departure', [], { value: o.dep ?? 'Thu, 5 Nov' }),
    n('textbox', 'Return', [], { value: o.ret ?? 'Sun, 15 Nov' }),
  ];
}

/** A settled results page shaped like the feasibility load's tree (roles and names only). */
export function resultsTree(
  o: {
    tab?: string;
    top?: FakeNode[];
    other?: FakeNode[];
    extra?: FakeNode[];
    count?: number;
    form?: FakeNode[];
  } = {},
): FakeNode {
  const top = o.top ?? [option(478)];
  const other = o.other ?? [option(451)];
  // why: the evidence's shape (2026-10-18): unnamed lists inside `main`, each after its level-3 heading
  return n('document', 'Google Flights', [
    ...(o.form ?? formNodes()),
    n('tablist', '', [n('tab', 'Best'), n('tab', o.tab ?? 'Cheapest from 451 British pounds')]),
    text(`${o.count ?? top.length + other.length} results returned.`),
    n('main', '', [
      n('heading', 'Top departing flights'),
      n('list', '', top),
      n('heading', 'Other departing flights'),
      n('list', '', other),
    ]),
    n('button', 'View more flights'),
    n('button', 'Date grid'),
    n('button', 'Currency GBP'),
    n('button', 'Location·United Kingdom'),
    ...(o.extra ?? []),
  ]);
}

function nameMatches(actual: string, want: string | RegExp | undefined, exact: boolean | undefined): boolean {
  if (want === undefined) return true;
  if (typeof want !== 'string') return want.test(actual);
  return exact === true ? actual === want : actual.toLowerCase().includes(want.toLowerCase());
}
export function descendants(nodes: readonly FakeNode[]): FakeNode[] {
  const out: FakeNode[] = [];
  const walk = (x: FakeNode): void => {
    for (const c of x.children ?? []) {
      out.push(c);
      walk(c);
    }
  };
  for (const x of nodes) walk(x);
  return out;
}
const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

export interface Calls {
  timeouts: number[];
  clicks: string[];
  gotos: Array<{ url: string; timeout: number | undefined; waitUntil: string | undefined }>;
  closed: number;
}

export class FakeLocator implements LocatorLike {
  constructor(
    private readonly page: FakePage,
    private readonly find: () => FakeNode[],
    /** This locator's count never answers when this returns true (selectedQueryHang). */
    private readonly countHangs: () => boolean = () => false,
  ) {}
  private node(): FakeNode | undefined {
    return this.find()[0];
  }
  private read<T>(o: { timeout?: number } | undefined, f: (x: FakeNode) => T): Promise<T> {
    if (o?.timeout !== undefined) this.page.calls.timeouts.push(o.timeout);
    if (this.page.isClosed)
      return Promise.reject(new Error('Target page, context or browser has been closed'));
    const x = this.node();
    if (x === undefined) return Promise.reject(new Error('locator resolved to no element'));
    if (x.hang === true || this.page.hangAll) return this.page.hangUntilClosed<T>();
    return Promise.resolve(f(x));
  }
  count(): Promise<number> {
    if (this.page.isClosed)
      return Promise.reject(new Error('Target page, context or browser has been closed'));
    if (this.page.hangAll || this.countHangs() || this.find().some((x) => x.countHang === true))
      return this.page.hangUntilClosed<number>();
    return Promise.resolve(this.find().length);
  }
  nth(index: number): FakeLocator {
    return new FakeLocator(this.page, () => {
      const x = this.find()[index];
      return x === undefined ? [] : [x];
    });
  }
  getAttribute(name: string, o?: { timeout?: number }): Promise<string | null> {
    return this.read(o, (x) =>
      name === 'aria-label'
        ? x.ariaLabel === undefined
          ? (x.name ?? null)
          : x.ariaLabel
        : name === 'aria-selected'
          ? (x.ariaSelectedAttr ?? String(x.selected === true))
          : name === 'role'
            ? (x.role ?? null)
            : null,
    );
  }
  textContent(o?: { timeout?: number }): Promise<string | null> {
    return this.read(o, (x) => (x.text === undefined ? (x.name ?? null) : x.text));
  }
  inputValue(o?: { timeout?: number }): Promise<string> {
    return this.read(o, (x) => x.value ?? '');
  }
  click(o?: { timeout?: number }): Promise<void> {
    if (this.node()?.clickHang === true) return this.page.hangUntilClosed<void>();
    return this.read(o, (x) => {
      this.page.calls.clicks.push(`${x.role ?? ''}:${x.name ?? ''}`);
      // why: as in the browser, a clicked tab becomes the selected one
      if (x.role === 'tab') x.selected = true;
      this.page.onClick(x);
    });
  }
  getByRole(
    role: Role,
    o: { name?: string | RegExp; exact?: boolean; selected?: boolean } = {},
  ): FakeLocator {
    const all = () => descendants(this.find()).filter((x) => roleMatches(x, role, o));
    return new FakeLocator(
      this.page,
      all,
      () => o.selected === true && candidates(descendants(this.find()), role, o),
    );
  }
  getByText(t: string | RegExp, o: { exact?: boolean } = {}): FakeLocator {
    return new FakeLocator(this.page, () => innermost(descendants(this.find()), t, o.exact));
  }
  innerText(o?: { timeout?: number }): Promise<string> {
    if (this.node()?.innerTextHang === true) return this.page.hangUntilClosed<string>();
    return this.read(o, (x) =>
      descendants([x])
        .map((c) => (c.text === undefined ? (c.role === 'text' ? (c.name ?? '') : '') : (c.text ?? '')))
        .filter((t) => t !== '')
        .join('\n'),
    );
  }
  /** `locator('*')`: every element below this one, in document order (the only selector the worker uses). */
  locator(selector: '*'): FakeLocator {
    return new FakeLocator(this.page, () =>
      selector === '*' ? descendants(this.find()).filter((x) => x.role !== 'text') : [],
    );
  }
  ariaSnapshot(o?: { timeout?: number }): Promise<string> {
    return this.read(o, (x) => printed(x, 0).join('\n'));
  }
  isVisible(): Promise<boolean> {
    const x = this.node();
    return Promise.resolve(x !== undefined && x.hidden !== true);
  }
}

/** A synthetic printed snapshot in Playwright's YAML-like shape: `- role "name":`, children indented, a link's `/url:`. */
function printed(x: FakeNode, depth: number): string[] {
  const pad = '  '.repeat(depth);
  if (x.role === 'text') return [`${pad}- text: ${x.name ?? ''}`];
  const kids = [
    ...(x.href === undefined ? [] : [`${pad}  - /url: ${x.href}`]),
    ...(x.children ?? []).flatMap((c) => printed(c, depth + 1)),
  ];
  const head = `${pad}- ${x.role ?? 'generic'}${x.name === undefined || x.name === '' ? '' : ` "${x.name}"`}`;
  return kids.length === 0 ? [head] : [`${head}:`, ...kids];
}

/** Playwright's role query: the role, the accessible name and, when asked, the selected state. */
function roleMatches(
  x: FakeNode,
  role: Role,
  o: { name?: string | RegExp; exact?: boolean; selected?: boolean },
): boolean {
  if (x.role !== role || !nameMatches(x.name ?? '', o.name, o.exact)) return false;
  return o.selected === undefined || (x.selected === true) === o.selected;
}
/** True when a node the query would consider is marked to make a selected-state query hang. */
function candidates(nodes: FakeNode[], role: Role, o: { name?: string | RegExp; exact?: boolean }): boolean {
  return nodes.some(
    (x) => x.role === role && nameMatches(x.name ?? '', o.name, o.exact) && x.selectedQueryHang === true,
  );
}

/**
 * Playwright's text matching returns the innermost elements whose text matches: an element whose match comes from a
 * child that matches too is left out.
 */
function innermost(nodes: FakeNode[], t: string | RegExp, exact: boolean | undefined): FakeNode[] {
  return nodes.filter(
    (x) => textMatches(x, t, exact) && !descendants([x]).some((c) => textMatches(c, t, exact)),
  );
}

function textMatches(x: FakeNode, t: string | RegExp, exact: boolean | undefined): boolean {
  const content = x.text === undefined ? (x.role === 'text' ? (x.name ?? '') : '') : (x.text ?? '');
  return content !== '' && nameMatches(content, t, exact);
}

export interface Navigation {
  /** The main-frame URLs of the navigation: the first is requested, each later one redirected from the one before. */
  hops: string[];
  /** The tree the page shows after it, or an error goto rejects with. */
  tree?: FakeNode;
  throws?: string;
  /** Sub-frame URLs that load with the page. */
  frames?: string[];
  hang?: boolean;
}

/** A scripted page. `trees` are what successive `readFacts` polls see (the last repeats). */
export class FakePage implements PageLike {
  readonly calls: Calls = { timeouts: [], clicks: [], gotos: [], closed: 0 };
  isClosed = false;
  hangAll = false;
  closeThrows = false;
  closeHangs = false;
  private current = 'about:blank';
  private frameList: string[] = [];
  private polls = 0;
  private trees: FakeNode[] = [n('document', '')];
  private readonly navListeners: Array<(f: FrameLike) => void> = [];
  private readonly closers: Array<() => void> = [];
  onClick: (x: FakeNode) => void = () => undefined;

  constructor(
    private readonly context: FakeContext | null,
    private readonly navigation: Navigation | null = null,
  ) {}

  setTrees(trees: FakeNode[]): void {
    this.trees = trees;
    this.polls = 0;
  }
  setUrl(url: string): void {
    this.current = url;
  }
  hangUntilClosed<T>(): Promise<T> {
    return new Promise<T>((_resolve, reject) => {
      this.closers.push(() => reject(new Error('Target page, context or browser has been closed')));
    });
  }
  private tree(): FakeNode {
    const t = this.trees[Math.min(this.polls, this.trees.length - 1)];
    return t ?? n('document', '');
  }
  private mainFrame: FrameLike = { url: () => this.current, parentFrame: () => null };

  async goto(url: string, o?: { timeout?: number; waitUntil?: 'domcontentloaded' }): Promise<unknown> {
    this.calls.gotos.push({ url, timeout: o?.timeout, waitUntil: o?.waitUntil });
    if (o?.timeout !== undefined) this.calls.timeouts.push(o.timeout);
    const nav = this.navigation ?? { hops: [url] };
    if (nav.hang === true) return this.hangUntilClosed();
    let prev: RequestLike | null = null;
    const frame = this.mainFrame;
    for (const [i, hop] of nav.hops.entries()) {
      const from: RequestLike | null = prev;
      const req: RequestLike = {
        url: () => hop,
        isNavigationRequest: () => true,
        method: () => 'GET',
        redirectedFrom: () => from,
        frame: () => frame,
      };
      this.context?.emitRequest(req);
      // why: context.route sees only the first URL of a redirect chain (playwright-core 1.59.1).
      if (i === 0 && this.context !== null && (await this.context.routeRequest(req)) === 'aborted')
        throw new Error('NS_ERROR_FAILURE: navigation aborted (blockedbyclient)');
      prev = req;
    }
    for (const f of nav.frames ?? []) {
      const sub: FrameLike = { url: () => f, parentFrame: () => frame };
      this.context?.emitRequest({
        url: () => f,
        isNavigationRequest: () => true,
        method: () => 'GET',
        redirectedFrom: () => null,
        frame: () => sub,
      });
      this.frameList.push(f);
    }
    if (nav.throws !== undefined) throw new Error(nav.throws);
    this.current = nav.hops.at(-1) ?? url;
    for (const l of this.navListeners) l(this.mainFrame);
    if (nav.tree !== undefined) this.setTrees([nav.tree]);
    return null;
  }
  url(): string {
    // why: the driver reads the URL once per readFacts, so each read is one poll of the scripted trees.
    const u = this.current;
    this.polls += 1;
    return u;
  }
  frames(): FrameLike[] {
    const main = this.mainFrame;
    return [main, ...this.frameList.map((f) => ({ url: () => f, parentFrame: () => main }))];
  }
  /** Fires framenavigated for `frame` (a sub-frame, or the main frame again). */
  emitFrameNavigated(frame: FrameLike): void {
    for (const l of this.navListeners) l(frame);
  }
  on(event: 'framenavigated', listener: (f: FrameLike) => void): unknown {
    if (event === 'framenavigated') this.navListeners.push(listener);
    return this;
  }
  private root(): FakeNode[] {
    // why: the first poll (the url() read) has already advanced the counter, so the tree index is polls − 1.
    const t = this.trees[Math.min(Math.max(0, this.polls - 1), this.trees.length - 1)];
    return [t ?? this.tree()];
  }
  getByRole(
    role: Role,
    o: { name?: string | RegExp; exact?: boolean; selected?: boolean } = {},
  ): FakeLocator {
    return new FakeLocator(
      this,
      () => descendants(this.root()).filter((x) => roleMatches(x, role, o)),
      () => o.selected === true && candidates(descendants(this.root()), role, o),
    );
  }
  getByText(t: string | RegExp, o: { exact?: boolean } = {}): FakeLocator {
    return new FakeLocator(this, () => innermost(descendants(this.root()), t, o.exact));
  }
  close(): Promise<void> {
    this.calls.closed += 1;
    this.isClosed = true;
    for (const c of this.closers.splice(0)) c();
    if (this.closeHangs) return never();
    if (this.closeThrows) return Promise.reject(new Error('close failed'));
    return Promise.resolve();
  }
}
