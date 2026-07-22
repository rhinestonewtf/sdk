import type { ChainEntry } from '@rhinestone/shared-configs'
import { type Chain, zeroAddress } from 'viem'
import { arbitrum, avalanche, base, sepolia } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import {
  getChainReference,
  getSupportedChain,
  isTestnet,
  sharedChainCatalog,
} from './catalog'
import {
  getTokenAddress,
  getTokenSymbol,
  getWrappedNativeTokenAddress,
  normalizeTokenAddress,
} from './tokens'

describe('shared chain catalog', () => {
  const accountAddress = '0x0000000000000000000000000000000000000001'
  test('looks up supported chains and environments', () => {
    expect(getSupportedChain(sharedChainCatalog, arbitrum.id).id).toBe(
      arbitrum.id,
    )
    expect(isTestnet(sharedChainCatalog, sepolia.id)).toBe(true)
    expect(isTestnet(sharedChainCatalog, base.id)).toBe(false)
    expect(getSupportedChain(sharedChainCatalog, avalanche.id).id).toBe(
      avalanche.id,
    )
    expect(() => getSupportedChain(sharedChainCatalog, 81457)).toThrow(
      'Unsupported chain 81457',
    )
  })

  test('materializes canonical references', () => {
    expect(getChainReference(sharedChainCatalog, base.id)).toEqual({
      kind: 'evm',
      id: base.id,
      caip2: `eip155:${base.id}`,
    })
    const nonEvmCatalog = {
      getChain: () => base,
      getEntry: () => undefined,
      getSupportedChainIds: () => [792703809],
    }
    expect(getChainReference(nonEvmCatalog, 792703809)).toMatchObject({
      kind: 'non-evm',
      namespace: 'solana',
    })
    expect(sharedChainCatalog.getSupportedChainIds()).toContain(base.id)
    expect(sharedChainCatalog.getEntry(base.id)).toBeDefined()
  })

  test('resolves tokens without ambient config', () => {
    const usdc = getTokenAddress(sharedChainCatalog, 'USDC', arbitrum.id)
    expect(getTokenSymbol(sharedChainCatalog, usdc, arbitrum.id)).toBe('USDC')
    expect(getWrappedNativeTokenAddress(sharedChainCatalog, base.id)).toBe(
      '0x4200000000000000000000000000000000000006',
    )
    expect(
      normalizeTokenAddress(sharedChainCatalog, usdc, arbitrum.id, false),
    ).toBe(usdc)
    expect(
      normalizeTokenAddress(sharedChainCatalog, 'mint', 792703809, true),
    ).toBe('mint')

    const token = '0x0000000000000000000000000000000000000002'
    const catalog = {
      getChain: () => base as Chain,
      getSupportedChainIds: () => [base.id],
      getEntry: () =>
        ({
          tokens: [
            { symbol: 'USDC', address: token },
            { symbol: 'WETH', address: accountAddress },
          ],
        }) as ChainEntry,
    }
    expect(getTokenAddress(catalog, 'USDC', base.id)).toBe(token)
    expect(getTokenSymbol(catalog, accountAddress, base.id)).toBe('WETH')
    expect(getTokenSymbol(catalog, zeroAddress, base.id)).toBeUndefined()
    expect(getWrappedNativeTokenAddress(catalog, base.id)).toBe(accountAddress)
    expect(normalizeTokenAddress(catalog, 'USDC', base.id, false)).toBe(token)
    expect(() => getTokenAddress(catalog, 'USDT', base.id)).toThrow(
      'Unsupported token',
    )

    const empty = { ...catalog, getEntry: () => undefined }
    expect(() => getTokenAddress(empty, 'USDC', base.id)).toThrow(
      'Unsupported chain',
    )
    const noWrapped = {
      ...catalog,
      getEntry: () => ({ tokens: [] }) as unknown as ChainEntry,
    }
    expect(() => getWrappedNativeTokenAddress(noWrapped, base.id)).toThrow(
      'Unsupported token WETH',
    )
  })
})
