import { describe, expect, test } from 'vitest'
import { UnsupportedChainError, UnsupportedTokenError } from './errors'

describe('chain errors', () => {
  test('UnsupportedChainError carries the chain id', () => {
    const error = new UnsupportedChainError(8453)
    expect(error).toBeInstanceOf(Error)
    expect(error.chainId).toBe(8453)
    expect(error.message).toBe('Unsupported chain 8453')
  })

  test('UnsupportedTokenError carries the token symbol and chain id', () => {
    const error = new UnsupportedTokenError('WETH', 8453)
    expect(error).toBeInstanceOf(Error)
    expect(error.tokenSymbol).toBe('WETH')
    expect(error.chainId).toBe(8453)
    expect(error.message).toBe('Unsupported token WETH for chain 8453')
  })
})
