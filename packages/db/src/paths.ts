import { fileURLToPath } from 'node:url';

/** Absolute paths of the package's committed assets, valid from `src/` (Vitest) and `dist/` (image). Spec §7. */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../drizzle', import.meta.url));
export const AIRPORTS_DATA_DIR = fileURLToPath(new URL('../data', import.meta.url));
