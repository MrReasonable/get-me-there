/** Installs a matchMedia that evaluates `(max-width: Npx)` against a chosen viewport width. */
export function setViewportWidth(px: number): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => {
      const m = /max-width:\s*(\d+)px/.exec(query);
      const limit = m?.[1];
      const matches = limit !== undefined ? px <= Number(limit) : false;
      return {
        matches,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      };
    },
  });
}
