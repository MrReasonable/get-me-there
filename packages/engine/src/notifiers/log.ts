import type { Logger, Notifier } from '@gmt/core';
import { cleanLine, cleanText } from './operatorTemplates.js';

/** True when any nested object carries `sourceKind: 'synthetic'` (spec §5.5: notifiers refuse synthetic rows). */
export function containsSynthetic(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSynthetic);
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'sourceKind' && v === 'synthetic') return true;
      if (containsSynthetic(v)) return true;
    }
  }
  return false;
}

/**
 * The always-available notifier: writes each message to the log as plain text (spec §8.3 "EmailNotifier … and
 * LogNotifier"). EmailNotifier is WP11.
 */
export class LogNotifier implements Notifier {
  readonly id = 'log';
  readonly #log: Logger;
  constructor(log: Logger) {
    this.#log = log.child({ notifier: 'log' });
  }
  async send(msg: Parameters<Notifier['send']>[0]): Promise<{ ok: boolean; detail?: string }> {
    if (containsSynthetic(msg))
      return { ok: false, detail: 'synthetic data is never delivered by a notifier' };
    if (msg.kind === 'operator') {
      const m = msg.message;
      this.#log.info(
        {
          kind: m.kind,
          executionId: m.executionId,
          definitionId: m.definitionId,
          subject: cleanLine(m.subject),
        },
        cleanText(m.body),
      );
    } else {
      const d = msg.digest;
      this.#log.info(
        {
          kind: 'alert_digest',
          executionId: d.executionId,
          definitionId: d.definitionId,
          ruleId: d.ruleId,
          subject: cleanLine(msg.subject),
        },
        cleanText(msg.body),
      );
    }
    return { ok: true };
  }
}
