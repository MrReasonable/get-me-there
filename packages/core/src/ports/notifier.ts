import type { AlertRule } from '../types/alerts.js';
import type { Cell } from '../types/definition.js';
import type { IsoDateTime } from '../types/ids.js';
import type { Booking, ConstraintName, ResultBasis, Segment, VerdictClass } from '../types/itinerary.js';
import type { Provenance } from '../types/provenance.js';

/** One digest line. Rendering (subject, body) is the engine's job; core only builds the structure. Spec §6.8, §8.3. */
export interface DigestItem {
  pricePence: number;
  provenance: Provenance;
  cell: Cell;
  verdictClass: VerdictClass | 'unchecked';
  itineraryHash: string | null;
  seller: string | null;
  unverified: ConstraintName[];
  previousPricePence: number | null;
  /**
   * Whole hours between the previous price's fetch and this one's. It is the gap the rule judged,
   * never the previous price's age (a cached calendar price was older than its own fetch).
   * Render it as "fetched Nh before this price", not as an age.
   */
  fetchGapHours: number | null;
  isNew: boolean;
  firingReason: string;
  booking: Booking;
  bookingExpiresAt: IsoDateTime | null;
  outbound: Segment[] | null;
  inbound: Segment[] | null;
  /** null for synthetic rows */
  searchLink: { url: string; host: string; label: string } | null;
  /** resultRowKey, for the app link */
  rowKey: string;
}
export interface AlertDigest {
  ruleId: string;
  definitionId: string;
  executionId: string;
  basis: ResultBasis;
  items: DigestItem[];
  /** firings beyond the top 10 */
  restCount: number;
  newItems: DigestItem[];
  /** new cells beyond the top 10 */
  newRestCount: number;
  coverageCaveat: { itinerarySearched: number; selected: number; expandTop: number } | null;
  rule: AlertRule;
}
export type OperatorMessageKind =
  | 'paused_budget'
  | 'paused_error'
  | 'skipped_budget'
  | 'skipped_confirm'
  | 'skipped_window'
  | 'skipped_missed'
  | 'interrupted'
  | 'provider_disabled'
  | 'provider_capped'
  | 'parity_break'
  | 'alerts_calendar_only'
  | 'crash_loop';
export interface OperatorMessage {
  kind: OperatorMessageKind;
  executionId: string | null;
  definitionId: string;
  subject: string;
  body: string;
}
/** Spec §8.3: email and log notifiers; synthetic rows are refused by the engine before send. */
export interface Notifier {
  id: string;
  send(
    msg:
      | { kind: 'digest'; digest: AlertDigest; subject: string; body: string }
      | { kind: 'operator'; message: OperatorMessage },
  ): Promise<{ ok: boolean; detail?: string }>;
}
