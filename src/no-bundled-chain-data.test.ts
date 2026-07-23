import { describe, expect, test } from 'vitest'

// Guard against re-introducing a build-time dependency on
// `@rhinestone/shared-configs`. In v2 the SDK reads chain data at runtime from
// the orchestrator's `/chains` (the chain catalog); the only chain constants
// that remain inlined are the signed arbiter allow-set and the tiny CAIP-2
// non-EVM table. A stray import here would put the SDK back in the position
// where adding a chain requires an SDK release.
const sources = import.meta.glob('./**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

describe('no bundled chain-data dependency', () => {
  test('no source file imports @rhinestone/shared-configs', () => {
    const offenders = Object.entries(sources)
      .filter(([path]) => !path.endsWith('.test.ts'))
      .filter(([, src]) =>
        /\bfrom\s+['"]@rhinestone\/shared-configs['"]/.test(src),
      )
      .map(([path]) => path)

    expect(offenders).toEqual([])
  })
})
