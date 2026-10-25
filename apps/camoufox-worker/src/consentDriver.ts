import { type BlockedPage, type Clock, CONSENT_FIX, type Logger } from '@gmt/core';
import { checkAccountCookies } from './accountCookies.js';
import type { PageFacts } from './classify.js';
import { installConsentCaptureGuard } from './consentGuard.js';
import {
  createDriver,
  type HeadedContextLike,
  type HeadedPageLike,
  LOOKUP_TIMEOUT_MS,
  type PageLike,
  type RequestLike,
} from './driver.js';
import type { LaunchOptions } from './launch.js';
import { SELECTORS, type Selectors } from './selectors.js';
import { SOCS_DOMAIN, SOCS_NAME } from './socs.js';
import type { Timers } from './timers.js';

/**
 * The consent capture's only browser access (spec §2 "Consent"; decision 74; brief WP17 §5 and Task 17.4). A person
 * clicks in a visible window; the tool only observes: one load of the landing page, the main frame's hosts as it
 * navigates, the classifier's view of a snapshot, and SOCS by name and domain (every other cookie dropped as it is
 * read), plus whether an account cookie has appeared. It exposes no click, no typing, no navigation after the one load
 * and no script evaluation, and this module is the only holder of the page and context handles; the consent command
 * and the research recorder see this interface only.
 */
/** The consent host's path the person's choice is POSTed to. */
export const CONSENT_SAVE_PATH = '/save';

export type PageView = PageFacts & {
  /** The page's heading names, so a recording can date the landing view's selectors (never parsed here). */
  headings: string[];
};

/**
 * The display variables a headed window may receive: exactly what run.ts's `displayOf` passes the entries that open one
 * (decision 74's two groups: DISPLAY with XAUTHORITY, WAYLAND_DISPLAY with XDG_RUNTIME_DIR; never
 * DBUS_SESSION_BUS_ADDRESS). One rule builds it (ca-b1-013, sec-b1-006), so this module reads no environment.
 */
export type DisplayEnv = Readonly<Record<string, string>>;

/** SOCS as the capture reads it: the fields `parseCapture` checks, nothing else. */
export interface SocsFields {
  value: string;
  domain: string;
  path: string;
  expires: number;
  secure: boolean;
  sameSite: string;
}

export interface ConsentDriver {
  launchHeaded(display: DisplayEnv): Promise<void>;
  load(url: string): Promise<void>;
  /** Every host the main frame navigated to, in order. */
  mainFrameHosts(): readonly string[];
  /** The POSTs to the consent host's `/save` seen so far: the person's choice being submitted (method and URL only). */
  consentSaves(): number;
  /** The page kind the guard refused a main-frame navigation as (CodeRabbit, PR #15), or null. */
  refused(): BlockedPage | null;
  /** The classifier's input, read-only. */
  snapshotView(): Promise<PageView>;
  /** SOCS by name and domain; other cookies dropped as read. */
  socsCookie(): Promise<SocsFields | null>;
  accountCookieSeen(): Promise<boolean>;
  closed(): boolean;
  close(): Promise<void>;
}

/**
 * A machine with no display (brief WP17 Task 17.4, decision 74): the refusal points at export and import, the capture
 * made on a desktop and carried here as one line, and at capture-socs, the lighter equal option.
 */
export const NO_DISPLAY = `there is no display for a browser window here (neither DISPLAY nor WAYLAND_DISPLAY is set): on a desktop that has run pnpm gmt setup, run ${CONSENT_FIX.command} export and pipe its line into ${CONSENT_FIX.command} import here, or enter the cookie from an ordinary private window with pnpm --filter @gmt/camoufox-worker capture-socs (docs/setup.md#on-a-machine-with-no-display)`;
export class NoDisplay extends Error {
  constructor() {
    super(NO_DISPLAY);
    this.name = 'NoDisplay';
  }
}

/**
 * The variables the headed window adds to the browser's minimal environment: the display groups run.ts passed, nothing
 * else. On Linux with neither DISPLAY nor WAYLAND_DISPLAY it refuses (NoDisplay); macOS needs none.
 */
