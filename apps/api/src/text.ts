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
  zeroCapVerification: 'verification will not run: spend cap is 0',
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
  toolSynthetic: 'the record tool refuses while the synthetic gate is open (spec §5.5)',
  toolSummary: (name: string, exitCode: number, files: number) =>
    `${name} finished with exit code ${exitCode}; ${files} fixture file(s) written`,
} as const;
