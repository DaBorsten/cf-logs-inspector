/// <reference lib="dom" />
/**
 * vitest setup for renderer (jsdom) tests: jest-dom matchers and the DOM APIs Radix primitives expect
 * that jsdom lacks. Safe to load in the node environment too (guards on `window`).
 */
import '@testing-library/jest-dom/vitest';

if (typeof window !== 'undefined') {
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
  if (!('ResizeObserver' in window)) {
    (window as unknown as Record<string, unknown>)['ResizeObserver'] = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
}
