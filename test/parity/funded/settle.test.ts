import { describe, expect, test } from 'vitest'
import { settle } from './settle'

function clock() {
  let now = 0
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms
    },
  }
}

describe('settle', () => {
  test('polls each intent until a terminal status', async () => {
    const seen: Record<string, string[]> = {
      a: ['PENDING', 'FILLED', 'COMPLETED'],
      b: ['PENDING', 'FAILED'],
      c: ['EXPIRED'],
    }
    const time = clock()
    const outcomes = await settle(['a', 'b', 'c'], {
      status: async (id) => seen[id].shift() ?? 'PENDING',
      timeoutMs: 60_000,
      intervalMs: 3000,
      ...time,
    })
    expect(outcomes).toEqual([
      { intentId: 'a', status: 'COMPLETED', settled: true, elapsedMs: 6000 },
      { intentId: 'b', status: 'FAILED', settled: true, elapsedMs: 3000 },
      { intentId: 'c', status: 'EXPIRED', settled: true, elapsedMs: 0 },
    ])
  })

  test('reports the last status when the timeout hits, retrying read errors', async () => {
    let calls = 0
    const outcomes = await settle(['a'], {
      async status() {
        calls += 1
        if (calls === 2) throw new Error('rpc')
        return 'FILLED'
      },
      timeoutMs: 9000,
      intervalMs: 3000,
      ...clock(),
    })
    expect(outcomes).toEqual([
      { intentId: 'a', status: 'FILLED', settled: false, elapsedMs: 9000 },
    ])
    expect(calls).toBe(4)
  })
})
