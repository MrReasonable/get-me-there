import { randomBytes } from 'node:crypto';
import { closeSync, fchmodSync, fsyncSync, openSync, renameSync, rmSync, writeSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/**
 * The worker's one way to write its own files (ca-b1-015): the cool-down, the pacer, the refusals, the SOCS capture,
 * the monthly counts, the app instances and fonts.conf. A temporary file with a name of its own beside the target,
 * created exclusively at 0600 (so a stale or planted temporary file is never reused or widened), written, flushed to
 * disk, then renamed over the target: a reader sees the old file or the new one, never half of one, and a crash after
 * the rename keeps the new one (the monthly reservation must survive a kill).
 */
export function writePrivateFile(path: string, text: string): void {
  const tmp = join(dirname(path), `.${basename(path)}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`);
  const fd = openSync(tmp, 'wx', 0o600);
  try {
    try {
      fchmodSync(fd, 0o600);
      writeSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}
