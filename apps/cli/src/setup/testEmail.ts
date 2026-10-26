/**
 * The test email offered at the end of `gmt setup` (spec §10 `POST /alerts/test-email`, brief WP18 Task 18.3): once the
 * app is up and email is configured, an interactive run offers one fixed message. The password goes only in the
 * Authorization header of one in-process request; the app's own words (an SMTP error above all) are never printed, only
 * the class it answers and the next step for it.
 */
import { apiContract } from '@gmt/core';
import { type AppCreds, authHeaders, credsUrl } from '../appClient.js';
import type { Ask } from '../ask.js';
import type { Deps } from '../deps.js';

export const TEST_EMAIL_QUESTION = 'Send a test email now?';
const NEXT = 'pnpm gmt setup --reconfigure email';

/** V9: the offer belongs to a full setup and to `--reconfigure email`, not to the other single-group changes. */
export const offeredFor = (group: string | null): boolean => group === null || group === 'email';

/** What the operator is told for each answer of the route. */
export const TEST_EMAIL_WORDS = {
  sent: 'The test email was sent. Check the inbox (and the spam folder) of the address you gave.',
  refused: 'The test email was not sent: the hourly email limit is reached. Try again later.',
  failed: `The test email failed to send. Check the SMTP details with \`${NEXT}\`, then run \`pnpm gmt status\`; the app log (pnpm gmt logs) has the cause.`,
  notConfigured: `The app says email is not set up. Run \`${NEXT}\`.`,
  silent: 'The app did not answer the test email request. Run `pnpm gmt status`.',
} as const;

/** Posts the test email and returns the words for its outcome. */
export async function sendTestEmail(deps: Deps, creds: AppCreds): Promise<string> {
  const r = await deps.http({
    method: 'POST',
    url: credsUrl(creds, '/api/alerts/test-email'),
    // why: the app's mutating-route rules (spec §4): a JSON content type and the requested-with header
    headers: {
      ...authHeaders(creds),
      'Content-Type': 'application/json',
      'X-Requested-With': 'get-me-there',
    },
    timeoutMs: 40_000,
  });
  if ('error' in r) return TEST_EMAIL_WORDS.silent;
  if (r.status === 409) return TEST_EMAIL_WORDS.notConfigured;
  if (r.status === 429) return TEST_EMAIL_WORDS.refused;
  if (r.status !== 200) return TEST_EMAIL_WORDS.silent;
  let json: unknown;
  try {
    json = JSON.parse(r.body);
  } catch {
    return TEST_EMAIL_WORDS.silent;
  }
  const parsed = apiContract.testEmailResponseSchema.safeParse(json);
  if (!parsed.success) return TEST_EMAIL_WORDS.silent;
  return parsed.data.result === 'sent' ? TEST_EMAIL_WORDS.sent : TEST_EMAIL_WORDS.failed;
}

/**
 * Offers the test email once, after the closing screen: only on an interactive terminal, only with email configured and
 * credentials to reach the app. The default is no.
 */
export async function offerTestEmail(
  deps: Deps,
  ask: Ask,
  o: { interactive: boolean; emailConfigured: boolean; creds: AppCreds | null },
): Promise<void> {
  if (!o.interactive || !o.emailConfigured || o.creds === null) return;
  if (!(await ask.confirm(TEST_EMAIL_QUESTION, false))) return;
  deps.io.out(`${await sendTestEmail(deps, o.creds)}\n`);
}
