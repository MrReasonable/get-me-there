import { GOOGLE_CONTACTED_HEADER, type StartRefusal } from '@gmt/core';
import type { Action } from '../plan/action.js';
import { refusalWithFix } from './refusal.js';

/**
 * The question every start of the worker waits on (spec §13): a request to the worker's status route on loopback,
 * without its key. The worker listens only once its start checks have passed and its browser has launched, and it
 * answers this request from its HTTP layer alone (401 before any route runs: no page, no cookie read, no log line). The
 * answer carries the worker's own GOOGLE_CONTACTED_HEADER, which tells the worker from anything else on that port, so a
 * bare TCP connection is not enough. The address is always 127.0.0.1, and a redirect is never followed.
 */
export const workerAddress = (port: number): string => `127.0.0.1:${port}`;
export const workerAnswerUrl = (port: number): string => `http://${workerAddress(port)}/v1/status`;

/** Whether an answer came from the worker: any status, with the header every one of its answers carries. */
export const answeredAsWorker = (headers: Pick<Headers, 'has'>): boolean =>
  headers.has(GOOGLE_CONTACTED_HEADER);

/**
 * What a `waitWorkerAnswers` that ran out of time says: the address it asked, where the worker's log is, and the start
 * refusal file when the worker left one (with its words and fix, or that it cannot be read; nothing else from it).
 */
export function notAnswering(
  a: Extract<Action, { kind: 'waitWorkerAnswers' }>,
  refusal: StartRefusal | 'none' | 'unreadable',
): string {
  const said =
    refusal === 'none'
      ? ''
      : refusal === 'unreadable'
        ? `; its start refusal file ${a.refusalFile} is there but cannot be read`
        : `; its start refusal file ${a.refusalFile} (written ${refusal.at}) says: ${refusalWithFix(refusal)}`;
  return `the worker did not answer on ${workerAddress(a.port)} within ${a.timeoutSeconds} s; its log: ${a.log}${said}`;
}
