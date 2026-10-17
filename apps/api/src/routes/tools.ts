/** Spec §10 `/tools/record`: the recording script inside the app process, which holds app_lock (spec §7). */
import { apiContract } from '@gmt/core';
import { ApiError } from '../errors.js';
import { safeMessage } from '../safeMessage.js';
import { API_TEXT } from '../text.js';
import { NO_INPUT, route } from './define.js';
import { oneAtATime } from './shared.js';
import type { HandlerTable } from './types.js';

const TOOL_KEY = 'tool';

export const toolHandlers: HandlerTable = {
  /**
   * Refused with 409 inside a container (decision 62); one tool at a time; an unregistered runner is 503; a runner that
   * throws is 500 with a scrubbed log line.
   */
  'POST /api/tools/record': route(
    { request: apiContract.toolRecordRequestSchema, query: NO_INPUT },
    async (c, { body }, ctx) => {
      // why: plan decision 62: recordings are local-only (decision 61), so the route refuses inside a container.
      // `inContainer` is IN_CONTAINER, read by the bootstrap's config parse and passed in on the ports.
      if (ctx.ports.config.inContainer)
        throw new ApiError(409, 'recording_in_container', API_TEXT.recordingInContainer);
      const record = ctx.tools.record;
      if (record === undefined)
        throw new ApiError(503, 'tool_unavailable', API_TEXT.toolUnavailable('record'));
      // why: one tool at a time, whichever it is (spec §10 `/tools/*`): one key, the contract's 409 tool_busy.
      return oneAtATime(
        ctx,
        TOOL_KEY,
        async () => {
          // why: the request's own signal ends the run when the client disconnects, as SIGINT ends the CLI run.
          try {
            return c.json(await record(body, c.req.raw.signal));
          } catch (err) {
            ctx.ports.log.error(
              { tool: 'record', err: { message: safeMessage(err, ctx.ports.secrets) } },
              'tool failed',
            );
            throw new ApiError(500, 'tool_failed', API_TEXT.toolFailed('record'));
          }
        },
        () => new ApiError(409, 'tool_busy', API_TEXT.toolBusy('record')),
      );
    },
  ),
};
