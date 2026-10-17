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

export function createRegistry(log: Logger): RunRegistry {
  const runs = new Map<string, { run: RunState; done: Promise<void> }>();
  return {
    launch(run, body) {
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
