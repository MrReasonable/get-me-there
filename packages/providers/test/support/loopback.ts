import dns from 'node:dns';

/**
 * Lets the loopback literal resolve, for the passthrough tests that reach a real local server; returns the undo.
 * why: the network guards refuse every DNS lookup and msw's passthrough socket looks up even an IP literal; real names
 * stay refused.
 */
export function allowLoopbackLookup(): () => void {
  const refused = dns.lookup;
  const lookup = (hostname: string, ...rest: unknown[]): void => {
    const cb = rest.find((x) => typeof x === 'function');
    const opts = rest[0];
    const all = typeof opts === 'object' && opts !== null && 'all' in opts && opts.all === true;
    if (hostname !== '127.0.0.1' || typeof cb !== 'function') {
      Reflect.apply(refused, dns, [hostname, ...rest]);
      return;
    }
    process.nextTick(() =>
      all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4),
    );
  };
  Object.defineProperty(dns, 'lookup', { value: lookup, writable: true, configurable: true });
  return () => {
    Object.defineProperty(dns, 'lookup', { value: refused, writable: true, configurable: true });
  };
}
