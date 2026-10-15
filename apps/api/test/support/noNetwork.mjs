// Preloaded into every spawned tool process (node --import): DNS lookups fail, so a request that should not
// happen cannot leave the machine (ts-002; the in-process tests get the same rule from WP4's network guards).
import dns from 'node:dns';

const refuse = (hostname, ...rest) => {
  const callback = rest.find((x) => typeof x === 'function');
  const error = Object.assign(new Error(`spawned tool test makes no DNS lookups (${hostname})`), {
    code: 'ENOTFOUND',
  });
  if (typeof callback === 'function') process.nextTick(() => callback(error));
};
Object.defineProperty(dns, 'lookup', { value: refuse, writable: true, configurable: true });
