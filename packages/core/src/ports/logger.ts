/** pino-shaped subset so engine and api can pass a child logger down without importing pino in core. */
export interface Logger {
  debug(o: object, msg?: string): void;
  info(o: object, msg?: string): void;
  warn(o: object, msg?: string): void;
  error(o: object, msg?: string): void;
  child(bindings: object): Logger;
}
