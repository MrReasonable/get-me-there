// The camoufox build table, the verified flags and the pure start checks (spec §2 rev 36; decisions 73, 76, 81; WP16a
// Task 16a.5): the pieces WP16b's CLI, WP17's install and worker, and WP18's status report all read from core.
import { beforeEach, describe, expect, expectTypeOf, it } from 'vitest';
import {
  bundleDirName,
  CAMOUFOX_BUILDS,
  camoufoxBuildSchema,
  FLAG_NAMES,
  FLAGS,
  type FlagName,
  flagsFor,
  OS_ARCHES,
  REDIRECT_HOSTS,
  versionOf,
} from '../../src/camoufox/builds.js';
import {
  START_REFUSAL_REASONS,
  type StartConsent,
  type StartFacts,
  startChecks,
} from '../../src/camoufox/start.js';
import * as core from '../../src/index.js';
import { asIsoDateTime, type IsoDateTime } from '../../src/types/ids.js';

beforeEach(() => {
  expect.hasAssertions();
});

const PINNED = '152.0.4-beta.28';

describe('CAMOUFOX_BUILDS (WP17 §0: release v152.0.4-beta.28)', () => {
  it('has one entry per OsArch, each passing its schema', () => {
    expect(OS_ARCHES).toEqual(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64']);
    expect(Object.keys(CAMOUFOX_BUILDS)).toEqual([...OS_ARCHES]);
    for (const k of OS_ARCHES)
      expect(camoufoxBuildSchema.safeParse(CAMOUFOX_BUILDS[k]).success, k).toBe(true);
    expect(core.CAMOUFOX_BUILDS).toBe(CAMOUFOX_BUILDS);
  });

  it('pins the four assets of the release with the digests and sizes research 17.0a recorded', () => {
    const asset = (s: string) =>
      `https://github.com/daijro/camoufox/releases/download/v152.0.4-beta.28/camoufox-152.0.4-beta.28-${s}.zip`;
    expect(
      OS_ARCHES.map((k) => [
        k,
        CAMOUFOX_BUILDS[k].build,
        CAMOUFOX_BUILDS[k].url,
        CAMOUFOX_BUILDS[k].sha256,
        CAMOUFOX_BUILDS[k].bytes,
      ]),
    ).toEqual([
      [
        'darwin-arm64',
        PINNED,
        asset('mac.arm64'),
        '8b7680a61818245cf4eb0150edab811d4ed937b6723514569e74c3e7df9685bd',
        312_626_286,
      ],
      [
        'darwin-x64',
        PINNED,
        asset('mac.x86_64'),
        '6e0efd66f6db46bece072827cb2c5a4851bca822ff4fed95b8a0c2fb6f61a3d4',
        319_866_512,
      ],
      [
        'linux-arm64',
        PINNED,
        asset('lin.arm64'),
        '3a105a2fc929e80a79b4b7fce2c93ed62c4fb2c877f3c1ed2a5d66a1c4fe968f',
        653_814_950,
      ],
      [
        'linux-x64',
        PINNED,
        asset('lin.x86_64'),
        '924f3109ccd6d47cd6a0384d67a345fadf975d48b6319f8dbbd5954c588982bd',
        663_387_175,
      ],
    ]);
  });

  it('the schema refuses a URL outside the release prefix, an http: URL, a short hash and a stray field', () => {
    const ok = CAMOUFOX_BUILDS['darwin-arm64'];
    const bad = (o: Record<string, unknown>) => camoufoxBuildSchema.safeParse({ ...ok, ...o }).success;
    expect(bad({})).toBe(true);
    expect(bad({ url: 'https://example.com/camoufox.zip' })).toBe(false);
    expect(bad({ url: ok.url.replace('https:', 'http:') })).toBe(false);
    expect(bad({ url: 'https://github.com/someone-else/camoufox/releases/download/v1/x.zip' })).toBe(false);
    expect(bad({ sha256: ok.sha256.slice(0, 63) })).toBe(false);
    expect(bad({ sha256: ok.sha256.toUpperCase() })).toBe(false);
    expect(bad({ build: '152.0.4' })).toBe(false);
    expect(bad({ bytes: 0 })).toBe(false);
    expect(bad({ unpackedBytes: 1.5 })).toBe(false);
    expect(bad({ hashedOn: '2026-13-01' })).toBe(false);
    expect(bad({ extra: 1 })).toBe(false);
  });

  it('versionOf splits each entry’s build at the first hyphen; bundleDirName adds the digest’s first 8 hex characters', () => {
    for (const k of OS_ARCHES) {
      const b = CAMOUFOX_BUILDS[k];
      expect(versionOf(b)).toEqual({ version: '152.0.4', release: 'beta.28' });
      expect(`${versionOf(b).version}-${versionOf(b).release}`).toBe(b.build);
    }
    expect(bundleDirName(CAMOUFOX_BUILDS['darwin-arm64'])).toBe('152.0.4-beta.28-8b7680a6');
    expect(bundleDirName(CAMOUFOX_BUILDS['linux-x64'])).toBe('152.0.4-beta.28-924f3109');
    expect(versionOf({ build: '1.2-alpha.1-x' })).toEqual({ version: '1.2', release: 'alpha.1-x' });
  });

  it('names the hosts a download may be redirected to', () => {
    expect(REDIRECT_HOSTS).toEqual([
      'github.com',
      'objects.githubusercontent.com',
      'release-assets.githubusercontent.com',
    ]);
  });
});

/** The worker's flags as its selectors module states them today (2026-10-18 recordings), one by one. */
const WORKER_FLAGS: Readonly<Record<FlagName, boolean>> = {
  RESULTS_VERIFIED: true,
  FORM_VERIFIED: true,
  CHEAPEST_FLOW_VERIFIED: true,
  VIEW_MORE_ADDS_CHEAPER: false,
  NO_FLIGHTS_VERIFIED: true,
  SOCS_STABLE: true,
  GRID_VERIFIED: true,
  // why: WP17 Task 17.4: false until research 17.0c's recordings show the landing view
  LANDING_VERIFIED: false,
};

describe('FLAGS and flagsFor (spec §2 rev 36: flags per <os>-<arch>, bound to their build)', () => {
  it('lists every flag the worker has, exhaustively', () => {
    expect(FLAG_NAMES).toEqual([
      'RESULTS_VERIFIED',
      'FORM_VERIFIED',
      'CHEAPEST_FLOW_VERIFIED',
      'VIEW_MORE_ADDS_CHEAPER',
      'NO_FLIGHTS_VERIFIED',
      'SOCS_STABLE',
      'GRID_VERIFIED',
      'LANDING_VERIFIED',
    ]);
  });

  it('darwin-arm64 holds the worker’s current values, flag by flag, for the pinned build', () => {
    expect(FLAGS['darwin-arm64'].build).toBe(PINNED);
    for (const f of FLAG_NAMES) expect(FLAGS['darwin-arm64'].flags[f], f).toBe(WORKER_FLAGS[f]);
    expect(Object.keys(FLAGS['darwin-arm64'].flags)).toEqual([...FLAG_NAMES]);
  });

  it('every other entry is all false until its own recording session', () => {
    for (const k of ['darwin-x64', 'linux-arm64', 'linux-x64'] as const) {
      expect(Object.values(FLAGS[k].flags).some(Boolean), k).toBe(false);
      expect(Object.keys(FLAGS[k].flags)).toEqual([...FLAG_NAMES]);
    }
  });

  it('a flag set is bound to its build: an entry with any flag true names the build CAMOUFOX_BUILDS pins', () => {
    for (const k of OS_ARCHES)
      if (Object.values(FLAGS[k].flags).some(Boolean))
        expect(FLAGS[k].build, k).toBe(CAMOUFOX_BUILDS[k].build);
  });

  it('flagsFor gives the entry’s flags for its build, and all false for any other build', () => {
    expect(flagsFor('darwin-arm64', PINNED)).toEqual(WORKER_FLAGS);
    const off = Object.fromEntries(FLAG_NAMES.map((f) => [f, false]));
    expect(flagsFor('darwin-arm64', '152.0.4-beta.27')).toEqual(off);
    expect(flagsFor('darwin-arm64', '')).toEqual(off);
    expect(flagsFor('linux-x64', PINNED)).toEqual(off);
  });
});

describe('startChecks (pure; the worker’s own start and the status report use it)', () => {
  const NOW = asIsoDateTime('2027-03-01T06:00:00.000Z');
  const ready: StartFacts = {
    osArch: 'darwin-arm64',
    installedBuild: PINNED,
    layoutOk: true,
    consent: { kind: 'socs', expiresAt: asIsoDateTime('2028-03-01T00:00:00.000Z') },
    signedIn: false,
    locked: false,
    now: NOW,
  };

  it('null when every check passes (a socs record, or no consent screen in the region)', () => {
    expect(startChecks(ready)).toBeNull();
    expect(
      startChecks({
        ...ready,
        consent: { kind: 'not-shown', expiresAt: asIsoDateTime('2027-03-02T00:00:00.000Z') },
      }),
    ).toBeNull();
  });

  it.each([
    ['locked', { locked: true }],
    ['flags-unset', { osArch: null }],
    ['flags-unset', { osArch: 'linux-x64' }],
    ['layout', { layoutOk: false }],
    ['build-mismatch', { installedBuild: '152.0.4-beta.27' }],
    ['build-mismatch', { installedBuild: null }],
    ['signed-in', { signedIn: true }],
    ['consent-missing', { consent: null }],
    ['consent-voided', { consent: { kind: 'voided' } }],
    ['consent-expired', { consent: { kind: 'socs', expiresAt: NOW } }],
  ] as const)('%s from %j', (reason, facts) => {
    expect(startChecks({ ...ready, ...facts })).toBe(reason);
  });

  it('a voided record has no expiry to read (R31): the type refuses one', () => {
    const voided: StartConsent = { kind: 'voided' };
    expect(startChecks({ ...ready, consent: voided })).toBe('consent-voided');
    expectTypeOf<Extract<StartConsent, { kind: 'voided' }>>().toEqualTypeOf<{ kind: 'voided' }>();
    expectTypeOf<Exclude<StartConsent, { kind: 'voided' }>['expiresAt']>().toEqualTypeOf<IsoDateTime>();
  });

  it('consent expiry is the record’s expiresAt: one millisecond after now still starts', () => {
    expect(
      startChecks({
        ...ready,
        consent: { kind: 'socs', expiresAt: asIsoDateTime('2027-03-01T06:00:00.001Z') },
      }),
    ).toBeNull();
  });

  it('returns every START_REFUSAL_REASONS value from some facts', () => {
    const seen = new Set<string>();
    for (const facts of [
      { locked: true },
      { osArch: null },
      { layoutOk: false },
      { installedBuild: null },
      { signedIn: true },
      { consent: null },
      { consent: { kind: 'voided' as const } },
      { consent: { kind: 'socs' as const, expiresAt: NOW } },
    ])
      seen.add(String(startChecks({ ...ready, ...facts })));
    expect([...seen].sort()).toEqual([...START_REFUSAL_REASONS].sort());
  });
});

// why: WP16a Task 16a.8 — the edges the mutation run found unpinned in the build table
describe('the build table at its edges', () => {
  const row = CAMOUFOX_BUILDS['darwin-arm64'];
  it.each([
    ['x152.0.4-beta.28', false],
    ['152.0.4-beta.28x', false],
    ['152.10.4-beta.28', true],
    ['152.0.40-beta.28', true],
  ])('build %s parses: %s', (build, ok) => {
    expect(camoufoxBuildSchema.safeParse({ ...row, build }).success).toBe(ok);
  });
  it('a digest is exactly 64 lowercase hex characters', () => {
    expect(camoufoxBuildSchema.safeParse({ ...row, sha256: `x${row.sha256}` }).success).toBe(false);
    expect(camoufoxBuildSchema.safeParse({ ...row, sha256: `${row.sha256}x` }).success).toBe(false);
  });
  it.each(OS_ARCHES)('%s: its flags were set on its own pinned build', (osArch) => {
    expect(FLAGS[osArch].build).toBe(CAMOUFOX_BUILDS[osArch].build);
  });
});
