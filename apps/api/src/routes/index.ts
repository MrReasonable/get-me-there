/** Every handler, keyed by its ROUTES entry (`${method} ${path}`). */
import { systemHandlers } from './system.js';
import type { HandlerTable } from './types.js';

export const HANDLERS: HandlerTable = {
  ...systemHandlers,
};
