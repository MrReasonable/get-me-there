/** One error-message sanitiser for every apps/api sink: the tool bootstrap, the preflight and the record tool. */
import { type Secret, stripUrlsInText } from '@gmt/core';
import { scrubSecrets } from '@gmt/providers';

/** A message safe for any sink: URL query and userinfo stripped, every configured secret replaced (spec §5.3, sec-006). */
export function safeMessage(e: unknown, secrets: readonly Secret[]): string {
  return scrubSecrets(stripUrlsInText(e instanceof Error ? e.message : String(e)), secrets);
}
