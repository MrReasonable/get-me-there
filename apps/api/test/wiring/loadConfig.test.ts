import { mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseConfig, syntheticAllowed } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { InvalidConfigError, loadConfigFromEnv, tolerantRealpath } from '../../src/wiring.js';
import { ALL_VARS, cleanEnv, SENTINEL_SMTP, testEnv } from '../helpers/env.js';
import { tempDir } from '../helpers/tmp.js';

describe('tolerantRealpath (spec §5.5: databasePath is realpath-resolved before the config is built)', () => {
  it('passes :memory: through', () => {
    expect(tolerantRealpath(':memory:')).toBe(':memory:');
  });
  it('resolves an existing file through a symlinked directory', () => {
    const real = tempDir();
    writeFileSync(join(real, 'a.db'), '');
    const link = join(tempDir(), 'link');
    symlinkSync(real, link);
    expect(tolerantRealpath(join(link, 'a.db'))).toBe(join(realpathSync(real), 'a.db'));
  });
  it('resolves a missing file by its directory', () => {
    const real = tempDir();
    const link = join(tempDir(), 'link');
    symlinkSync(real, link);
    expect(tolerantRealpath(join(link, 'new.db'))).toBe(join(realpathSync(real), 'new.db'));
  });
  it('throws when the directory itself is missing', () => {
    expect(() => tolerantRealpath(join(tempDir(), 'missing', 'nested', 'a.db'))).toThrow(/ENOENT/);
  });
  it('refuses a dangling symlink, whose own name could pass the .fixture.db suffix (prov-wp04b-001)', () => {
    const dir = tempDir();
    symlinkSync(join(dir, 'prod.db'), join(dir, 'x.fixture.db'));
    expect(() => tolerantRealpath(join(dir, 'x.fixture.db'))).toThrow(
      /symbolic link to a file that does not exist/,
    );
  });
});

describe('loadConfigFromEnv (plan "Wiring and bootstraps")', () => {
  it('returns the parsed config with a realpath-resolved database path', () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'data'));
    const config = loadConfigFromEnv(
      testEnv({ NODE_ENV: 'development', DATABASE_PATH: join(dir, 'data', 'dev.db') }),
    );
    expect(config.databasePath).toBe(join(realpathSync(dir), 'data', 'dev.db'));
    expect(config.providers.searchapi).not.toBeNull();
  });

  it('throws InvalidConfigError naming every invalid field and never echoing a value', () => {
    const env = cleanEnv({
      NODE_ENV: 'production',
      DATABASE_PATH: ':memory:',
      BIND_ADDRESS: '0.0.0.0',
      SMTP_PASS: SENTINEL_SMTP,
    });
    const direct = parseConfig(env, { realpath: tolerantRealpath });
    if (direct.ok) throw new Error('fixture env should be invalid');
    expect(direct.errors.length).toBeGreaterThanOrEqual(2);
    let caught: unknown;
    try {
      loadConfigFromEnv(env);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InvalidConfigError);
    if (!(caught instanceof InvalidConfigError)) return;
    expect(caught.errors).toEqual(direct.errors);
    for (const { field } of direct.errors) expect(caught.message).toContain(field);
    expect(caught.message).not.toContain(SENTINEL_SMTP);
  });

  it('reports an unresolvable DATABASE_PATH as that field', () => {
    expect(() =>
      loadConfigFromEnv(
        testEnv({ NODE_ENV: 'development', DATABASE_PATH: join(tempDir(), 'no', 'such', 'x.db') }),
      ),
    ).toThrow(/DATABASE_PATH: cannot be resolved/);
  });

  it('a .fixture.db symlink to an existing production file closes the synthetic gate (spec §5.5 symlink case)', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'prod.db'), '');
    symlinkSync(join(dir, 'prod.db'), join(dir, 'x.fixture.db'));
    const config = loadConfigFromEnv(
      testEnv({
        NODE_ENV: 'development',
        ALLOW_FIXTURE_PROVIDER: 'i-understand-this-is-fake',
        DATABASE_PATH: join(dir, 'x.fixture.db'),
      }),
    );
    expect(config.databasePath.endsWith('prod.db')).toBe(true);
    expect(syntheticAllowed(config)).toBe(false);
  });

  it('ALL_VARS names every variable core parseConfig reads, so test envs blank all of them (arch-017)', () => {
    const schema = readFileSync(
      fileURLToPath(new URL('../../../../packages/core/src/config/schema.ts', import.meta.url)),
      'utf8',
    );
    const quoted = [...schema.matchAll(/'([A-Z][A-Z0-9_]{2,})'/g)].map((m) => m[1] ?? '');
    const prefixes = [...schema.matchAll(/providerLimits\(r, '([A-Z]+)'/g)].map((m) => m[1] ?? '');
    const suffixes = [...schema.matchAll(/`\$\{prefix\}_([A-Z_]+)`/g)].map((m) => m[1] ?? '');
    const names = new Set([
      ...quoted.filter((n) => !prefixes.includes(n)),
      ...prefixes.flatMap((p) => suffixes.map((s) => `${p}_${s}`)),
    ]);
    const known: readonly string[] = ALL_VARS;
    expect([...names].filter((n) => !known.includes(n))).toEqual([]);
  });
});
