import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { acquireFundedLock } from './lock'

const dir = mkdtempSync(join(tmpdir(), 'parity-lock-'))
const file = join(dir, 'funded.lock')

afterEach(() => rmSync(file, { force: true }))

describe('funded lock', () => {
  test('is taken, refused to another live process and released', () => {
    const release = acquireFundedLock(file)
    expect(existsSync(file)).toBe(true)
    // The parent process is alive and is not this one.
    expect(() => acquireFundedLock(file, process.ppid)).toThrow(
      /Another funded parity run/,
    )
    release()
    expect(existsSync(file)).toBe(false)
  })

  test('replaces a lock left by a dead process', () => {
    writeFileSync(
      file,
      JSON.stringify({ pid: 2 ** 22 + 12345, startedAt: 'earlier' }),
    )
    const release = acquireFundedLock(file)
    release()
    expect(existsSync(file)).toBe(false)
  })
})
