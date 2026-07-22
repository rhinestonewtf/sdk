import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, test } from 'vitest'
import { toEvmChainReference } from '../chains/caip2'
import { accountMaterial, createStaticAccountRuntime } from './account-runtime'
import { resolveAccountConfig, resolveSdkConfig } from './resolve'

const owner = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const moduleAddress = `0x${'22'.repeat(20)}` as const
const fallbackAddress = `0x${'33'.repeat(20)}` as const

describe('account runtime', () => {
  test('preserves all explicitly resolved construction material', () => {
    const sdk = resolveSdkConfig({ apiKey: 'test' })
    const resolved = resolveAccountConfig(sdk, {
      account: { type: 'safe' },
      owners: { type: 'ecdsa', accounts: [owner] },
      modules: [{ type: 'executor', address: moduleAddress }],
      initData: { address: owner.address },
      experimental_sessions: {
        enabled: true,
        module: moduleAddress,
        compatibilityFallback: fallbackAddress,
      },
    })

    expect(accountMaterial(resolved)).toEqual({
      account: resolved.account,
      owner: resolved.owners,
      modules: resolved.modules,
      initData: resolved.initData,
      sessions: {
        enabled: true,
        environment: 'production',
        module: moduleAddress,
        compatibilityFallback: fallbackAddress,
      },
    })
  })

  test('omits absent optional construction material and default addresses', () => {
    const sdk = resolveSdkConfig({ apiKey: 'test' })
    const resolved = resolveAccountConfig(sdk, {
      account: { type: 'eoa' },
      eoa: owner,
    })

    expect(accountMaterial(resolved)).toEqual({
      account: resolved.account,
      eoa: owner,
      modules: [],
      sessions: {
        enabled: false,
        environment: 'production',
      },
    })
  })

  test('creates a chain-bound runtime from resolved configuration', () => {
    const sdk = resolveSdkConfig({ apiKey: 'test' })
    const resolved = resolveAccountConfig(sdk, {
      account: { type: 'eoa' },
      eoa: owner,
    })
    const chain = toEvmChainReference(1)

    const runtime = createStaticAccountRuntime(resolved, chain, true)

    expect(runtime.identity.address).toBe(owner.address)
    expect(runtime.construction.chain).toBe(chain)
    expect(runtime.construction.deployed).toBe(true)
    expect(runtime.adapter.account.kind).toBe('eoa')
  })
})
