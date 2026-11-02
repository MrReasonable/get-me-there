/** The definition response and the confirmation rule (spec §7, §8.1, §10; plan decisions 25, 37, 42, 43). */
import {
  type apiContract,
  type BudgetFit,
  type DefinitionInput,
  type Estimate,
  microGbpToPence,
  type ProviderId,
  type SearchDefinition,
} from '@gmt/core';
import {
  type Confirmation,
  type ConfirmationContext,
  capKindOf,
  confirmationNeeded,
  confirmationOf,
  type LineKey,
  lineKey,
} from '@gmt/engine';
import type { z } from 'zod';
import type { RouteContext } from '../routes/types.js';
import { API_TEXT } from '../text.js';
import type { Ports } from '../wiring.js';
import { isDraft } from './space.js';
import { providerBudget } from './usage.js';

export type DefinitionResponse = z.infer<typeof apiContract.definitionResponseSchema>;

/** The budgetFit of a draft: nothing to search, nothing to fit. */
export const ZERO_BUDGET_FIT: BudgetFit = { fits: true, runsPerMonth: 0, perScope: [] };

/**
 * WP7's own confirmation rule over the api's ports (plan decision 58): the soft-confirm threshold, the guard's caps and
 * each provider's cap scope through the engine's `capKindOf`, so the form asks exactly when a start would be refused
 * with `confirm`; every provider's window is the guard's own budget entry (db's `budgetConfigFromConfig`).
 */
function confirmationContext(ports: Ports): ConfirmationContext {
  return {
    config: ports.config,
    budget: ports.budget,
    limitsOf: (id: ProviderId) => ({
      capKind: capKindOf(providerBudget(ports.config, id).window),
    }),
  };
}

/** The estimate lines a cap blocks today, as the engine's line keys (`Estimate.perProvider[].blocked`). */
function blockedLines(estimate: Estimate): Set<LineKey> {
  return new Set(
    estimate.perProvider.filter((p) => p.blocked !== null).map((p) => lineKey(p.stage, p.providerId)),
  );
}

/**
 * Decision 54 with WP7's `confirmationOf`: an operator's sent confirmation covers the definition when it names at
 * least the worst-case figures (every line, blocked ones included) — the figures `needsConfirmation` shows and the
 * store records, so a provider back from a cap next month is still covered.
 */
export function sentCovers(c: Confirmation, estimate: Estimate): boolean {
  const worst = confirmationOf(estimate);
  return c.pence !== null && c.calls !== null && c.pence >= worst.pence && c.calls >= worst.calls;
}

/**
 * Spec revision 55 §7, §10: the shown totals of an estimate, the runnable (unblocked) lines' pence and calls, which the
 * sentence beside Search now and Repeat weekly's Save shows and which they store as the confirmation when the sent
 * figures cover them. WP8's PUT keeps storing `confirmationOf`'s worst case over every line.
 */
export function runnableTotalsOf(e: Pick<Estimate, 'perProvider'>): { pence: number; calls: number } {
  const runnable = e.perProvider.filter((p) => p.blocked === null);
  return {
    pence: microGbpToPence(runnable.reduce((a, p) => a + p.costMicroGbp, 0)),
    calls: runnable.reduce((a, p) => a + p.calls, 0),
  };
}

/** True when a sent confirmation names at least the shown runnable totals (`runnableTotalsOf`) in pence and in calls. */
export function sentCoversShown(c: { pence: number; calls: number }, estimate: Estimate): boolean {
  const shown = runnableTotalsOf(estimate);
  return c.pence >= shown.pence && c.calls >= shown.calls;
}

/**
 * `needsConfirmation` (decision 42 shape): the worst-case figures to confirm, with the stored confirmation, when a run
 * needs one and the stored confirmation does not cover it; else null. Never writes the confirmation (spec §7).
 */
export function needsConfirmation(
  def: Pick<SearchDefinition, 'confirmedCostPence' | 'confirmedCalls'>,
  estimate: Estimate,
  ports: Ports,
): DefinitionResponse['needsConfirmation'] {
  const stored: Confirmation = { pence: def.confirmedCostPence, calls: def.confirmedCalls };
  if (confirmationNeeded(confirmationContext(ports), estimate, blockedLines(estimate), stored) === null)
    return null;
  const worst = confirmationOf(estimate);
  return {
    estimateMicroGbp: estimate.perProvider.reduce((a, p) => a + p.costMicroGbp, 0),
    totalCalls: worst.calls,
    confirmedCostPence: def.confirmedCostPence,
    confirmedCalls: def.confirmedCalls,
  };
}

