import type { OperatorMessage, OperatorMessageKind } from '@gmt/core';
import type { EngineContext } from './context.js';
import { errorText } from './errors.js';
import { type MessageParams, renderOperatorMessage } from './notifiers/operatorTemplates.js';

export interface NotifyParams extends MessageParams {
  definitionId: string;
}

/**
 * Sends one operator notification to every notifier, at most once per (kind, execution) — per (kind, definition) when
 * there is no execution (spec §8.1 "deduplicated per execution and kind"). Returns false when deduplicated. Never
 * throws: a failing notifier is logged and recorded as failed, because a notification must not stop a run.
 */
export async function notifyOperator(
  ctx: Pick<EngineContext, 'repos' | 'notifiers' | 'log'>,
  kind: OperatorMessageKind,
  p: NotifyParams,
): Promise<boolean> {
  if (ctx.repos.notifications.wasSent(kind, p.executionId, p.definitionId)) return false;
  const { subject, body } = renderOperatorMessage(kind, p);
  const message: OperatorMessage = {
    kind,
    executionId: p.executionId,
    definitionId: p.definitionId,
    subject,
    body,
  };
  let ok = ctx.notifiers.length > 0;
  for (const n of ctx.notifiers) {
    try {
      const r = await n.send({ kind: 'operator', message });
      if (!r.ok) {
        ok = false;
        ctx.log.warn(
          {
            notifier: n.id,
            kind,
            executionId: p.executionId,
            definitionId: p.definitionId,
            detail: r.detail ?? null,
          },
          'operator notification refused',
        );
      }
    } catch (err) {
      ok = false;
      ctx.log.warn(
        {
          notifier: n.id,
          kind,
          executionId: p.executionId,
          definitionId: p.definitionId,
          err: errorText(err),
        },
        'operator notification failed',
      );
    }
  }
  ctx.repos.notifications.record(kind, p.executionId, p.definitionId, ok ? 'sent' : 'failed');
  return true;
}
