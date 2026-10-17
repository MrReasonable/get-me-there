import type { Cell } from './definition.js';
import type { IsoDateTime } from './ids.js';
import type {
  ConstraintName,
  NormalisedItinerary,
  Observation,
  ResultBasis,
  VerdictClass,
} from './itinerary.js';
import type { Provenance } from './provenance.js';

/** Spec §6.8 rule. `requireAllVerified` only on the verified basis; cooldown default 336 h. */
export type AlertRuleType = 'absolute' | 'dropPct' | 'dropAbs';
export interface AlertRule {
  id: string;
  definitionId: string;
  type: AlertRuleType;
  thresholdPence: number | null;
  pct: number | null;
  basis: ResultBasis;
  requireAllVerified: boolean | null;
  cooldownHours: number;
  enabled: boolean;
}
export type AlertRuleInput = Omit<AlertRule, 'id'>;
/**
 * Spec §7 `alert_events.status`, decision 56: `queued` is written before the email is sent and stays when the send
 * fails (the next pass sends it), `notified` once a notifier accepted it, `suppressed` by the §6.8 cooldown.
 */
export type AlertEventStatus = 'queued' | 'notified' | 'suppressed';
/** Spec §7 `alert_events`. */
export interface AlertEvent {
  id: number;
  ruleId: string;
  identityKey: string;
  observationId: number | null;
  calendarPriceId: number | null;
  dedupKey: string;
  firedAt: IsoDateTime;
  status: AlertEventStatus;
  reason: string | null;
  payload: unknown;
}
/** Verified-basis candidate: an observation written by the current execution. */
export type VerifiedCandidate = {
  basis: 'verified';
  observation: Observation;
  itinerary: NormalisedItinerary;
  verdictClass: VerdictClass;
  unverified: ConstraintName[];
  seller: string;
  previous: { pricePence: number; fetchedAt: IsoDateTime } | null;
};
/** Calendar-basis candidate; evaluateAlertRules refuses one whose fetchedByExecutionId ≠ ctx.executionId (reused rows). */
export type CalendarCandidate = {
  basis: 'calendar';
  calendarPriceId: number;
  fetchedByExecutionId: string;
  cell: Cell;
  pricePence: number;
  provenance: Provenance;
  previous: { pricePence: number; fetchedAt: IsoDateTime } | null;
};
export type AlertCandidate = VerifiedCandidate | CalendarCandidate;
/**
 * identityKey formats: verified `${ruleId}|${itineraryHash}`; calendar
 * `${ruleId}|${providerId}|${cabin}|${cellKeyString(cell)}`. dedupKey = `${identityKey}|${floor(pricePence / 100)}`.
 * Suppressed firings are returned with `suppressed` set; the runner records them and the digest omits them.
 */
export interface Firing {
  rule: AlertRule;
  candidate: AlertCandidate;
  identityKey: string;
  dedupKey: string;
  reason: string;
  isNew: boolean;
  suppressed: { reason: string } | null;
}
export interface PriorFiring {
  identityKey: string;
  dedupKey: string;
  firedAt: IsoDateTime;
  pricePence: number;
}
