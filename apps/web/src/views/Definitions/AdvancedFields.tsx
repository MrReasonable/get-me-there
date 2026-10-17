import { microGbpToPence, PENCE_TO_MICRO, type ProviderId } from '@gmt/core';
import { COPY } from '../../copy.js';
import { formatMinutes } from '../../format.js';
import { withKey } from '../../state/withKey.js';
import type { Draft } from './draft.js';
import { AirlinesField, Check, NumberField, PoundsField, TimeWindowField } from './fields.js';

type DraftConstraints = Draft['constraints'];
type DraftPolicy = Draft['verification'];
const input = 'min-h-11 rounded border border-slate-400 px-1';

export interface ProviderCapabilities {
  id: ProviderId;
  displayName: string;
  discovery: boolean;
  verification: boolean;
}

/** Spec §11 advanced fold: every constraint, the verification policy, providers, budget and schedule. */
export function AdvancedFields({
  draft,
  setDraft,
  capabilities,
  onIncomplete,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  capabilities: readonly ProviderCapabilities[];
  onIncomplete?: (id: string, incomplete: boolean) => void;
}) {
  const c = draft.constraints;
  const v = draft.verification;
  const setC = <K extends keyof DraftConstraints>(k: K, value: DraftConstraints[K] | undefined) =>
    setDraft({ ...draft, constraints: withKey(c, k, value) });
  const setV = <K extends keyof DraftPolicy>(k: K, value: DraftPolicy[K] | undefined) =>
    setDraft({ ...draft, verification: withKey(v, k, value) });
  // why: spec §5.4, bookingLinks is forced true whenever SearchApi verifies (zod enforces it too).
  const forcedBooking = draft.providers.verification.includes('searchapi');
  const toggleProvider = (stage: 'discovery' | 'verification', id: ProviderId, on: boolean) => {
    const list = draft.providers[stage].filter((p) => p !== id);
    const providers = { ...draft.providers, [stage]: on ? [...list, id] : list };
    const verification =
      stage === 'verification' && id === 'searchapi' && on ? { ...v, bookingLinks: true } : v;
    setDraft({ ...draft, providers, verification });
  };
  return (
    <div className="mt-2 space-y-3">
      <fieldset className="flex flex-wrap gap-3">
        <legend className="font-semibold">{COPY.constraintsHeading}</legend>
        <NumberField
          id="c-maxStops"
          label={COPY.constraint.maxStops}
          value={c.maxStops}
          onChange={(n) => setC('maxStops', n)}
        />
        <NumberField
          id="c-maxJourney"
          label={COPY.constraint.maxJourneyMinutes}
          value={c.maxJourneyMinutes}
          onChange={(n) => setC('maxJourneyMinutes', n)}
          {...(c.maxJourneyMinutes === undefined
            ? {}
            : { hint: COPY.minutesAsHours(formatMinutes(c.maxJourneyMinutes)) })}
        />
        <NumberField
          id="c-minLayover"
          label={COPY.constraint.minLayoverMinutes}
          value={c.minLayoverMinutes}
          onChange={(n) => setC('minLayoverMinutes', n)}
        />
        <NumberField
          id="c-maxLayover"
          label={COPY.constraint.maxLayoverMinutes}
          value={c.maxLayoverMinutes}
          onChange={(n) => setC('maxLayoverMinutes', n)}
        />
        <Check
          id="c-overnight"
          label={COPY.constraint.noOvernightLayover}
          checked={c.noOvernightLayover === true}
          onChange={(b) => setC('noOvernightLayover', b ? true : undefined)}
        />
        <TimeWindowField
          id="c-departure"
          name={COPY.constraint.departureWindowLocal}
          value={c.departureWindowLocal}
          onChange={(w) => setC('departureWindowLocal', w)}
          {...(onIncomplete ? { onIncomplete } : {})}
        />
        <TimeWindowField
          id="c-arrival"
          name={COPY.constraint.arrivalWindowLocal}
          value={c.arrivalWindowLocal}
          onChange={(w) => setC('arrivalWindowLocal', w)}
          {...(onIncomplete ? { onIncomplete } : {})}
        />
        <Check
          id="c-selfTransfer"
          label={COPY.constraint.noSelfTransfer}
          checked={c.noSelfTransfer === true}
          onChange={(b) => setC('noSelfTransfer', b ? true : undefined)}
        />
        <Check
          id="c-airportChange"
          label={COPY.constraint.noAirportChange}
          checked={c.noAirportChange === true}
          onChange={(b) => setC('noAirportChange', b ? true : undefined)}
        />
        <AirlinesField
          id="c-include"
          label={COPY.constraint.includeAirlines}
          value={c.includeAirlines}
          onChange={(a) => setC('includeAirlines', a)}
        />
        <AirlinesField
          id="c-exclude"
          label={COPY.constraint.excludeAirlines}
          value={c.excludeAirlines}
          onChange={(a) => setC('excludeAirlines', a)}
        />
        <Check
          id="c-cabinBag"
          label={COPY.constraint.cabinBagRequired}
          checked={c.cabinBagRequired === true}
          onChange={(b) => setC('cabinBagRequired', b ? true : undefined)}
        />
        <Check
          id="c-checkedBag"
          label={COPY.constraint.checkedBagRequired}
          checked={c.checkedBagRequired === true}
          onChange={(b) => setC('checkedBagRequired', b ? true : undefined)}
        />
        <NumberField
          id="c-minBags"
          label={COPY.constraint.minCheckedBags}
          value={c.minCheckedBags}
          onChange={(n) => setC('minCheckedBags', n)}
        />
        <PoundsField
          id="c-maxPrice"
          label={COPY.inPounds(COPY.constraint.maxPricePence)}
          pence={c.maxPricePence}
          onChange={(p) => setC('maxPricePence', p)}
        />
      </fieldset>
      <fieldset className="flex flex-wrap gap-3">
        <legend className="font-semibold">{COPY.providersSection}</legend>
        <span className="flex flex-col">
          <span>{COPY.discoveryProviders}</span>
          {capabilities
            .filter((p) => p.discovery)
            .map((p) => (
              <Check
                key={p.id}
                id={`p-d-${p.id}`}
                label={p.displayName}
                checked={draft.providers.discovery.includes(p.id)}
                onChange={(b) => toggleProvider('discovery', p.id, b)}
              />
            ))}
        </span>
        <span className="flex flex-col">
          <span>{COPY.verificationProviders}</span>
          {capabilities
            .filter((p) => p.verification)
            .map((p) => (
              <Check
                key={p.id}
                id={`p-v-${p.id}`}
                label={p.displayName}
                checked={draft.providers.verification.includes(p.id)}
                onChange={(b) => toggleProvider('verification', p.id, b)}
              />
            ))}
        </span>
        {draft.providers.discovery.map((id) => (
          <NumberField
            key={id}
            id={`p-refresh-${id}`}
            label={COPY.refreshHours(COPY.provider[id])}
            value={draft.providers.discoveryRefreshHours[id]}
            onChange={(n) =>
              setDraft({
                ...draft,
                providers: {
                  ...draft.providers,
                  discoveryRefreshHours: withKey(draft.providers.discoveryRefreshHours, id, n),
                },
              })
            }
          />
        ))}
      </fieldset>
      <fieldset className="flex flex-wrap gap-3">
        <legend className="font-semibold">{COPY.policyHeading}</legend>
        <NumberField
          id="v-maxCells"
          label={COPY.maxCells}
          value={v.maxCells}
          onChange={(n) => setV('maxCells', n ?? 0)}
        />
        <NumberField id="v-topN" label={COPY.topN} value={v.topN} onChange={(n) => setV('topN', n ?? 0)} />
        <PoundsField
          id="v-ceiling"
          label={COPY.priceCeiling}
          pence={v.priceCeilingPence}
          onChange={(p) => setV('priceCeilingPence', p)}
        />
        <NumberField
          id="v-perDate"
          label={COPY.perDepartureDateBest}
          value={v.perDepartureDateBest}
          onChange={(n) => setV('perDepartureDateBest', n)}
        />
        <NumberField
          id="v-expandTop"
          label={COPY.expandTop}
          value={v.expandTop}
          onChange={(n) => setV('expandTop', n ?? 0)}
        />
        <span className="flex flex-col">
          <Check
            id="v-booking"
            label={COPY.bookingLinks}
            checked={forcedBooking || v.bookingLinks}
            disabled={forcedBooking}
            onChange={(b) => setV('bookingLinks', b)}
          />
          {forcedBooking ? <span className="text-xs">{COPY.bookingLinksForced}</span> : null}
        </span>
      </fieldset>
      <fieldset className="flex flex-wrap gap-3">
        <legend className="font-semibold">{COPY.budgetHeading}</legend>
        <NumberField
          id="b-calls"
          label={COPY.maxCalls}
          value={draft.budget.maxCalls}
          onChange={(n) => setDraft({ ...draft, budget: { ...draft.budget, maxCalls: n ?? 0 } })}
        />
        <NumberField
          id="b-free"
          label={COPY.maxFreeCalls}
          value={draft.budget.maxFreeCalls}
          onChange={(n) => setDraft({ ...draft, budget: { ...draft.budget, maxFreeCalls: n ?? 0 } })}
        />
        <PoundsField
          id="b-cost"
          label={COPY.maxCost}
          pence={microGbpToPence(draft.budget.maxCostMicroGbp)}
          onChange={(p) =>
            setDraft({ ...draft, budget: { ...draft.budget, maxCostMicroGbp: (p ?? 0) * PENCE_TO_MICRO } })
          }
        />
      </fieldset>
      <fieldset className="flex flex-wrap gap-3">
        <legend className="font-semibold">{COPY.scheduleHeading}</legend>
        <span className="flex flex-col">
          <label htmlFor="s-cron">{COPY.scheduleCron}</label>
          <input
            id="s-cron"
            value={draft.scheduleCron ?? ''}
            onChange={(e) =>
              setDraft({ ...draft, scheduleCron: e.target.value.trim() === '' ? null : e.target.value })
            }
            className={input}
          />
        </span>
        <span className="flex flex-col">
          <label htmlFor="s-tz">{COPY.scheduleTz}</label>
          <input
            id="s-tz"
            value={draft.scheduleTz}
            onChange={(e) => setDraft({ ...draft, scheduleTz: e.target.value })}
            className={input}
          />
        </span>
        <Check
          id="d-enabled"
          label={COPY.enabled}
          checked={draft.enabled}
          onChange={(b) => setDraft({ ...draft, enabled: b })}
        />
      </fieldset>
    </div>
  );
}
