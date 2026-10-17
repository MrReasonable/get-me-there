/** Spec §7 airport seeding, shared by the app and the tool bootstraps (review arch-007). */
import { loadAirportsDataset, seedAirports } from '@gmt/db';
import type { Ports } from '../wiring.js';

/**
 * Seeds after migration when the `airports` table is empty or the vendored dataset's version changed; local files, no
 * network (spec §7). `report` receives one line when it seeds.
 */
export function seedIfNeeded(ports: Ports, dataDir: string, report: (line: string) => void): void {
  const dataset = loadAirportsDataset(dataDir);
  if (ports.repos.airports.count() > 0 && ports.repos.airports.datasetVersion() === dataset.version) return;
  const r = seedAirports(ports.db, dataset);
  report(`airports seeded: ${r.inserted} rows, dataset ${r.datasetVersion}`);
}
