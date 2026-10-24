import type { Deps } from '../deps.js';
import type { RenderedService, ServiceFacts, ServiceSpec } from '../platform/types.js';
import { appServiceSpec, backupServiceSpec } from './specs.js';

/** One installed service: its spec, its rendered files, and the unit `start`/`stop` act on (the job's service for a job). */
export interface ServiceEntry {
  name: ServiceSpec['name'];
  spec: ServiceSpec;
  rendered: RenderedService[];
  unit: string;
}

/** The services this package installs, in install order: the app, then the daily backup job (WP17 adds the worker). */
export function serviceSet(deps: Deps): ServiceEntry[] {
  const input = {
    execPath: deps.execPath,
    checkout: deps.checkout,
    home: deps.home,
    paths: deps.platform.paths,
  };
  return [appServiceSpec(input), backupServiceSpec(input)].map((spec) => {
    const rendered = deps.platform.serviceManager.render(spec, deps.platform.paths);
    return { name: spec.name, spec, rendered, unit: rendered[0]?.unitName ?? spec.name };
  });
}

/** Every entry's facts, read once through the runner. */
export async function factsOf(
  deps: Deps,
  entries: readonly ServiceEntry[],
): Promise<Map<string, ServiceFacts>> {
  const all = new Map<string, ServiceFacts>();
  for (const e of entries)
    for (const [k, v] of await deps.platform.serviceManager.facts(e.rendered, deps.run)) all.set(k, v);
  return all;
}

export const NOT_INSTALLED: ServiceFacts = { onDisk: null, loaded: false, state: 'not-installed' };
export const factOf = (facts: ReadonlyMap<string, ServiceFacts>, unit: string): ServiceFacts =>
  facts.get(unit) ?? NOT_INSTALLED;
