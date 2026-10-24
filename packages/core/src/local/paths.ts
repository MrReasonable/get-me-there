/**
 * Spec §12, §13: where a native install keeps things on disk, the rules the camoufox worker, the `gmt` CLI and the app's
 * status check share (WP17's install paths join them here). why: core imports no `node:` module, so these join with
 * `/`: POSIX only, until the Windows package adds its own rules.
 */

/** The camoufox worker's data directory (the CLI ignores `XDG_*` for it). */
export const workerDataDir = (home: string): string => `${home}/.local/state/get-me-there/camoufox`;
