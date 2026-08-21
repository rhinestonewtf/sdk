import { vi } from 'vitest'

// The test runtime pins the default collator to en-US regardless of the
// environment locale, so locale-sensitive ordering cannot be caught by running
// under a Danish-family locale. Make any collation lookup throw instead.
function withoutHostCollation<T>(run: () => T): T {
  const spy = vi
    .spyOn(String.prototype, 'localeCompare')
    .mockImplementation(() => {
      throw new Error('host collation must not be consulted')
    })
  try {
    return run()
  } finally {
    spy.mockRestore()
  }
}

export { withoutHostCollation }
