import * as jestDomMatchers from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';
import { afterEach, expect } from 'vitest';

// Registered explicitly against vitest's own `expect` rather than relying
// on the global side-effect import, so the matchers are guaranteed to be
// attached to the same expect the test files import.
expect.extend(jestDomMatchers);

/**
 * jsdom has no object-URL implementation. Every browser does, so this is a
 * missing piece of the test environment rather than a behaviour under test:
 * without it, any component that previews a chosen file throws on mount.
 * The stub returns a recognisable, unique URL so a preview can be asserted.
 */
if (typeof URL.createObjectURL !== 'function') {
  let n = 0;
  URL.createObjectURL = () => `blob:test/${++n}`;
  URL.revokeObjectURL = () => undefined;
}

// Each test gets a fresh DOM; a leaked render from a previous test is a
// classic source of false passes in UI suites.
afterEach(() => {
  cleanup();
});
