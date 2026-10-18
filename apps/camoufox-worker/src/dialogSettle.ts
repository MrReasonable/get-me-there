/**
 * The settle and reads both dialog flows share (the Price graph exploration and the date grid, WP15 Task 15.1): a poll
 * that classifies the page on every read and waits until a printed snapshot holds still, the first visible tabpanel,
 * and the panel's button and day-cell names. The printed snapshot is only compared here, hashed in memory; the recorders
 * store it for people to read, and nothing parses it (rules.test.ts pins `ariaSnapshot` to this module and graph.ts).
 */
import { createHash } from 'node:crypto';
import type { BlockedPage } from '@gmt/core';
import { type ClassifyRule, classifyPageWithRule, type PageFacts } from './classify.js';
import {
  CheapestStepFailed,
  countOf,
  type Driver,
  LOOKUP_TIMEOUT_MS,
  type LocatorLike,
  nameOf,
  POLL_TIMEOUT_MS,
  runStep,
  type SettleFacts,
  type StepOptions,
} from './driver.js';
import { STABLE_MS } from './ready.js';
import type { Selectors } from './selectors.js';
import type { Deadline, Timers } from './timers.js';

/** At most this many controls of one role are named (a graph may hold one per day); the rest are counted. */
export const MAX_CONTROLS_PER_ROLE = 1000;

export type Facts = { page: PageFacts; settle: SettleFacts };
export type Blocked = { kind: 'blocked'; page: BlockedPage; rule: ClassifyRule; facts: Facts };

/** A control inside a region or panel: its role and accessible name (`null` when unreadable or over the limit). */
export interface Control {
  role: 'button' | 'link' | 'tab' | 'slider' | 'option' | 'gridcell';
  name: string | null;
}

/**
 * An exploration step that overran or failed (ruling of 2026-10-18, the run on 802e405): recorded, and the run goes on.
 * Only a classifier stop or the page deadline ends the run once the dialog has settled.
 */
export interface Skipped {
  step: string;
  reason: string;
  timedOut: boolean;
}

/** Runs a step whose overrun or failure is recorded instead of ending the run; the page deadline still ends it. */
export async function soft<T>(
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; skipped: Skipped }> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    if (!(e instanceof CheapestStepFailed)) throw e;
    return { ok: false, skipped: { step: e.step, reason: e.reason, timedOut: e.reason === 'timed-out' } };
  }
}

/** The names of every button and day cell in the panel, buttons first. */
export async function readCells(panel: LocatorLike, d: Deadline, S: Selectors): Promise<Control[]> {
  const out: Control[] = [];
  for (const role of ['button', 'gridcell'] as const) {
    const l = panel.getByRole(role);
    for (let i = 0, n = Math.min(await countOf(l, d), MAX_CONTROLS_PER_ROLE); i < n; i++) {
      const name = await nameOf(l.nth(i), d);
      out.push({ role, name: name === null || name.length > S.maxNameLength ? null : name });
    }
  }
  return out;
}

/** The first visible tabpanel in the container, or the container itself when none is. */
export async function panelOf(
  container: LocatorLike,
  d: Deadline,
): Promise<{ locator: LocatorLike; found: number; index: number | null }> {
  const panels = container.getByRole('tabpanel');
  const found = await countOf(panels, d);
  for (let i = 0; i < found; i++)
    if (await d.race(panels.nth(i).isVisible())) return { locator: panels.nth(i), found, index: i };
  return { locator: container, found, index: null };
}

/** What a settle needs besides its deadline: the timers, the poll interval and the selectors. */
export interface SettleOptions {
  timers: Timers;
  pollMs: number;
  S: Selectors;
  /** Polling stops while less than this is left of the deadline (what the reads after it need). */
  reserveMs: number;
}

/** One poll's find: the value, the container's identity, its printed snapshot and, for a moved view, its change key. */
export interface Found<T> {
  value: T;
  id: string;
  snapshot: string;
  /** What must differ from `differsFrom` before the view counts (a grid view's departures and returns lines). */
  changeKey?: string;
}

export interface Settled<T> {
  kind: 'settled';
  value: T;
  snapshot: string;
  changeKey: string | undefined;
  polls: number;
  facts: Facts;
  rule: ClassifyRule;
  pageKind: string;
}

/**
 * Polls `find` (classified on every poll: a blocked kind other than unrecognised is that stop at once) until the printed
 * snapshot it names holds still across two polls at least STABLE_MS apart. With `differsFrom`, a poll whose change key
 * equals it (the view before a scroll) never counts (WP15 ruling 9). `name` names the steps (`<name>-poll`) and the
 * overrun (`<name>-settle`, thrown when less than the reserve is left).
 */
export async function settle<T>(
  name: string,
  driver: Pick<Driver, 'readFacts'>,
  d: Deadline,
  o: SettleOptions,
  steps: StepOptions,
  find: (st: Deadline) => Promise<Found<T>>,
  differsFrom?: string,
): Promise<Settled<T> | Blocked> {
  let previous: { key: string; at: number } | null = null;
  for (let polls = 1; ; polls++) {
    if (d.remaining() < o.reserveMs) throw new CheapestStepFailed(`${name}-settle`, 'timed-out');
    // why: the page is classified before the container is looked for, so a challenge that replaced the dialog is that
    // stop, never a failed lookup
    const step = await runStep(`${name}-poll`, POLL_TIMEOUT_MS, d, steps, async (st) => {
      const read = await driver.readFacts(st, { timers: o.timers, lookupMs: LOOKUP_TIMEOUT_MS });
      const c = classifyPageWithRule(read.page, o.S);
      const stop = c.kind.kind === 'blocked' && c.kind.page !== 'unrecognised';
      return { read, c, found: stop ? null : await find(st) };
    });
    const facts = { page: step.read.page, settle: step.read.settle };
    const { kind, rule } = step.c;
    if (kind.kind === 'blocked' && kind.page !== 'unrecognised')
      return { kind: 'blocked', page: kind.page, rule, facts };
    const poll = step.found;
    if (poll === null) throw new CheapestStepFailed(`${name}-poll`, 'failed');
    const key = `${poll.id}:${createHash('sha256').update(poll.snapshot).digest('hex')}`;
    const at = o.timers.now();
    const moved = differsFrom === undefined || poll.changeKey !== differsFrom;
    // why: settled means stable content: the same container and the same printed snapshot across two polls 2 s apart,
    // and, after a scroll, a view that is no longer the one before it
    const stable =
      moved &&
      poll.snapshot.trim() !== '' &&
      previous !== null &&
      previous.key === key &&
      at - previous.at >= STABLE_MS;
    steps.log?.debug(
      {
        view: name,
        elapsedMs: at - (steps.startedAt ?? at),
        container: poll.id,
        snapshotLength: poll.snapshot.length,
        moved,
        stable,
      },
      'dialog poll',
    );
    if (stable)
      return {
        kind: 'settled',
        value: poll.value,
        snapshot: poll.snapshot,
        changeKey: poll.changeKey,
        polls,
        facts,
        rule,
        pageKind: kind.kind,
      };
    previous = moved ? { key, at } : null;
    await o.timers.sleep(o.pollMs, d.signal);
  }
}

/** A locator's printed snapshot within the step's deadline (the settle's comparison and the recorders' copy). */
export function snapshotOf(l: LocatorLike, st: Deadline): Promise<string> {
  return st.race(l.ariaSnapshot({ timeout: Math.max(1, st.remaining()) }));
}
