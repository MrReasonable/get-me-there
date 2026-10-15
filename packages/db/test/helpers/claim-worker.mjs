// One contender in the compare-and-set race (spec §8.1): its own connection, a shared start barrier, then the
// repository's own claim statement (passed in as text); reports `changes`.
import { parentPort, workerData } from 'node:worker_threads';
import Database from 'better-sqlite3';

const { path, sql, id, barrier } = workerData;
const db = new Database(path);
db.pragma('busy_timeout = 5000');
const gate = new Int32Array(barrier);
Atomics.add(gate, 0, 1);
Atomics.notify(gate, 0);
while (Atomics.load(gate, 0) < 2) Atomics.wait(gate, 0, 1, 50);
const { changes } = db.prepare(sql).run(id);
db.close();
parentPort.postMessage(changes);
