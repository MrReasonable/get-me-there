/** The notifier list for EngineDeps: the log always, email when SMTP is configured. Spec §8.3; decision 56. */
import type { Clock, Config, Logger, Notifier } from '@gmt/core';
import { EmailNotifier } from './email.js';
import { LogNotifier } from './log.js';

export function buildNotifiers(
  config: Pick<Config, 'smtp' | 'nodeEnv' | 'alertEmailMaxPerHour'>,
  log: Logger,
  clock: Clock,
): Notifier[] {
  const notifiers: Notifier[] = [new LogNotifier(log)];
  if (config.smtp !== null)
    notifiers.push(
      new EmailNotifier({
        smtp: config.smtp,
        nodeEnv: config.nodeEnv,
        log,
        clock,
        maxPerHour: config.alertEmailMaxPerHour,
      }),
    );
  return notifiers;
}
