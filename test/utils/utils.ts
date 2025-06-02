import { Chain } from 'viem'

import { base } from 'viem/chains'

function getForkUrl(chain: Chain) {
  const alchemyApiKey = import.meta.env.VITE_ALCHEMY_API_KEY
  if (!alchemyApiKey) {
    throw new Error('VITE_ALCHEMY_API_KEY is not set')
  }
  if (chain.id === base.id) {
    return `https://base-mainnet.g.alchemy.com/v2/${alchemyApiKey}`
  }
  throw new Error(`Unsupported chain: ${chain.id}`)
}

export { getForkUrl }
