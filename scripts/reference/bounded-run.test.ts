import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { acquireHostLock, parseMemoryBudget, runBounded } from './bounded-run'

// Unique per run so concurrent test processes never see each other's hogs.
const hog = `const a=[];setInterval(()=>a.push(Buffer.alloc(32*2**20,1)),20)//${randomUUID()}`

function hogsAlive(): boolean {
  const rows = spawnSync('ps', ['-A', '-o', 'args='], { encoding: 'utf8' })
  return rows.stdout.split('\n').some((row) => row.includes(hog))
}

async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', ''])
  await new Promise((done) => child.on('exit', done))
  return child.pid as number
}

describe('parseMemoryBudget', () => {
  it('defaults and accepts positive integers', () => {
    expect(parseMemoryBudget(undefined)).toBe(2048)
    expect(parseMemoryBudget('512')).toBe(512)
  })

  it.each(['0', '-1', 'abc', '1.5'])('rejects %s', (value) => {
    expect(() => parseMemoryBudget(value)).toThrow('positive integer')
  })
})

describe('runBounded', () => {
  const options = { cwd: process.cwd(), maxRssMiB: 1024 }

  it('returns telemetry on success', async () => {
    const result = await runBounded(process.execPath, ['-e', ''], {
      ...options,
      label: 'ok',
    })
    expect(result.peakRssMiB).toBeGreaterThanOrEqual(0)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('rejects a non-zero exit', async () => {
    await expect(
      runBounded(process.execPath, ['-e', 'process.exit(3)'], {
        ...options,
        label: 'exit',
      }),
    ).rejects.toThrow('exit 3')
  })

  it.each([
    ['direct child', process.execPath, ['-e', hog]],
    ['grandchild', 'sh', ['-c', `"${process.execPath}" -e '${hog}'; true`]],
  ])(
    'kills a %s over budget with its whole group',
    async (_, command, args) => {
      await expect(
        runBounded(command, args, {
          ...options,
          label: 'hog',
          maxRssMiB: 96,
          sampleMs: 50,
        }),
      ).rejects.toThrow(
        /hog exceeded the 96 MiB memory budget \(peak \d+ MiB\)/,
      )
      expect(hogsAlive()).toBe(false)
    },
    20_000,
  )
})

describe('acquireHostLock', () => {
  const lockPath = () =>
    join(mkdtempSync(join(tmpdir(), 'reference-lock-')), 'lock')
  const quiet = { pollMs: 20, log: () => {} }

  it('acquires, blocks contenders until timeout, and releases', async () => {
    const path = lockPath()
    const release = await acquireHostLock({ path, ...quiet })
    expect(JSON.parse(readFileSync(path, 'utf8')).pid).toBe(process.pid)
    await expect(
      acquireHostLock({ path, timeoutMs: 200, ...quiet }),
    ).rejects.toThrow(/^incomplete: another test:reference run \(pid \d+/)
    release()
    expect(existsSync(path)).toBe(false)
    const again = await acquireHostLock({ path, ...quiet })
    again()
  })

  it('reclaims dead-owner and garbage locks', async () => {
    const path = lockPath()
    writeFileSync(path, JSON.stringify({ pid: await deadPid(), cwd: '/x' }))
    ;(await acquireHostLock({ path, timeoutMs: 200, ...quiet }))()
    writeFileSync(path, 'not json')
    ;(await acquireHostLock({ path, timeoutMs: 200, ...quiet }))()
  })

  it('releases idempotently and never deletes a lock it no longer owns', async () => {
    const path = lockPath()
    const release = await acquireHostLock({ path, ...quiet })
    const foreign = JSON.stringify({ pid: process.pid + 1, cwd: '/other' })
    writeFileSync(path, foreign)
    release()
    release()
    expect(readFileSync(path, 'utf8')).toBe(foreign)
  })
})
