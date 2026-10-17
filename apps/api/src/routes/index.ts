/** Every handler, keyed by its ROUTES entry (`${method} ${path}`). */
import { alertHandlers } from './alerts.js';
import { definitionHandlers } from './definitions.js';
import { executionHandlers } from './executions.js';
import { historyHandlers } from './history.js';
import { resultHandlers } from './results.js';
import { systemHandlers } from './system.js';
import { toolHandlers } from './tools.js';
import type { HandlerTable } from './types.js';

export const HANDLERS: HandlerTable = {
  ...systemHandlers,
  ...definitionHandlers,
  ...executionHandlers,
  ...resultHandlers,
  ...historyHandlers,
  ...alertHandlers,
  ...toolHandlers,
};
