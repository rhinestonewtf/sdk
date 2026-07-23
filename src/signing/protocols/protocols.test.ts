import { type Hex, hashTypedData } from 'viem'
import { describe, expect, test } from 'vitest'
import {
  isErc6492Signature,
  unwrapErc6492Signature,
  wrapErc6492Signature,
} from './erc6492'
import { hashErc7739TypedData, wrapErc7739TypedDataSignature } from './erc7739'

const factory = '0x1111111111111111111111111111111111111111'
const account = '0x2222222222222222222222222222222222222222'

describe('signing protocol operations', () => {
  test('wraps, detects, and unwraps ERC-6492 exactly', () => {
    const wrapped = wrapErc6492Signature({
      factory,
      factoryData: '0x1234',
      signature: '0xabcd',
    })
    expect(isErc6492Signature(wrapped)).toBe(true)
    expect(unwrapErc6492Signature(wrapped)).toEqual({
      factory,
      factoryData: '0x1234',
      signature: '0xabcd',
    })
    expect(isErc6492Signature('0x1234')).toBe(false)
    expect(() => unwrapErc6492Signature('0x1234')).toThrow('not ERC-6492')
  })

  test('matches the calibrated Solady ERC-7739 digest vector', () => {
    const typedData = {
      domain: {
        name: 'TestApp',
        version: '1',
        chainId: 421614,
        verifyingContract: '0x1234567890abcdef1234567890abcdef12345678',
      },
      types: {
        Greeting: [
          { name: 'text', type: 'string' },
          { name: 'value', type: 'uint256' },
        ],
      },
      primaryType: 'Greeting',
      message: { text: 'Hello', value: 42n },
    } as const
    expect(
      hashErc7739TypedData({
        typedData,
        verifierDomain: {
          name: 'Startale',
          version: '1.0.0',
          chainId: 421614,
          verifyingContract: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
          salt: `0x${'00'.repeat(32)}` as Hex,
        },
      }),
    ).toBe('0xacd2d65e9986501bb617b90505f4b527ee4eac3c29ac4fea21bb74d8e754e61b')
    const wrapped = wrapErc7739TypedDataSignature({
      typedData,
      signature: `0x${'11'.repeat(65)}`,
    })
    expect(wrapped).not.toBe(`0x${'11'.repeat(65)}`)
    expect(hashTypedData(typedData)).toHaveLength(66)
  })

  test('requires complete ERC-7739 typed data', () => {
    expect(() =>
      hashErc7739TypedData({
        typedData: { domain: {}, types: {}, message: {} } as never,
        verifierDomain: {
          name: 'Test',
          version: '1',
          chainId: 1,
          verifyingContract: account,
          salt: `0x${'00'.repeat(32)}`,
        },
      }),
    ).toThrow('complete')
  })
})
