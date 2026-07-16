import { expect, test } from 'vitest'
import { createPendingCompositionHarness } from '../../fakes/composition'

test('composition fixture remains explicitly non-runnable', () => {
  const harness = createPendingCompositionHarness()

  expect(harness.status).toBe('contracts-only')
  expect('factory' in harness).toBe(false)
})
