/// <reference types="vite/client" />
import { describe, expect, test } from 'vitest'

// Guard against re-introducing a build-time dependency on
// `@rhinestone/shared-configs`. In v2 the SDK reads chain data at runtime from
// the orchestrator's `/chains` (the chain catalog); the only chain constants
// that remain inlined are the signed arbiter allow-set and the tiny CAIP-2
// non-EVM table. A stray import — in `src` OR the integration suite — would put
// the SDK back where adding a chain needs a release, and (since the dependency
// is gone from the workspace) would break module resolution.
const sources: Record<string, string> = {
  ...import.meta.glob('./**/*.ts', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
  ...import.meta.glob('../test/**/*.ts', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
}

describe('no bundled chain-data dependency', () => {
  test('nothing in src/ or test/ imports @rhinestone/shared-configs', () => {
    const offenders = Object.entries(sources)
      // Exclude this guard file itself (it names the package in the matcher).
      .filter(([path]) => !path.endsWith('no-bundled-chain-data.test.ts'))
      // Exclude generated build output (gitignored; absent in CI).
      .filter(([path]) => !path.includes('/dist/'))
      .filter(([, src]) =>
        /\bfrom\s+['"]@rhinestone\/shared-configs['"]/.test(src),
      )
      .map(([path]) => path)

    expect(offenders).toEqual([])
  })
})
