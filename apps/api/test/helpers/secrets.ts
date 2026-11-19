// Global Constraints (settings plan): one helper for every egress path of a secret. Each distinctive value is looked for
// in every encoded form the scrubber knows (secretForms), in every sink: route bodies, captured logs, a settings view.
import { secretForms } from '@gmt/providers';
import { expect } from 'vitest';

/** Distinctive values a test seeds, one per secret setting, each longer than any last-four a route may show. */
export const SETTINGS_SECRETS = {
  TRAVELPAYOUTS_TOKEN: 'tp-token-settings-sentinel-6d1f0a',
  SEARCHAPI_KEY: 'sa-key-settings-sentinel-93c7b2e4',
  SMTP_PASS: 'smtp-pass-settings-sentinel-4e8a',
} as const;

/** No sink carries any of `values`, in any form; a failure names the sink, never the value. */
export function expectNoSecrets(values: readonly string[], sinks: Readonly<Record<string, string>>): void {
  for (const [sink, text] of Object.entries(sinks))
    for (const value of values) {
      const found = secretForms(value).some((form) => text.includes(form));
      expect(found, `${sink} carries a secret`).toBe(false);
    }
}
