/** What the tool bootstrap hands a tool, the shared record-tool result types, and the one exit-code table every CLI shares. */
import type { Config, ProviderId } from '@gmt/core';

/** Both vendors' configuration, narrowed once by recordFixtures and passed down (arch M-3). */
export interface RecordingProviders {
  tp: NonNullable<Config['providers']['travelpayouts']>;
  sa: NonNullable<Config['providers']['searchapi']>;
}

/** The two tools of spec §9 item 7. */
export type ToolName = 'record' | 'smoke';

/** Per-run context: the abort signal (SIGINT, SIGTERM, a lost app_lock), the two output lines and where recordings go. */
export interface ToolContext {
  signal: AbortSignal;
  out(line: string): void;
  err(line: string): void;
  /** `defaultRecordedRoot()` for the worked example, `<--out>/fixtures/recorded` otherwise, a temporary tree in tests. */
  recordedRoot: string;
  /** `RECORDED_BY` in every real run; tests pass their own signature together with their root (prov-wp04b-006). */
  recordedBy: string;
}

// why: U9 (WP16b): the one exit-code table lives in core so the gmt CLI shares it; re-exported for the tools and scripts
export { EXIT } from '@gmt/core';

/**
 * One planned call's result. `status` is the HTTP status when a response arrived; `'no-response'` when the request
 * may have reached the vendor but no status came back (`detail` says whether the ledger counted it: a timeout is
 * ledgered `unknown` and counted, a socket failure `error` and not counted); `'aborted'` when SIGINT, SIGTERM or a
 * lost lock stopped it; `'skipped'` only when nothing reached the vendor (guard refusal, missing chain prerequisite,
 * abort before send). `files` lists every file the recorder wrote for the call, retries included; `file` is the last.
 */
export interface RecordedCall {
  id: string;
  providerId: ProviderId;
  status: number | 'skipped' | 'aborted' | 'no-response';
  file: string | null;
  files: string[];
  detail: string | null;
}

/** Plan contract (Wiring and bootstraps; plan decision 23). */
export interface RecordSummary {
  calls: RecordedCall[];
  creditsUsed: number;
  freeCalls: number;
  /** The recorder session every file of this run carries (null when nothing was written). */
  session: string | null;
  /**
   * Diagnostics along the chain (pie-008), in integer pence with their currency (hard rule 7): never prices shown to the
   * operator as offers; they let the PR state whether step 1 = step 2 and what step 3 showed.
   */
  chain: {
    currency: 'GBP';
    step1PricePence: number | null;
    step2PricePence: number | null;
    step3Options: Array<{ bookWith: string; pricePence: number }>;
  };
}

/** recordFixtures failed after opening its execution; carries what was done so far (cause = the original error). */
export class RecordingFailedError extends Error {
  constructor(
    message: string,
    readonly partial: {
      calls: RecordedCall[];
      creditsUsed: number;
      freeCalls: number;
      session: string | null;
    },
    options: { cause: unknown },
  ) {
    super(message, options);
    this.name = 'RecordingFailedError';
  }
}