export function headedEnv(display: DisplayEnv, platform: string): Record<string, string> {
  if (platform === 'linux' && display.DISPLAY === undefined && display.WAYLAND_DISPLAY === undefined)
    throw new NoDisplay();
  return { ...display };
}

export class ConsentDriverMisuse extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConsentDriverMisuse';
  }
}

/** The real driver over a headed context; `onRequest` sees each request (the research recorder's listener). */
export function createConsentDriver(o: {
  platform: string;
  options: LaunchOptions;
  profileDir: string;
  launch: (
    options: LaunchOptions,
    profile: string,
    display: Readonly<Record<string, string>>,
  ) => Promise<HeadedContextLike>;
  log: Logger;
  clock: Clock;
  timers: Timers;
  selectors?: Selectors;
  onRequest?: (r: RequestLike) => void;
}): ConsentDriver {
  const S = o.selectors ?? SELECTORS;
  let context: HeadedContextLike | null = null;
  let page: HeadedPageLike | null = null;
  let guard: Awaited<ReturnType<typeof installConsentCaptureGuard>> | null = null;
  let loaded = false;
  let isClosed = false;
  const hosts: string[] = [];
  let saves = 0;
  const live = (): { c: HeadedContextLike; p: PageLike } => {
    if (context === null || page === null) throw new ConsentDriverMisuse('the consent window is not open');
    return { c: context, p: page };
  };
  return {
    async launchHeaded(display) {
      if (context !== null) throw new ConsentDriverMisuse('the consent window is already open');
      const c = await o.launch(o.options, o.profileDir, headedEnv(display, o.platform));
      context = c;
      c.on('close', () => {
        isClosed = true;
      });
      c.on('request', (r) => {
        // why: the choice's submission is seen by its method and URL only; the research reads bodies through onRequest
        if (r.method() !== 'POST') return;
        try {
          const u = new URL(r.url());
          if (u.hostname === S.hosts.consent && u.pathname === CONSENT_SAVE_PATH) saves++;
        } catch {
          // why: an unparsable URL is no consent submission
        }
      });
      if (o.onRequest !== undefined) c.on('request', o.onRequest);
      const p = await c.newPage();
      page = p;
      guard = await installConsentCaptureGuard(c, p, o.log, S);
      p.on('framenavigated', (f) => {
        if (f.parentFrame() !== null) return;
        try {
          hosts.push(new URL(f.url()).hostname);
        } catch {
          hosts.push('unparsable');
        }
      });
    },
    async load(url) {
      const { p } = live();
      if (loaded) throw new ConsentDriverMisuse('the consent window loads one page only');
      loaded = true;
      await p.goto(url, { waitUntil: 'domcontentloaded' });
    },
    mainFrameHosts: () => [...hosts],
    consentSaves: () => saves,
    refused: () => guard?.refused ?? null,
    async snapshotView() {
      const { p } = live();
      const g = guard;
      if (g === null) throw new ConsentDriverMisuse('the consent window has no guard');
      const d = o.timers.deadline(LOOKUP_TIMEOUT_MS * 6);
      try {
        const driver = createDriver(p, g, S);
        const facts = (await driver.readFacts(d)).page;
        return { ...facts, headings: await driver.headingNames(d) };
      } finally {
        d.clear();
      }
    },
    async socsCookie() {
      const { c } = live();
      for (const k of await c.cookies()) {
        if (k.name !== SOCS_NAME || k.domain !== SOCS_DOMAIN) continue;
        return {
          value: k.value,
          domain: k.domain,
          path: k.path,
          expires: k.expires ?? Number.NaN,
          secure: k.secure ?? false,
          sameSite: k.sameSite ?? '',
        };
      }
      return null;
    },
    async accountCookieSeen() {
      return (await checkAccountCookies(live().c, o.clock)).found;
    },
    // why: a read on a page the person has just closed can fail before the context's close event arrives; the page
    // itself already says it is closed then (2026-10-25)
    closed: () => isClosed || (page?.isClosed() ?? false),
    async close() {
      const c = context;
      context = null;
      page = null;
      isClosed = true;
      if (c !== null) await c.close().catch(() => undefined);
    },
  };
}
