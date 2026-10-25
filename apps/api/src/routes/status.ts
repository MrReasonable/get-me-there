/** Spec §10 `GET /status`: the one report of what works and what to do about what does not. Reads only. */
import { buildStatus } from '../read/status.js';
import { gatherFacts } from '../read/statusSources.js';
import { plain } from './define.js';
import type { HandlerTable } from './types.js';

export const statusHandlers: HandlerTable = {
  'GET /api/status': plain(async (c, _input, ctx) => c.json(buildStatus(await gatherFacts(ctx, ctx.status)))),
};
