import type { Chain } from 'viem'
import { base } from 'viem/chains'
import { expect } from 'vitest'

function getForkUrl(chain: Chain) {
  // @ts-ignore
  const alchemyApiKey = import.meta.env.VITE_ALCHEMY_API_KEY
  if (!alchemyApiKey) {
    throw new Error('VITE_ALCHEMY_API_KEY is not set')
  }
  if (chain.id === base.id) {
    return `https://base-mainnet.g.alchemy.com/v2/${alchemyApiKey}`
  }
  throw new Error(`Unsupported chain: ${chain.id}`)
}

function assertNotNull<T>(value: T | null): asserts value is T {
  expect(value).not.toBeNull()
}

export { getForkUrl, assertNotNull }
