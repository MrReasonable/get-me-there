// Holds the write lock on a file database for `holdMs`, then commits (plan Review Focus 5: contention that
// busy_timeout=5000 must absorb). Raw better-sqlite3, so the worker needs no workspace TypeScript.
import { parentPort, workerData } from 'node:worker_threads';
import Database from 'better-sqlite3';

const db = new Database(workerData.path);
db.prepare('BEGIN IMMEDIATE').run();
db.prepare(
  `INSERT INTO provider_requests (provider_id, endpoint_path, started_at, outcome, cost_micro_gbp, http_attempt) VALUES ('travelpayouts', '/held', ?, 'ok', 0, 1)`,
).run(workerData.at);
parentPort.postMessage('holding');
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, workerData.holdMs);
db.prepare('COMMIT').run();
db.close();
parentPort.postMessage('released');
