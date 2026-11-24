import * as jestDomMatchers from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';
import { afterEach, expect } from 'vitest';

// Registered explicitly against vitest's own `expect` rather than relying
// on the global side-effect import, so the matchers are guaranteed to be
// attached to the same expect the test files import.
expect.extend(jestDomMatchers);

// Each test gets a fresh DOM; a leaked render from a previous test is a
// classic source of false passes in UI suites.
afterEach(() => {
  cleanup();
});
