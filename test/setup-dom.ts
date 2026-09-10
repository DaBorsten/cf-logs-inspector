/// <reference lib="dom" />
/**
 * vitest setup for renderer (jsdom) tests: jest-dom matchers and the DOM APIs Radix primitives expect
 * that jsdom lacks. Safe to load in the node environment too (guards on `window`).
 */
import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';

if (typeof window !== 'undefined') {
  // Component tests wait on mock IPC round trips and query invalidation; the default 1 s budget for
  // waitFor/findBy* is occasionally exceeded on a loaded machine (seen once alongside a production build).
  configure({ asyncUtilTimeout: 4000 });
  const proto = window.Element.prototype as unknown as Record<string, unknown>;
  if (!proto['scrollIntoView']) proto['scrollIntoView'] = () => {};
  if (!proto['hasPointerCapture']) proto['hasPointerCapture'] = () => false;
  if (!proto['setPointerCapture']) proto['setPointerCapture'] = () => {};
  if (!proto['releasePointerCapture']) proto['releasePointerCapture'] = () => {};
  if (!window.matchMedia) {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList;
  }
  // jsdom has no layout: give virtualized scroll containers (marked with data-virtual-scroll) a viewport so
  // TanStack Virtual renders rows in tests. It measures via offsetWidth/offsetHeight (and ResizeObserver).
  const VIEWPORT = { width: 1200, height: 600 };
  for (const prop of ['offsetWidth', 'offsetHeight'] as const) {
    const desc = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, prop);
    Object.defineProperty(window.HTMLElement.prototype, prop, {
      configurable: true,
      get(this: HTMLElement) {
        if (this.hasAttribute('data-virtual-scroll')) {
          return prop === 'offsetWidth' ? VIEWPORT.width : VIEWPORT.height;
        }
        return (desc?.get?.call(this) as number | undefined) ?? 0;
      },
    });
  }
  const origRect = window.Element.prototype.getBoundingClientRect;
  window.Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
    const rect = origRect.call(this);
    if (!this.hasAttribute('data-virtual-scroll')) return rect;
    const width = 1200;
    const height = 600;
    return {
      ...rect,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      width,
      height,
      right: width,
      bottom: height,
      toJSON: () => ({ width, height }),
    } as DOMRect;
  };
  // CodeMirror measures text with Range rects; jsdom implements neither.
  const emptyRect = (): DOMRect =>
    ({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  const emptyRectList = (): DOMRectList =>
    ({
      length: 0,
      item: () => null,
      [Symbol.iterator]: [][Symbol.iterator],
    }) as unknown as DOMRectList;
  const rangeProto = window.Range.prototype as unknown as Record<string, unknown>;
  if (!rangeProto['getClientRects']) rangeProto['getClientRects'] = emptyRectList;
  if (!rangeProto['getBoundingClientRect']) rangeProto['getBoundingClientRect'] = emptyRect;
  if (!proto['getClientRects']) proto['getClientRects'] = emptyRectList;
  if (!('ResizeObserver' in window)) {
    (window as unknown as Record<string, unknown>)['ResizeObserver'] = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
}
