/**
 * A credential that cannot be printed by accident. The value lives in a closure, not a
 * property, so `JSON.stringify`, `console.log`, `util.inspect`, `Object.keys` and pino
 * serialisation all see `[redacted]`. Call `reveal()` at the one place the header is built.
 * Spec §5.3.
 */
export class Secret {
  // why: `declare` emits no class field (useDefineForClassFields would reset it to undefined); the
  // non-enumerable property defined below keeps the closure off every enumeration path.
  declare readonly reveal: () => string;
  constructor(value: string) {
    Object.defineProperty(this, 'reveal', { enumerable: false, value: () => value, writable: false });
  }
  toString(): string {
    return '[redacted]';
  }
  toJSON(): string {
    return '[redacted]';
  }
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return '[redacted]';
  }
}
