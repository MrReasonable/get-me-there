// A fake Playwright BrowserContext (ContextLike): scripted cookies, recorded addCookies calls, the route handler and
// request listeners the guard registers, and pages the test scripts. Synthetic values only.
import type {
  ContextLike,
  CookieInput,
  CookieLike,
  PageLike,
  RequestLike,
  RouteLike,
} from '../../src/driver.js';
import { FakePage, type Navigation } from './fakePage.js';

export class FakeContext implements ContextLike {
  jar: CookieLike[] = [];
  readonly added: CookieInput[][] = [];
  readonly cookieCalls: Array<string | string[] | undefined> = [];
  readonly routes: Array<{ url: string; handler: (route: RouteLike, request: RequestLike) => unknown }> = [];
  readonly requestListeners: Array<(r: RequestLike) => void> = [];
  readonly pages: FakePage[] = [];
  readonly seen: string[] = [];
  closed = 0;
  addCookiesThrows = false;
  newPageThrows = false;
  /** Fix round 1 (prov-int I1): the calls before a page opens, each never resolving. */
  addCookiesHangs = false;
  newPageHangs = false;
  routeHangs = false;
  /** When set, cookies() never resolves on the call with this index (0-based). */
  hangCookiesOn: number | null = null;
  /** Called after each page load to change the jar (Google rewriting SOCS, a sign-in…). */
  afterGoto: (jar: CookieLike[]) => CookieLike[] = (jar) => jar;
  /** The navigation each new page performs, in order (the last repeats). */
  navigations: Navigation[] = [];
  /** Hook for tests to shape each new page before the session uses it. */
  onNewPage: (p: FakePage) => void = () => undefined;

  cookies(urls?: string | string[]): Promise<CookieLike[]> {
    const i = this.cookieCalls.length;
    this.cookieCalls.push(urls);
    if (this.hangCookiesOn === i) return new Promise(() => undefined);
    return Promise.resolve(this.jar.map((c) => ({ ...c })));
  }
  addCookies(cookies: CookieInput[]): Promise<void> {
    if (this.addCookiesHangs) return new Promise(() => undefined);
    if (this.addCookiesThrows) return Promise.reject(new Error('addCookies failed'));
    this.added.push(cookies);
    for (const c of cookies) {
      this.jar = this.jar.filter((x) => !(x.name === c.name && x.domain === c.domain));
      this.jar.push({ name: c.name, value: c.value, domain: c.domain, path: c.path });
    }
    return Promise.resolve();
  }
  route(url: string, handler: (route: RouteLike, request: RequestLike) => unknown): Promise<void> {
    this.routes.push({ url, handler });
    if (this.routeHangs) return new Promise(() => undefined);
    return Promise.resolve();
  }
  on(event: 'request', listener: (r: RequestLike) => void): unknown {
    if (event === 'request') this.requestListeners.push(listener);
    return this;
  }
  emitRequest(r: RequestLike): void {
    this.seen.push(r.url());
    for (const l of this.requestListeners) l(r);
  }
  /** Runs the registered route handlers as Playwright would (the last registered first); 'aborted' or 'continued'. */
  async routeRequest(r: RequestLike): Promise<'aborted' | 'continued'> {
    let outcome: 'aborted' | 'continued' = 'continued';
    for (const { handler } of [...this.routes].reverse()) {
      let fellBack = false;
      const route: RouteLike = {
        request: () => r,
        abort: () => {
          outcome = 'aborted';
          return Promise.resolve();
        },
        fallback: () => {
          fellBack = true;
          return Promise.resolve();
        },
      };
      await handler(route, r);
      if (!fellBack) break;
    }
    return outcome;
  }
  newPage(): Promise<FakePage> {
    if (this.newPageHangs) return new Promise(() => undefined);
    if (this.newPageThrows) return Promise.reject(new Error('newPage failed'));
    const nav = this.navigations[Math.min(this.pages.length, this.navigations.length - 1)] ?? null;
    const p = new FakePage(this, nav);
    const original = p.goto.bind(p);
    p.goto = async (url, o) => {
      const r = await original(url, o);
      this.jar = this.afterGoto(this.jar);
      return r;
    };
    this.pages.push(p);
    this.onNewPage(p);
    return Promise.resolve(p);
  }
  close(): Promise<void> {
    this.closed += 1;
    return Promise.resolve();
  }
}
