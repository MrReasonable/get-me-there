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

/**
 * A matchMedia whose width can change after the first render: `set(px)` re-evaluates every `(max-width: Npx)` query and
 * fires its `change` listeners, as a browser does when the window crosses a breakpoint.
 */
export function controllableViewport(initial: number): { set: (px: number) => void } {
  let width = initial;
  const queries = new Set<{ limit: number; last: boolean; listeners: Set<() => void> }>();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => {
      const limit = Number(/max-width:\s*(\d+)px/.exec(query)?.[1] ?? Number.NaN);
      const entry = { limit, last: width <= limit, listeners: new Set<() => void>() };
      queries.add(entry);
      return {
        get matches() {
          return width <= limit;
        },
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: (_type: string, l: EventListenerOrEventListenerObject) => {
          if (typeof l === 'function') entry.listeners.add(() => l(new Event('change')));
        },
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      };
    },
  });
  return {
    set: (px) => {
      width = px;
      for (const q of queries) for (const l of q.listeners) l();
    },
  };
}
