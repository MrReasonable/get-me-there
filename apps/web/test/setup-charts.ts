// Recharts in jsdom (recharts 3 ResponsiveContainer source, checked 2026-10-15): ResponsiveContainer reads its
// container's getBoundingClientRect() on mount, then observes it with ResizeObserver, and renders no chart while
// width or height is 0. jsdom has no ResizeObserver and reports 0×0 boxes.

/** A no-op ResizeObserver; jsdom never resizes. */
class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
if (typeof globalThis.ResizeObserver === 'undefined') globalThis.ResizeObserver = ResizeObserverStub;

const original = HTMLElement.prototype.getBoundingClientRect;
HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect(this: HTMLElement): DOMRect {
  // why: size only the chart container, so every other layout assertion still sees jsdom's real 0×0.
  if (this.classList.contains('recharts-responsive-container')) {
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 800,
      bottom: 320,
      width: 800,
      height: 320,
      toJSON: () => ({}),
    };
  }
  return original.call(this);
};
