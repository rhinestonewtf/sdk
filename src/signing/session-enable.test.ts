import { arbitrum, base, mainnet } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { toEvmChainReference } from '../chains/caip2'
import { K1_DEFAULT_VALIDATOR_ADDRESS } from '../modules/validators/k1'
import { OWNABLE_VALIDATOR_ADDRESS } from '../modules/validators/ownable'
import { resolveSessionEnableChain } from './session-enable'

const defaultChain = toEvmChainReference(mainnet.id)

describe('session enable chain resolution', () => {
  test('uses the default chain outside Startale K1', () => {
    for (const input of [
      {
        accountKind: 'nexus' as const,
        validator: K1_DEFAULT_VALIDATOR_ADDRESS,
      },
      {
        accountKind: 'startale' as const,
        validator: OWNABLE_VALIDATOR_ADDRESS,
      },
    ]) {
      expect(
        resolveSessionEnableChain({
          ...input,
          hashesAndChainIds: [{ chainId: BigInt(base.id) }],
          defaultChain,
        }),
      ).toBe(defaultChain)
    }
  })

  test('uses the single Startale K1 session chain', () => {
    expect(
      resolveSessionEnableChain({
        accountKind: 'startale',
        validator: K1_DEFAULT_VALIDATOR_ADDRESS,
        hashesAndChainIds: [{ chainId: BigInt(base.id) }],
        defaultChain,
      }),
    ).toMatchObject({ id: base.id })
  })

  test('rejects empty and multi-chain Startale K1 details', () => {
    const resolve = (chainIds: readonly bigint[]) =>
      resolveSessionEnableChain({
        accountKind: 'startale',
        validator: K1_DEFAULT_VALIDATOR_ADDRESS,
        hashesAndChainIds: chainIds.map((chainId) => ({ chainId })),
        defaultChain,
      })

    expect(() => resolve([])).toThrow(
      'Startale K1 session enable requires one session chain',
    )
    expect(() => resolve([BigInt(base.id), BigInt(arbitrum.id)])).toThrow(
      'Startale accounts with K1 validator do not support multi-chain session enable',
    )
  })
})
