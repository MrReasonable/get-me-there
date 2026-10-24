import { londonDateOf, type OperatorMessage, type OperatorMessageKind } from '@gmt/core';
import type { EngineContext } from './context.js';
import { errorText } from './errors.js';
import { type MessageParams, renderOperatorMessage } from './notifiers/operatorTemplates.js';

export interface NotifyParams extends MessageParams {
  definitionId: string;
}

/**
 * Sends one operator notification to every notifier, at most once per (kind, execution) — per (kind, definition) when
 * there is no execution (spec §8.1 "deduplicated per execution and kind") — and at most once per kind per definition
 * per London day (decision 56), so a pause-and-resume loop cannot flood the inbox. Returns true only when every notifier
 * accepted the message: false when deduplicated, when there is no notifier, or when one failed (fix round 1, arch M4: a
 * keyed notice is claimed only once it was really sent).
 * Never throws: a failing notifier is logged and recorded as failed, because a notification must not stop a run. A send
 * that finishes after the engine shut down is logged once and not recorded (the database is closed or closing).
 */
export async function notifyOperator(
  ctx: Pick<EngineContext, 'repos' | 'notifiers' | 'log' | 'clock' | 'lifecycle'>,
  kind: OperatorMessageKind,
  p: NotifyParams,
): Promise<boolean> {
  if (ctx.repos.notifications.wasSent(kind, p.executionId, p.definitionId)) return false;
  const last = ctx.repos.notifications.lastSent(kind, p.definitionId);
  if (last !== null && londonDateOf(last) === ctx.clock.todayLondon()) {
    ctx.log.info(
      { kind, executionId: p.executionId, definitionId: p.definitionId },
      'operator notification already sent today',
    );
    return false;
  }
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
  // why: review S2 — a send that outlived the shutdown's bound resolves after the engine handed the database back:
  // its row is not written (one line says so); the existing rules re-derive nothing from it
  if (ctx.lifecycle.closed) {
    ctx.log.warn(
      { kind, executionId: p.executionId, definitionId: p.definitionId, sent: ok },
      'operator notification finished after shutdown; not recorded',
    );
    return ok;
  }
  ctx.repos.notifications.record(kind, p.executionId, p.definitionId, ok ? 'sent' : 'failed');
  return ok;
}