/**
 * Why pressing Search now confirms this estimate, as a code with its figures (spec §10, ruling A22): the engine's own
 * rule with nothing confirmed yet, so it is null exactly for a search within the thresholds and caps.
 */
export function softConfirmOf(
  estimate: Estimate,
  ports: Ports,
): z.infer<typeof apiContract.softConfirmSchema> | null {
  const needed = confirmationNeeded(confirmationContext(ports), estimate, blockedLines(estimate), {
    pence: null,
    calls: null,
  });
  return needed === null ? null : needed.why;
}

/** A partial record as the plain JSON object the contract declares (absent keys stay absent). */
function plain<V>(r: Partial<Record<string, V>>): Record<string, V> {
  const out: Record<string, V> = {};
  for (const [k, v] of Object.entries(r)) if (v !== undefined) out[k] = v;
  return out;
}

/** The stored definition in the contract's shape: notes and onward costs keyed by airport as plain objects. */
function wire(def: SearchDefinition) {
  return {
    ...def,
    destinationNotes: plain(def.destinationNotes),
    onwardCostPence: plain(def.onwardCostPence),
  };
}

/** Spec §10 definition response: the definition, its estimate and `budgetFit`, `needsConfirmation`, `notices`. */
export function definitionResponse(def: SearchDefinition, ctx: RouteContext): DefinitionResponse {
  if (isDraft(def))
    return {
      ...wire(def),
      estimate: null,
      budgetFit: ZERO_BUDGET_FIT,
      needsConfirmation: null,
      notices: [API_TEXT.draftNotice],
    };
  const estimate = ctx.engine.estimate(def, ctx.ports.clock.todayLondon());
  return {
    ...wire(def),
    estimate,
    budgetFit: ctx.engine.budgetFit(def),
    needsConfirmation: needsConfirmation(def, estimate, ctx.ports),
    notices: [],
  };
}

/** The response for a soft-deleted definition: its last state, marked deleted, nothing estimated. */
export function deletedResponse(def: SearchDefinition, ctx: RouteContext): DefinitionResponse {
  return {
    ...wire(def),
    enabled: false,
    deletedAt: ctx.ports.clock.now(),
    estimate: null,
    budgetFit: ZERO_BUDGET_FIT,
    needsConfirmation: null,
    notices: [API_TEXT.deletedNotice],
  };
}

/** A partial update as the definition-update schema yields it: absent fields are `undefined`. */
export type DefinitionPatch = { [K in keyof DefinitionInput]?: DefinitionInput[K] | undefined };

/** Spec §10 PUT: the stored definition with every field the update names replaced (null is a value, as for scheduleCron). */
export function mergeDefinition(e: DefinitionInput, p: DefinitionPatch): DefinitionInput {
  const v = <K extends keyof DefinitionInput>(k: K): DefinitionInput[K] => {
    const x = p[k];
    return x === undefined ? e[k] : x;
  };
  return {
    name: v('name'),
    origins: v('origins'),
    destinations: v('destinations'),
    window: v('window'),
    minNights: v('minNights'),
    maxNights: v('maxNights'),
    cabin: v('cabin'),
    constraints: v('constraints'),
    verification: v('verification'),
    budget: v('budget'),
    providers: v('providers'),
    destinationNotes: v('destinationNotes'),
    onwardCostPence: v('onwardCostPence'),
    scheduleCron: v('scheduleCron'),
    scheduleTz: v('scheduleTz'),
    enabled: v('enabled'),
  };
}

/** The editable part of a stored definition (DefinitionInput), for merging a partial update. */
export function inputOf(def: SearchDefinition): DefinitionInput {
  const {
    id: _id,
    confirmedCostPence: _c,
    confirmedCalls: _cc,
    createdAt: _ca,
    updatedAt: _u,
    deletedAt: _d,
    ...rest
  } = def;
  return rest;
}
