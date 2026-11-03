import type { Logger } from '@gmt/core';
import { errorText } from './errors.js';
import type { RunState } from './run.js';

/** The passes running in this process, so cancel/shutdown can reach them and resume can refuse duplicates. */
export interface RunRegistry {
  launch(run: RunState, body: () => Promise<void>): void;
  get(executionId: string): RunState | undefined;
  done(executionId: string): Promise<void> | undefined;
  all(): RunState[];
  settleAll(): Promise<void>;
}

/** Told when a pass starts and when it settles (spec §2 "The keep-awake lease": the engine's AwakeKeeper). */
export interface RunWatch {
  started(): void;
  ended(): void;
}

export function createRegistry(log: Logger, watch?: RunWatch): RunRegistry {
  const runs = new Map<string, { run: RunState; done: Promise<void> }>();
  return {
    launch(run, body) {
      watch?.started();
      const done = body()
        .catch((err: unknown) => {
          // why: execute() catches every stage error itself; reaching here means finish() threw, which is a bug worth a loud line
          log.error(
            { executionId: run.executionId, err: errorText(err) },
            'execution body threw outside the error table',
          );
        })
        .finally(() => {
          runs.delete(run.executionId);
          watch?.ended();
        });
      runs.set(run.executionId, { run, done });
    },
    get: (id) => runs.get(id)?.run,
    done: (id) => runs.get(id)?.done,
    all: () => [...runs.values()].map((r) => r.run),
    settleAll: async () => {
      await Promise.all([...runs.values()].map((r) => r.done));
    },
  };
}
