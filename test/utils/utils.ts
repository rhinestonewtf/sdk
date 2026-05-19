import { expect } from 'vitest'

function assertNotNull<T>(value: T | null): asserts value is T {
  expect(value).not.toBeNull()
}

export { assertNotNull }
