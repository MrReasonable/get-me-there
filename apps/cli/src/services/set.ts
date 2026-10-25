import type { Deps } from '../deps.js';
import type { RenderedService, ServiceFacts, ServiceSpec } from '../platform/types.js';
import { readEnvText } from '../setup/appEnv.js';
import { appEnvPath, appServiceSpec, backupServiceSpec, workerServiceSpec } from './specs.js';

/** One installed service: its spec, its rendered files, and the unit `start`/`stop` act on (the job's service for a job). */
export interface ServiceEntry {
  name: ServiceSpec['name'];
  spec: ServiceSpec;
  rendered: RenderedService[];
  unit: string;
}

const entryOf = (deps: Deps, spec: ServiceSpec): ServiceEntry => {
  const rendered = deps.platform.serviceManager.render(spec, deps.platform.paths);
  return { name: spec.name, spec, rendered, unit: rendered[0]?.unitName ?? spec.name };
};

/** The browser worker's entry, whether or not it is installed (setup installs it once consent is in place). */
export function workerEntry(deps: Deps): ServiceEntry {
  return entryOf(
    deps,
    workerServiceSpec({
      execPath: deps.execPath,
      checkout: deps.checkout,
      home: deps.home,
      paths: deps.platform.paths,
    }),
  );
}

/** Whether app.env turns the browser provider on (an unreadable file reads as off; the settings checks report it). */
function browserOn(deps: Deps): boolean {
  try {
    const text = deps.files.read(appEnvPath(deps.platform.paths));
    return text !== null && readEnvText(text).CAMOUFOX_ENABLED === 'true';
  } catch {
    return false;
  }
}

/**
 * The services this package installs, in install order: the app, the daily backup job, and the browser worker when
 * the provider is on in app.env or its unit is on disk (so stop, status and uninstall see it), never otherwise.
 */
export function serviceSet(deps: Deps): ServiceEntry[] {
  const input = {
    execPath: deps.execPath,
    checkout: deps.checkout,
    home: deps.home,
    paths: deps.platform.paths,
  };
  const base = [appServiceSpec(input), backupServiceSpec(input)].map((spec) => entryOf(deps, spec));
  const worker = workerEntry(deps);
  const onDisk = worker.rendered.some((r) => {
    try {
      return deps.files.read(r.path) !== null;
    } catch {
      return true;
    }
  });
  return onDisk || browserOn(deps) ? [...base, worker] : base;
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
