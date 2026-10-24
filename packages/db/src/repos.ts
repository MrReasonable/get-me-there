import type { Clock } from '@gmt/core';
import type { Db } from './client.js';
import { AirportsRepo } from './repositories/airports.js';
import { AlertsRepo } from './repositories/alerts.js';
import { CalendarPricesRepo } from './repositories/calendarPrices.js';
import { CellsRepo } from './repositories/cells.js';
import { DefinitionsRepo } from './repositories/definitions.js';
import { ExecutionsRepo } from './repositories/executions.js';
import { FxRepo } from './repositories/fx.js';
import { ItinerariesRepo } from './repositories/itineraries.js';
import { LedgerRepo } from './repositories/ledger.js';
import { MetaRepo } from './repositories/meta.js';
import { NotificationsRepo } from './repositories/notifications.js';
import { RoutePriceHistoryRepo } from './repositories/routePriceHistory.js';
import type { RepoOptions } from './types.js';

/** Every repository over one database (plan "Database" contract: `Repos` lives in @gmt/db, not in engine). */
export interface Repos {
  airports: AirportsRepo;
  fx: FxRepo;
  definitions: DefinitionsRepo;
  executions: ExecutionsRepo;
  cells: CellsRepo;
  calendarPrices: CalendarPricesRepo;
  itineraries: ItinerariesRepo;
  ledger: LedgerRepo;
  alerts: AlertsRepo;
  notifications: NotificationsRepo;
  routeHistory: RoutePriceHistoryRepo;
  meta: MetaRepo;
}

/**
 * Builds every repository with only what each uses (arch-005). `opts.allowSynthetic` comes from
 * `syntheticAllowed(config)` (spec §5.5) and reaches every repository that writes a provider.
 */
export function createRepos(db: Db, clock: Clock, opts: RepoOptions): Repos {
  return {
    airports: new AirportsRepo(db),
    fx: new FxRepo(db),
    definitions: new DefinitionsRepo(db, clock),
    executions: new ExecutionsRepo(db, clock),
    cells: new CellsRepo(db, clock, opts),
    calendarPrices: new CalendarPricesRepo(db, clock, opts),
    itineraries: new ItinerariesRepo(db, clock, opts),
    ledger: new LedgerRepo(db),
    alerts: new AlertsRepo(db, clock),
    notifications: new NotificationsRepo(db, clock),
    routeHistory: new RoutePriceHistoryRepo(db, opts),
    meta: new MetaRepo(db),
  };
}
