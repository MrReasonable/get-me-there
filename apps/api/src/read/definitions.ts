/** The definition response and the confirmation rule (spec §7, §8.1, §10; plan decisions 25, 37, 42, 43). */
import type {
  apiContract,
  BudgetFit,
  DefinitionInput,
  Estimate,
  ProviderId,
  SearchDefinition,
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
