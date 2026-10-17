/**
 * Bounded worker pool. Spec §8.1: "for each tile (bounded pool = provider CONCURRENCY)" and "bounded pool of cells
 * (provider CONCURRENCY)".
 *
 * Starts at most `concurrency` lanes; a lane stops taking items once `intake` aborts or a worker has thrown. `intake`
 * only stops new work: a worker already running finishes (decision 25, a reservation that passed every cap is
 * honoured), and the pool always waits for it, so no write races whatever the caller does next. Workers own their
 * error handling; an error that escapes one is rethrown after the pool drains.
 */
export async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  intake: AbortSignal,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw new RangeError(`concurrency must be a positive integer, got ${concurrency}`);
  let next = 0;
  const failures: unknown[] = [];
  const lane = async (): Promise<void> => {
    while (!intake.aborted && failures.length === 0) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) return;
      try {
        await worker(item, index);
      } catch (error) {
        failures.push(error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => lane()));
  if (failures.length > 0) throw failures[0];
}
