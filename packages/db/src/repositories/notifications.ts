import type { Clock, OperatorMessageKind } from '@gmt/core';
import type { Db } from '../client.js';

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
