import { describe, expect, test } from 'vitest'
import { loadConfig } from './config'
import { providerOverride, rpcUrl } from './funded/chain'

describe('config', () => {
  test('funded scenarios are on by default and opt out with PARITY_FUNDED=0', () => {
    expect(loadConfig({ PARITY_API_KEY: 'k' })).toMatchObject({
      funded: true,
      settleTimeoutMs: 600_000,
    })
    expect(loadConfig({ PARITY_API_KEY: 'k', PARITY_FUNDED: '0' }).funded).toBe(
      false,
    )
  })

  test('PARITY_SETTLE_TIMEOUT_MS must be a positive integer', () => {
    expect(
      loadConfig({ PARITY_API_KEY: 'k', PARITY_SETTLE_TIMEOUT_MS: '900000' })
        .settleTimeoutMs,
    ).toBe(900_000)
    expect(() =>
      loadConfig({ PARITY_API_KEY: 'k', PARITY_SETTLE_TIMEOUT_MS: 'soon' }),
    ).toThrow(/PARITY_SETTLE_TIMEOUT_MS/)
  })

  test('PARITY_RPC_URL_<chainId> overrides RPCs for the harness and both builds', () => {
    const env = { PARITY_RPC_URL_84532: 'https://base.example' }
    expect(rpcUrl(84532, env)).toBe('https://base.example')
    expect(rpcUrl(11155420, env)).toBeUndefined()
    expect(providerOverride(env)).toEqual({
      type: 'custom',
      urls: { 84532: 'https://base.example' },
    })
    expect(providerOverride({})).toBeUndefined()
  })
})
