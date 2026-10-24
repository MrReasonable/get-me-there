/** Spec §10 `/tools/record` and `/tools/smoke`: the scripts inside the app process, which holds app_lock (spec §7). */
import { apiContract } from '@gmt/core';
import type { Context } from 'hono';
import { ApiError } from '../errors.js';
import { safeMessage } from '../safeMessage.js';
import { API_TEXT } from '../text.js';
import { smokeWorstCase } from '../tools/smokeArgs.js';
import { smokePlan } from '../tools/toolExecution.js';
import { NO_INPUT, plain, route } from './define.js';
import { oneAtATime } from './shared.js';
import type { AppEnv, HandlerTable, RouteContext, ToolRunResponse } from './types.js';

const TOOL_KEY = 'tool';

/**
 * One tool run inside the app process, the same for both tools: an unregistered runner is 503; one tool at a time,
 * whichever it is (spec §10 `/tools/*`: one key, the contract's 409 tool_busy); a runner that throws is 500 with a
 * scrubbed log line. why: the request's own signal ends the run when the client disconnects, as SIGINT ends the CLI run.
 */
async function runInProcess<A>(
  c: Context<AppEnv>,
  ctx: RouteContext,
  name: 'record' | 'smoke',
  runner: ((args: A, signal: AbortSignal) => Promise<ToolRunResponse>) | undefined,
  args: A,
): Promise<Response> {
  if (runner === undefined) throw new ApiError(503, 'tool_unavailable', API_TEXT.toolUnavailable(name));
  return oneAtATime(
    ctx,
    TOOL_KEY,
    async () => {
      try {
        return c.json(await runner(args, c.req.raw.signal));
      } catch (err) {
        ctx.ports.log.error(
          { tool: name, err: { message: safeMessage(err, ctx.ports.secrets) } },
          'tool failed',
        );
        throw new ApiError(500, 'tool_failed', API_TEXT.toolFailed(name));
      }
    },
    () => new ApiError(409, 'tool_busy', API_TEXT.toolBusy(name)),
  );
}

export const toolHandlers: HandlerTable = {
  /** Refused with 409 inside a container (decision 62), then `runInProcess`. */
  'POST /api/tools/record': route(
    { request: apiContract.toolRecordRequestSchema, query: NO_INPUT },
    async (c, { body }, ctx) => {
      // why: plan decision 62: recordings are local-only (decision 61), so the route refuses inside a container.
      // `inContainer` is IN_CONTAINER, read by the bootstrap's config parse and passed in on the ports.
      if (ctx.ports.config.inContainer)
        throw new ApiError(409, 'recording_in_container', API_TEXT.recordingInContainer);
      return runInProcess(c, ctx, 'record', ctx.tools.record, body);
    },
  ),
  /**
   * Spec §10, §13: the smoke runs inside the app process, in a container too (the operator calls it with curl from the
   * host; decision 62 refuses only recording there). The exit code, lines and an empty fixture list come back in the body.
   */
  'POST /api/tools/smoke': route(
    { request: apiContract.toolSmokeRequestSchema, query: NO_INPUT },
    async (c, { body }, ctx) => runInProcess(c, ctx, 'smoke', ctx.tools.smoke, body),
  ),
  /**
   * Spec §10: the smoke's worst case, which `gmt smoke` prints before it asks. Ledgers nothing and calls no provider:
   * it reads the configuration and the guard's own counts only.
   */
  'GET /api/tools/smoke/plan': plain((c, _input, ctx) =>
    c.json(smokePlan(ctx.ports, smokeWorstCase(ctx.ports.config))),
  ),
};
