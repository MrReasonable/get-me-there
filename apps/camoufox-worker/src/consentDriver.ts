import type { Clock, Logger } from '@gmt/core';
import { checkAccountCookies } from './accountCookies.js';
import type { PageFacts } from './classify.js';
import { installConsentCaptureGuard } from './consentGuard.js';
import {
  createDriver,
  type HeadedContextLike,
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
export type PageView = PageFacts;

/** The display variables a headed window may receive, in their two groups (never DBUS_SESSION_BUS_ADDRESS). */
export interface DisplayEnv {
  x11: { DISPLAY: string; XAUTHORITY?: string } | null;
  wayland: { WAYLAND_DISPLAY: string; XDG_RUNTIME_DIR: string } | null;
}

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
  /** The classifier's input, read-only. */
  snapshotView(): Promise<PageView>;
  /** SOCS by name and domain; other cookies dropped as read. */
  socsCookie(): Promise<SocsFields | null>;
  accountCookieSeen(): Promise<boolean>;
  closed(): boolean;
  close(): Promise<void>;
}

/** A machine with no display: the capture runs on a desktop instead (`gmt consent export`, then `import` here). */
export const NO_DISPLAY =
  'there is no display for the consent window (neither DISPLAY nor WAYLAND_DISPLAY is set): run pnpm gmt consent export on a desktop where pnpm gmt setup has run, and pipe its line into pnpm gmt consent import here';
export class NoDisplay extends Error {
  constructor() {
    super(NO_DISPLAY);
    this.name = 'NoDisplay';
  }
}

/**
 * The display groups from an environment (run.ts reads them for the `consent` entry only): DISPLAY with XAUTHORITY when
 * DISPLAY is set, WAYLAND_DISPLAY with XDG_RUNTIME_DIR when WAYLAND_DISPLAY is set. Pure.
 */
export function displayEnvOf(env: Readonly<Record<string, string | undefined>>): DisplayEnv {
  const set = (v: string | undefined): v is string => v !== undefined && v !== '';
  const x = env.DISPLAY;
  const w = env.WAYLAND_DISPLAY;
  const xauth = env.XAUTHORITY;
  return {
    x11: set(x) ? { DISPLAY: x, ...(set(xauth) ? { XAUTHORITY: xauth } : {}) } : null,
    wayland: set(w) ? { WAYLAND_DISPLAY: w, XDG_RUNTIME_DIR: env.XDG_RUNTIME_DIR ?? '' } : null,
  };
}

/**
 * The variables the headed window adds to the browser's minimal environment: each group present only when its main
 * variable is set, nothing else (never DBUS_SESSION_BUS_ADDRESS). On Linux with neither group it refuses (NoDisplay);
 * macOS needs none.
 */
export function headedEnv(display: DisplayEnv, platform: string): Record<string, string> {
  if (platform === 'linux' && display.x11 === null && display.wayland === null) throw new NoDisplay();
  return { ...(display.x11 ?? {}), ...(display.wayland ?? {}) };
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
  let page: PageLike | null = null;
  let guard: Awaited<ReturnType<typeof installConsentCaptureGuard>> | null = null;
  let loaded = false;
  let isClosed = false;
  const hosts: string[] = [];
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
    async snapshotView() {
      const { p } = live();
      const g = guard;
      if (g === null) throw new ConsentDriverMisuse('the consent window has no guard');
      const d = o.timers.deadline(LOOKUP_TIMEOUT_MS * 6);
      try {
        return (await createDriver(p, g, S).readFacts(d)).page;
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
    closed: () => isClosed,
    async close() {
      const c = context;
      context = null;
      page = null;
      isClosed = true;
      if (c !== null) await c.close().catch(() => undefined);
    },
  };
}
