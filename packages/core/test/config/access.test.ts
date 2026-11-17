import { describe, expect, it } from 'vitest';
import {
  AUTH_MISSING,
  AUTH_MISSING_NATIVE,
  isLoopbackHost,
  isLoopbackHostEntry,
  onlyThisMachine,
  type ReachFacts,
  reachBeyondThisMachine,
  reachRefusal,
} from '../../src/config/access.js';

const native: ReachFacts = {
  inContainer: false,
  bindAddress: '127.0.0.1',
  publishedAddress: null,
  allowedHosts: ['localhost:3000', '127.0.0.1:3000'],
};
const container: ReachFacts = {
  ...native,
  bindAddress: '0.0.0.0',
  inContainer: true,
  publishedAddress: '127.0.0.1',
};

describe('who can reach the app (spec §4)', () => {
  it.each([
    ['127.0.0.1', true],
    ['127.3.4.5', true],
    ['127.10.200.255', true],
    ['::1', true],
    ['localhost', true],
    ['0.0.0.0', false],
    ['192.168.1.4', false],
    ['localhost.example', false],
    ['x127.0.0.1', false],
    ['127.0.0.1x', false],
  ])('isLoopbackHost(%s) is %s', (host, want) => {
    expect(isLoopbackHost(host)).toBe(want);
  });

  it.each([
    ['localhost', true],
    ['localhost:3000', true],
    ['LOCALHOST:3000', true],
    ['127.0.0.1:3000', true],
    ['127.0.0.2', true],
    ['127.10.20.30:80', true],
    ['[::1]', true],
    ['[::1]:3000', true],
    ['::1', false],
    ['localhost:', false],
    ['localhost:30a', false],
    ['flights.example.com', false],
    ['laptop.tail1234.ts.net', false],
    ['localhost.example.com', false],
    ['evil.localhost', false],
    ['127.0.0.1.example.com', false],
    ['192.168.1.4:3000', false],
  ])('isLoopbackHostEntry(%s) is %s', (entry, want) => {
    expect(isLoopbackHostEntry(entry)).toBe(want);
  });

  it('a native app on loopback with this machine’s names: only this machine', () => {
    expect(reachBeyondThisMachine(native)).toBeNull();
    expect(onlyThisMachine(native)).toBe(true);
    expect(onlyThisMachine({ ...native, allowedHosts: [] })).toBe(true);
  });

  it('a native bind beyond loopback is the first reason, whatever the hosts', () => {
    const f = { ...native, bindAddress: '0.0.0.0', allowedHosts: ['flights.example.com'] };
    expect(reachBeyondThisMachine(f)).toEqual({ kind: 'bind', address: '0.0.0.0' });
    expect(onlyThisMachine(f)).toBe(false);
  });

  it('natively the published address is not read', () => {
    expect(reachBeyondThisMachine({ ...native, publishedAddress: '0.0.0.0' })).toBeNull();
  });

  it('the first host that is not this machine', () => {
    expect(
      reachBeyondThisMachine({
        ...native,
        allowedHosts: ['localhost:3000', 'laptop.tail1234.ts.net', 'flights.example.com'],
      }),
    ).toEqual({ kind: 'host', host: 'laptop.tail1234.ts.net' });
  });

  it('in the container the published address decides, not the bind', () => {
    expect(reachBeyondThisMachine(container)).toBeNull();
    expect(reachBeyondThisMachine({ ...container, publishedAddress: null })).toEqual({
      kind: 'published',
      address: null,
    });
    expect(reachBeyondThisMachine({ ...container, publishedAddress: '0.0.0.0' })).toEqual({
      kind: 'published',
      address: '0.0.0.0',
    });
    expect(reachBeyondThisMachine({ ...container, allowedHosts: ['flights.example.com'] })).toEqual({
      kind: 'host',
      host: 'flights.example.com',
    });
  });

  it('the fixes: the two lines in .env, or the setup command natively', () => {
    expect(AUTH_MISSING).toBe(
      'add two lines to .env: APP_BASIC_AUTH_USER=<a user name> and APP_BASIC_AUTH_PASS=<a password of at least 12 characters> (docs/setup.md section 1)',
    );
    expect(AUTH_MISSING_NATIVE).toBe('run pnpm gmt setup --reconfigure password, which turns sign-in on');
  });

  it('each refusal names its setting, the reason and the fix for its mode', () => {
    expect(reachRefusal({ kind: 'bind', address: '0.0.0.0' }, 'native')).toEqual({
      field: 'BIND_ADDRESS',
      message: `the app binds 0.0.0.0, which other devices can reach, and has no password: ${AUTH_MISSING_NATIVE}`,
    });
    expect(reachRefusal({ kind: 'published', address: '0.0.0.0' }, 'container')).toEqual({
      field: 'PUBLISHED_ADDRESS',
      message: `the app is published on 0.0.0.0, which other devices can reach, and has no password: ${AUTH_MISSING}`,
    });
    expect(reachRefusal({ kind: 'published', address: null }, 'container')).toEqual({
      field: 'PUBLISHED_ADDRESS',
      message: `not set, so the app cannot tell that only this machine reaches it, and it has no password: ${AUTH_MISSING}`,
    });
    expect(reachRefusal({ kind: 'host', host: 'flights.example.com' }, 'dev')).toEqual({
      field: 'ALLOWED_HOSTS',
      message: `flights.example.com is not this machine, so the app answers to another name, and it has no password: ${AUTH_MISSING}`,
    });
    expect(reachRefusal({ kind: 'host', host: 'flights.example.com' }, 'native').message).toContain(
      'pnpm gmt setup --reconfigure password',
    );
  });
});
