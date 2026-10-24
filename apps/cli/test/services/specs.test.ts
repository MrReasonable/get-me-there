import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// why: the daily job's argv must parse under the backup script's own parser, not a copy of its rules
import { parseArgs } from '../../../../scripts/backup.mjs';
import { currentPlatform } from '../../src/platform/current.js';
import { appServiceSpec, backupServiceSpec, execPathProblem } from '../../src/services/specs.js';

const darwin = currentPlatform({ platform: 'darwin', arch: 'arm64', uid: 501, env: { HOME: '/Users/a' } });
const linux = currentPlatform({ platform: 'linux', arch: 'x64', uid: 1000, env: { HOME: '/home/a' } });
const at = {
  execPath: '/opt/homebrew/opt/node@22/bin/node',
  checkout: '/Users/a/src/get-me-there',
  home: '/Users/a',
};

describe('the app and backup service specs (spec §13 native mode)', () => {
  it('the app runs node --env-file=<abs app.env> <checkout>/apps/api/dist/bootstrap/start.js with PATH and HOME only', () => {
    const s = appServiceSpec({ ...at, paths: darwin.paths });
    expect(s).toEqual({
      name: 'app',
      argv: [
        at.execPath,
        '--env-file=/Users/a/.config/get-me-there/app.env',
        '/Users/a/src/get-me-there/apps/api/dist/bootstrap/start.js',
      ],
      workingDirectory: at.checkout,
      environment: { PATH: '/opt/homebrew/opt/node@22/bin:/usr/bin:/bin:/usr/sbin:/sbin', HOME: '/Users/a' },
      restart: 'on-failure',
      preventRestartExitStatus: null,
      throttleSeconds: 60,
      calendar: null,
    });
    expect(Object.keys(s.environment).sort()).toEqual(['HOME', 'PATH']);
  });

  it('the backup job runs backup.mjs into data/backups/daily keeping 14, daily at 03:30, never restarted', () => {
    const s = backupServiceSpec({ ...at, home: '/home/a', paths: linux.paths });
    expect(s.argv).toEqual([
      at.execPath,
      '--env-file=/home/a/.config/get-me-there/app.env',
      '/Users/a/src/get-me-there/scripts/backup.mjs',
      '--dir',
      '/home/a/.local/share/get-me-there/backups/daily',
      '--keep',
      '14',
    ]);
    expect([s.name, s.restart, s.calendar, s.preventRestartExitStatus]).toEqual([
      'backup',
      'never',
      { hour: 3, minute: 30 },
      null,
    ]);
  });

  it('the backup argv (after node and --env-file) parses under scripts/backup.mjs, with DATABASE_PATH from app.env', () => {
    const s = backupServiceSpec({ ...at, paths: darwin.paths });
    const r = parseArgs(s.argv.slice(3), '/Users/a/.local/share/get-me-there/get-me-there.db', {
      backupsDirFor: (db: string) => join(db, '..', 'backups'),
      BACKUPS_KEPT: 5,
    });
    expect(r).toEqual({
      ok: true,
      db: '/Users/a/.local/share/get-me-there/get-me-there.db',
      dir: '/Users/a/.local/share/get-me-there/backups/daily',
      keep: 14,
    });
  });

  it.each([
    ['/tmp/node-v22/bin/node', 'a temporary directory'],
    ['/private/var/folders/x/T/n/bin/node', 'a temporary directory'],
    ['/Users/a/.volta/bin/node', 'a version manager’s shim directory'],
    ['/Users/a/.asdf/shims/node', 'a version manager’s shim directory'],
    ['/Users/a/.local/state/fnm_multishells/123_456/bin/node', 'a version manager’s shim directory'],
  ])('refuses %s (%s), naming a stable Node path', (path, why) => {
    const p = execPathProblem(path, 'darwin', ['/private/var/folders/x/T']);
    expect(p).toContain(why);
    expect(p).toContain(path);
    expect(p).toContain('/opt/homebrew/opt/node@22/bin/node');
    expect(execPathProblem(path, 'linux', ['/private/var/folders/x/T'])).toContain('/usr/bin/node');
  });

  it('accepts a stable Node path', () => {
    expect(execPathProblem('/opt/homebrew/opt/node@22/bin/node', 'darwin', ['/var/folders/x/T'])).toBeNull();
    expect(execPathProblem('/usr/bin/node', 'linux', ['/tmp'])).toBeNull();
    expect(execPathProblem('/home/a/.nvm/versions/node/v22.18.0/bin/node', 'linux', ['/tmp'])).toBeNull();
  });
});
