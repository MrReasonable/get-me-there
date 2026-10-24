import { describe, expect, it } from 'vitest';
import { type DockerFacts, gatherDocker, judgeDocker } from '../../src/setup/docker.js';
import { testWorld } from '../support/deps.js';

const none: DockerFacts = { command: false, daemon: false, project: false, volume: false };
const flags = { importDocker: false, ignoreDocker: false, nativeInstalled: false };
const EARLIER =
  'an earlier Docker install exists: use --import-docker to move its data, or --ignore-docker to start fresh (the Docker database is then marked moved)';
const DAEMON = 'start Docker so setup can check for an existing compose app, or pass --ignore-docker';

describe('the Docker checks (spec §13 "One app per ledger")', () => {
  it('no docker command passes', () => {
    expect(judgeDocker(none, flags)).toEqual([]);
  });
  it('docker present, daemon not answering, refuses', () => {
    expect(judgeDocker({ ...none, command: true }, flags).map((p) => p.message)).toEqual([DAEMON]);
  });
  it.each([
    ['a compose project (running or stopped)', { project: true }],
    ['the volume', { volume: true }],
  ])('%s refuses native setup', (_n, over) => {
    expect(
      judgeDocker({ command: true, daemon: true, project: false, volume: false, ...over }, flags).map(
        (p) => p.message,
      ),
    ).toEqual([EARLIER]);
  });
  it('with --import-docker or --ignore-docker the earlier install is allowed (it is moved or marked)', () => {
    const f = { command: true, daemon: true, project: true, volume: true };
    expect(judgeDocker(f, { ...flags, importDocker: true })).toEqual([]);
    expect(judgeDocker(f, { ...flags, ignoreDocker: true })).toEqual([]);
  });
  it('--ignore-docker with the daemon down refuses: the marker cannot be written', () => {
    expect(
      judgeDocker({ ...none, command: true }, { ...flags, ignoreDocker: true }).map((p) => p.message),
    ).toEqual([
      'the Docker daemon does not answer, so the compose volume cannot be marked moved: start Docker and run setup again',
    ]);
  });
  it('--import-docker with nothing to import refuses', () => {
    expect(
      judgeDocker({ ...none, command: true, daemon: true }, { ...flags, importDocker: true }).map(
        (p) => p.message,
      ),
    ).toEqual([
      'there is no Docker install (no compose project get-me-there and no volume get-me-there_gmt-data) to import',
    ]);
    expect(judgeDocker(none, { ...flags, importDocker: true })).toHaveLength(1);
  });
  it('a re-run over a native install does not refuse over the old, already moved, volume', () => {
    expect(
      judgeDocker(
        { command: true, daemon: true, project: true, volume: true },
        { ...flags, nativeInstalled: true },
      ),
    ).toEqual([]);
  });

  it('gatherDocker reads docker, docker info, compose ps -a and volume inspect', async () => {
    const w = testWorld({
      run: (a) =>
        a[1] === 'compose'
          ? { code: 0, stdout: '{"Name":"get-me-there-app-1","State":"exited"}\n' }
          : a[1] === 'volume'
            ? { code: 1 }
            : undefined,
    });
    expect(await gatherDocker(w.deps)).toEqual({ command: true, daemon: true, project: true, volume: false });
    expect(w.runner.calls.map((c) => c.argv)).toEqual([
      ['docker', '--version'],
      ['docker', 'info', '--format', '{{.ServerVersion}}'],
      ['docker', 'compose', '-p', 'get-me-there', 'ps', '-a', '--format', 'json'],
      ['docker', 'volume', 'inspect', 'get-me-there_gmt-data'],
    ]);
    const empty = testWorld({ run: (a) => (a[1] === 'compose' ? { code: 0, stdout: '' } : undefined) });
    expect((await gatherDocker(empty.deps)).project).toBe(false);
    const noDocker = testWorld({ run: (a) => (a[0] === 'docker' ? { code: 127 } : undefined) });
    expect(await gatherDocker(noDocker.deps)).toEqual(none);
    expect(noDocker.runner.calls).toHaveLength(1);
    const down = testWorld({ run: (a) => (a[1] === 'info' ? { code: 1 } : undefined) });
    expect(await gatherDocker(down.deps)).toEqual({ ...none, command: true });
  });
});
