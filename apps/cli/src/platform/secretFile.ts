import type { Action } from '../plan/action.js';

/** POSIX: a secret file is the user's own, 0600 (decision 78: the one place a POSIX mode is chosen for a secret). */
export const secretFile = (path: string, contents: string): Action => ({
  kind: 'writeFile',
  path,
  contents,
  mode: 0o600,
  secret: true,
});
