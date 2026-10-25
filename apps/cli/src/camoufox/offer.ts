import { CAMOUFOX_BUILDS, type CamoufoxBuild, CONSENT_FIX, flagsFor, type OsArch } from '@gmt/core';
import type { Platform } from '../platform/types.js';
import { megabytes, osArchOf } from './install.js';

/**
 * The browser provider's row in `gmt setup` (spec §2 "Costs, stated plainly", §13; decision 75; brief WP17 Task 17.6):
 * offered only where this machine's `<os>-<arch>` has a verified search form for its pinned build, always after the
 * costs summary, and on a machine with no display only after the server sentence and a typed `yes`.
 */
export interface Availability {
  osArch: OsArch;
  entry: CamoufoxBuild;
}

/** This machine's entry when its flags are set for its pinned build, else null. */
export function browserAvailability(p: Pick<Platform, 'os' | 'arch'>): Availability | null {
  const osArch = osArchOf(p);
  if (osArch === null) return null;
  const entry = CAMOUFOX_BUILDS[osArch];
  return flagsFor(osArch, entry.build).FORM_VERIFIED ? { osArch, entry } : null;
}

/** Said once where the provider is not offered (pinned by a test). */
export const unavailableText = (osArch: string): string =>
  `The browser provider is not available on this machine yet (no recordings for ${osArch}); SearchApi and Travelpayouts work`;

/** Spec §2's costs, before the question on every machine. */
export function costsSummary(entry: Pick<CamoufoxBuild, 'bytes' | 'unpackedBytes'>): string {
  return [
    'Browser provider: Google Flights read by this app’s own Camoufox browser, on this machine. Before you turn it on:',
    '- Terms: read the provider’s terms before enabling it; you are responsible for how it is used.',
    '- Your address and account: every page load comes from this machine’s own address (no proxies), so a block, a verification page or a wider restriction lands on that address, and through it on your other Google use from the same network. The browser profile is never signed in, so your account is never used.',
    '- Brittleness: Google changes the page without notice; a changed page reads as unrecognised and pauses the provider for an hour, never a silent zero.',
    '- Speed: a page takes about 20 to 60 s to load, settle and read, plus the spacing set between pages.',
    '- Availability: it runs only while this machine is on and the worker is running; otherwise its cells read skipped and every other provider runs.',
    `- Disk: Camoufox is a ${megabytes(entry.bytes)} download and about ${megabytes(entry.unpackedBytes)} unpacked, under ~/.local/share/get-me-there/camoufox (pnpm gmt browser install reinstalls it; deleting that directory removes it).`,
    '- The worker key: anything that can reach the worker’s address on this machine is stopped only by its key.',
    '- Money: none.',
  ].join('\n');
}

/** Spec §2's server sentence, shown on a machine with no display, which needs a typed yes. */
export const SERVER_TEXT =
  'Page loads will come from this server’s address, not a home connection. A datacentre address is more likely to be refused or shown a verification page, and each one pauses the provider for 48 hours; any restriction applies to that address. If that is not acceptable, leave the provider off, or run the app on a machine at home.';

export const ENABLE_QUESTION = 'Turn on the browser provider?';
export const SERVER_QUESTION = 'Type yes to accept page loads from this server’s address';

/**
 * How consent is captured on this machine, with the effort of each way (brief WP17 Tasks 17.5 and 17.6): the guided
 * capture, `pnpm gmt consent`, in a window here; with no display, its export on a desktop and its import here; and
 * capture-socs, the lighter equal option, either way.
 */
export const CAPTURE_SOCS = 'pnpm --filter @gmt/camoufox-worker capture-socs';
export function consentMethodText(hasDisplay: boolean): string {
  return hasDisplay
    ? `Consent: Google’s consent page is answered once, by you, with "Reject all". Run ${CONSENT_FIX.command}: a browser window opens on Google Flights, you click Reject all and close the window, and the choice is kept only when the cookie itself records a rejection (a minute or two; ${CONSENT_FIX.doc}). Or copy the SOCS cookie’s fields from an ordinary private window into ${CAPTURE_SOCS} (a few minutes).`
    : `Consent: this machine has no display, so the choice is captured on a desktop where pnpm gmt setup has set up the browser provider: run ${CONSENT_FIX.command} export there and pipe its one line into ${CONSENT_FIX.command} import here (a few minutes; the line holds only the cookie choice, so move it by pipe or clipboard, never as an argument or in a ticket). Or open https://www.google.com/travel/flights in an ordinary private browser window there, click Reject all, and copy the SOCS cookie’s fields into ${CAPTURE_SOCS} here (a few minutes; docs/setup.md#on-a-machine-with-no-display).`;
}

/** What setup says when the browser part stops before consent, so a re-run resumes it. */
export const RESUME_LINE =
  'The browser provider stays off until then; resume with pnpm gmt setup --reconfigure browser';
