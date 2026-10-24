// Spec §13 docker-compose.yml and §5.5 (the environment allowlist); plan decision 53 (one app per volume) and the
// spec's Mailpit rule (host-side development only).

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';
import { envExampleVariables, read } from './files.js';

// why: the parsed YAML is unknown; a schema states the shape the tests read, so nothing is cast (decision 48).
const serviceSchema = z.looseObject({
  build: z.unknown().optional(),
  image: z.string().optional(),
  init: z.boolean().optional(),
  restart: z.string().optional(),
  stop_grace_period: z.string().optional(),
  user: z.unknown().optional(),
  read_only: z.boolean().optional(),
  tmpfs: z.array(z.string()).optional(),
  cap_drop: z.array(z.string()).optional(),
  security_opt: z.array(z.string()).optional(),
  ports: z.array(z.string()).optional(),
  volumes: z.array(z.string()).optional(),
  environment: z.record(z.string(), z.string()).optional(),
  env_file: z.unknown().optional(),
  healthcheck: z.unknown().optional(),
  depends_on: z.unknown().optional(),
  logging: z.object({ driver: z.string(), options: z.record(z.string(), z.string()) }).optional(),
  profiles: z.array(z.string()).optional(),
});
const composeSchema = z.object({
  name: z.string(),
  services: z.object({ app: serviceSchema, mailpit: serviceSchema }),
  volumes: z.record(z.string(), z.unknown()),
});

const compose = composeSchema.parse(parse(read('docker-compose.yml')));
const app = compose.services.app;
const env = app.environment ?? {};

/** Variables compose must never pass (spec §5.5, §12): the Dockerfile sets the first two; the rest are dev/test only. */
const NEVER = ['NODE_ENV', 'IN_CONTAINER', 'ALLOW_FIXTURE_PROVIDER', 'FIXTURE_COST_MICRO_GBP'];
/** Forwarded only by the documented Tailscale-only override file, never by the default compose (decision 63). */
const OVERRIDE_ONLY = ['ALLOW_UNAUTHENTICATED'];
/** Values compose fixes because the image layout or the published port depends on them. */
const FIXED: Readonly<Record<string, string>> = {
  DATABASE_PATH: '/data/get-me-there.db',
  PORT: '3000',
  BIND_ADDRESS: '0.0.0.0',
};
/** The one interpolated default: the worker on the Mac, reached through Docker Desktop (spec §12 rev 32, ruling 2). */
const DEFAULTED: Readonly<Record<string, string>> = {
  CAMOUFOX_WORKER_URL: 'http://host.docker.internal:8090',
};

describe('docker-compose.yml app service (spec §13, §5.5)', () => {
  it('passes an explicit allowlist: every .env.example variable except the never-passed and override-only ones', () => {
    const expected = envExampleVariables(read('.env.example')).filter(
      (n) => !NEVER.includes(n) && !OVERRIDE_ONLY.includes(n),
    );
    expect(Object.keys(env).sort()).toEqual(expected);
  });

  it('passes CAMOUFOX_BROWSER_WINDOW, which the app reads (decision 83: compose passes only listed names)', () => {
    expect(env.CAMOUFOX_BROWSER_WINDOW).toBe(`\${CAMOUFOX_BROWSER_WINDOW:-}`);
  });

  it('never passes NODE_ENV, IN_CONTAINER, ALLOW_FIXTURE_PROVIDER or FIXTURE_COST_MICRO_GBP, and has no env_file', () => {
    for (const name of NEVER) expect(env).not.toHaveProperty(name);
    expect(app.env_file).toBeUndefined();
  });

  it('interpolates every non-fixed variable with an empty default and nothing else', () => {
    for (const [name, value] of Object.entries(env))
      expect(value).toBe(FIXED[name] ?? `\${${name}:-${DEFAULTED[name] ?? ''}}`);
  });

  it("publishes on loopback only and runs as the image's user", () => {
    expect(app.ports).toEqual(['127.0.0.1:3000:3000']);
    expect(app.user).toBeUndefined();
  });

  it('stores /data on the named volume, never a bind mount', () => {
    expect(app.volumes).toEqual(['gmt-data:/data']);
    expect(compose.volumes).toHaveProperty('gmt-data');
  });

  it('keeps basic auth on: ALLOW_UNAUTHENTICATED is not forwarded (decision 63)', () => {
    expect(env).not.toHaveProperty('ALLOW_UNAUTHENTICATED');
  });

  it('runs with a read-only root, a /tmp tmpfs, no capabilities and no privilege escalation', () => {
    expect(app.read_only).toBe(true);
    expect(app.tmpfs).toEqual(['/tmp']);
    expect(app.cap_drop).toEqual(['ALL']);
    expect(app.security_opt).toEqual(['no-new-privileges:true']);
  });

  it('inherits the image HEALTHCHECK (one source of truth, asserted in dockerfile.test.ts)', () => {
    expect(app.healthcheck).toBeUndefined();
  });

  it('restarts unless stopped, has a 30 s grace period, an init process and bounded logs', () => {
    expect(app.restart).toBe('unless-stopped');
    expect(app.stop_grace_period).toBe('30s');
    expect(app.init).toBe(true);
    expect(app.logging).toEqual({ driver: 'json-file', options: { 'max-size': '10m', 'max-file': '5' } });
  });
});

describe('docker-compose.yml mailpit service (spec §13: host-side development only)', () => {
  const mailpit = compose.services.mailpit;
  it('exists only under the dev profile, pinned by digest, on loopback ports', () => {
    expect(mailpit.profiles).toEqual(['dev']);
    expect(mailpit.image).toMatch(/^axllent\/mailpit@sha256:[0-9a-f]{64}$/);
    expect(mailpit.ports).toEqual(['127.0.0.1:1025:1025', '127.0.0.1:8025:8025']);
  });
  it('the app has no profile and no dependency on it, so `docker compose up` never starts mailpit', () => {
    expect(app.profiles).toBeUndefined();
    expect(app.depends_on).toBeUndefined();
  });
});
