/**
 * Every fixed user-facing string the api emits: error messages, basis reasons, notices (spec §10, §11).
 * One table so the banned-word test (spec §11, §8.3) can scan all of them.
 * Rule: no banned word; "verified" never appears here because it is reserved for class values;
 * the verified basis is called the "itinerary-search basis" (plan Banned words, spec §11).
 * No airport code appears here (spec §1; the boundary script's airport-literal check, decisions 36 and 46).
 */
import { formatPence } from '@gmt/core';

export const API_TEXT = {
  internal: 'internal error; see the server log',
  notFound: 'no such route',
  unauthenticated: 'authentication required',
  rateLimited: (seconds: number) => `too many failed sign-in attempts; retry in ${seconds}s`,
  // why: plan decision 54: a rejection names the variable, never its values (they would tell a stranger the host names).
  hostRejected: (host: string) => `Host "${host}" is not in ALLOWED_HOSTS`,
  originRejected: (origin: string) => `Origin "${origin}" does not name a host in ALLOWED_HOSTS`,
  bodyTooLarge: 'request body is larger than the api accepts',
  contentType: 'requests that change data need Content-Type: application/json',
  requestedWith: 'requests that change data need X-Requested-With: get-me-there',
  validation: (target: string) => `invalid request ${target}`,
  malformedJson: 'request body is not valid JSON',
  // why: not-found messages never echo the id a caller sent (spec §5.3: a pasted secret must not come back out).
  definitionNotFound: 'no such search definition',
  executionNotFound: 'no such execution',
  noExecution: 'this definition has not been run yet',
  alertNotFound: 'no such alert rule',
  itineraryNotFound: 'no such itinerary',
  alreadyRunning: 'a request for this definition is already running; retry when it finishes',
  unknownProvider: (id: string) => `provider ${id} is not configured`,
  unknownDestination: 'that destination is not one of this definition',
  // why: spec §10 (WP19): the scope parameters of the date-pairs route and /results, each 422 named by its code
  unknownScopeAirport: (code: string) => `airport ${code} is not one of this definition's airports`,
  invalidJourneyLimit: (min: number, max: number) =>
    `the journey limit is a whole number of minutes from ${min} to ${max}`,
  tooManyCells: (cells: number, bound: number) =>
    `these airports cover ${cells} cells, more than the ${bound} this view reads at once; choose fewer airports`,
  datePairIncomplete: 'give both the departure date and the return date, or neither',
  invalidDatePair: 'a date of the date pair is not a calendar date (YYYY-MM-DD)',
  datePairOutsideSpace: 'that date pair is outside the current window or nights range of this definition',
  draftNotice: 'Set at least one origin and one destination before running or scheduling this search.',
  draftCannotEnable: 'a definition without origins and destinations cannot be enabled',
  draftNoEstimate: 'set origins and destinations before asking for an estimate',
  deletedNotice: 'definition deleted; its schedule is removed',
  invalidDefinition: 'the definition is not valid',
  zeroCells: 'the window and nights range resolve to zero cells; widen the window or the nights range',
  invalidCron: (reason: string) => `schedule rejected: ${reason}`,
  scheduleOverBudget: (scopes: readonly string[]) =>
    `schedule rejected: the monthly load of every enabled schedule would exceed ${scopes.join(', ')}`,
  coverageCheckUnavailable:
    'the coverage check reads the free Travelpayouts cache; set TRAVELPAYOUTS_TOKEN to enable it',
  // why: spec §10 /alerts/test-email: the refusals say what to do, never the SMTP server's words
  emailNotConfigured: 'email is not set up',
  emailLimit: 'a test email was sent a moment ago; try again in a minute',
  zeroCapVerification: 'verification will not run: spend cap is 0',
  zeroCapBootWarning: 'billed provider enabled under a zero spend cap: verification will not run',
  // why: cost-006: on a subscription calls cost £0 at the margin, so a cap below the fees stops nothing; say so at boot.
  spendCapBelowFees: (capPence: number, feesPence: number) =>
    `MONTHLY_SPEND_CAP_PENCE ${capPence} is below the ${feesPence}p of subscription fees it counts: it cannot stop a call, because calls cost £0 at the margin; each provider's call cap is the hard stop`,
  // why: ruling 5: on a plan whose calls cost £0 the spend cap cannot stop a call, so the card names the cap that does.
  callCapGoverns: (window: 'month' | 'lifetime', cap: number) =>
    `calls cost £0 each on this plan, so the spend cap does not stop them; the ${window === 'lifetime' ? 'lifetime' : 'monthly'} call cap (${cap} calls) is the hard stop`,
  // why: formatPence (core) is the only money formatter in user-facing strings (plan decision 15).
  ceilingNote: (capPence: number, feesPence: number) =>
    `monthly spend cap ${formatPence(capPence)}, of which ${formatPence(feesPence)} is subscription fees counted once`,
  notCancellable: (status: string) => `execution is ${status} and cannot be cancelled`,
  cellNotInSpace: 'that cell is outside the current window, nights range or airports of this definition',
  unknownAirport: (code: string) => `airport ${code} is not in the airports table`,
  noVerificationProvider:
    'this definition has no verification provider, so single-cell verify is unavailable',
  basisNoVerificationProvider:
    'calendar basis: no verification provider is configured, so constraints are not checked',
  basisNoObservations:
    'calendar basis: no itinerary-searched observations yet, so constraints are not checked',
  // why: N2 (ruling 9): a 0-call definition starts no child; say why and which setting fixes it, in the form's words.
  zeroRunCapDefault:
    "new definitions on this plan allow 0 billed calls, so Verify stays unavailable until you raise a definition's call cap in Definitions → Run budget",
  verifyZeroRunCap: (n: number) =>
    `this definition allows 0 billed calls, so an itinerary search for one cell cannot start; raise the definition's call cap to at least ${n} in Definitions → Run budget (Max billed calls per run)`,
  basisNoObservationsInSpace:
    'calendar basis: no itinerary-searched observations inside the current space, so constraints are not checked',
  basisItinerarySearch:
    'itinerary-search basis: constraints checked against the current definition at read time',
  basisRequestedCalendar: 'calendar basis as requested: constraints are not checked',
  insideSpace: (inside: number, total: number) =>
    `${inside} of ${total} rows are inside the current window and nights range`,
  toolUnavailable: (name: string) => `the ${name} tool is not available in this build`,
  toolBusy: (name: string) => `the ${name} tool is already running`,
  recordingInContainer:
    'fixture recording runs from a development checkout, not inside the container (recordings are local-only)',
  toolFailed: (name: string) => `the ${name} tool failed; see the server log`,
  toolSynthetic: (name: string) => `the ${name} tool refuses while the synthetic gate is open (spec §5.5)`,
  toolSummary: (name: string, exitCode: number, files: number) =>
    `${name} finished with exit code ${exitCode}; ${files} fixture file(s) written`,
} as const;
