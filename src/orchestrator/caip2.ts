type Caip2ChainId = `eip155:${number}`

const EIP155_CAIP2_REGEX = /^eip155:\d+$/

function toCaip2(chainId: number): Caip2ChainId {
  if (!Number.isInteger(chainId) || chainId < 0) {
    throw new Error(`Invalid EVM chain id: ${chainId}`)
  }
  return `eip155:${chainId}`
}

function fromCaip2(chainId: string): number {
  if (!EIP155_CAIP2_REGEX.test(chainId)) {
    throw new Error(`Invalid CAIP-2 chain id: ${chainId}`)
  }
  return Number(chainId.slice('eip155:'.length))
}

function isCaip2(chainId: string): chainId is Caip2ChainId {
  return EIP155_CAIP2_REGEX.test(chainId)
}

export type { Caip2ChainId }
export { fromCaip2, isCaip2, toCaip2 }
