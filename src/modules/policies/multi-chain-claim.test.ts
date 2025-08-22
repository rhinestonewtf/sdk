import { describe, expect, it } from 'vitest'
import {
  encodeMultiChainClaimPolicy,
  type MultiChainClaimPolicyConfig,
} from './multi-chain-claim'

describe('encodeMultiChainClaimPolicy', () => {
  it('encodes conditions bitmap only', () => {
    const cfg: MultiChainClaimPolicyConfig = { hasExecutions: true }
    const data = encodeMultiChainClaimPolicy(cfg)
    // conditions bitmap = 1
    expect(data.startsWith('0x01')).toBe(true)
  })

  it('encodes tokenIn array', () => {
    const cfg: MultiChainClaimPolicyConfig = {
      tokenIn: [
        {
          chainId: 1n,
          token: '0x0000000000000000000000000000000000000000',
          minAmount: 1n,
          maxAmount: 100n,
        },
      ],
    }
    const data = encodeMultiChainClaimPolicy(cfg)
    // conditions bitmap should have bit 3 set -> 8 decimal -> 0x08
    expect(data.startsWith('0x08')).toBe(true)
  })

  it('encodes tokenOut array', () => {
    const cfg: MultiChainClaimPolicyConfig = {
      tokenOut: [
        {
          targetChainId: 8453n,
          token: '0x0000000000000000000000000000000000000000',
          minAmount: 1n,
          maxAmount: 100n,
        },
      ],
    }
    const data = encodeMultiChainClaimPolicy(cfg)
    // conditions bitmap should have bit 4 set -> 16 decimal -> 0x10
    expect(data.startsWith('0x10')).toBe(true)
  })

  it('encodes qualification with typeString and rules', () => {
    const cfg: MultiChainClaimPolicyConfig = {
      qualification: {
        typeString: 'TestQualification(uint256 value)',
        paramRules: {
          rootNodeIndex: 0n,
          rules: [
            {
              condition: 'equal',
              offset: 0n,
              length: 0n,
              ref: '0x0000000000000000000000000000000000000000000000000000000000000012',
            },
          ],
          packedNodes: [0n],
        },
      },
    }
    const data = encodeMultiChainClaimPolicy(cfg)
    // conditions bitmap should have bit 1 set -> 0x02
    expect(data.startsWith('0x02')).toBe(true)
    expect(data.length).toBeGreaterThan(2 + 64) // contains typehash+rules
  })
})


