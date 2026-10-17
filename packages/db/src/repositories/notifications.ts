import type { Clock, IsoDateTime, OperatorMessageKind } from '@gmt/core';
import type { Db } from '../client.js';
import { readTime } from '../internal/read.js';

/** Spec §7 `operator_notifications`; spec §8.1 "deduplicated per execution and kind", execution-less notices per definition. */
export class NotificationsRepo {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  wasSent(kind: OperatorMessageKind, executionId: string | null, definitionId: string): boolean {
    return (
      this.db.raw
        .prepare(
          `SELECT 1 AS present FROM operator_notifications WHERE kind = @kind AND definition_id = @definitionId AND execution_id IS @executionId AND status = 'sent' LIMIT 1`,
        )
        .get({ kind, executionId, definitionId }) !== undefined
    );
  }

  /**
   * Decision 56: when the kind was last sent for the definition (any execution), or null. The engine compares its London
   * date with today's, so operator messages are de-duplicated per kind per definition per day.
   */
  lastSent(kind: OperatorMessageKind, definitionId: string): IsoDateTime | null {
    const r = this.db.raw
      .prepare<Record<string, unknown>, { sentAt: string }>(
        `SELECT sent_at AS sentAt FROM operator_notifications WHERE kind = @kind AND definition_id = @definitionId AND status = 'sent' ORDER BY sent_at DESC, id DESC LIMIT 1`,
      )
      .get({ kind, definitionId });
    return r === undefined ? null : readTime('operator_notifications.sent_at', r.sentAt);
  }

  record(
    kind: OperatorMessageKind,
    executionId: string | null,
    definitionId: string,
    status: 'sent' | 'failed',
  ): void {
    this.db.raw
      .prepare(
        'INSERT INTO operator_notifications (kind, execution_id, definition_id, sent_at, status) VALUES (@kind, @executionId, @definitionId, @sentAt, @status)',
      )
      .run({ kind, executionId, definitionId, sentAt: this.clock.now(), status });
  }
}
