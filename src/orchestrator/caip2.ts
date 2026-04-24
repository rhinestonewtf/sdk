const EIP155_CAIP2_REGEX = /^eip155:\d+$/

/**
 * Converts a numeric EVM chain id to the BLANC wire-format CAIP-2 string.
 */
function toCaip2(chainId: number): `eip155:${number}` {
  if (!Number.isInteger(chainId) || chainId < 0) {
    throw new Error(`Invalid EVM chain id: ${chainId}`)
  }

  return `eip155:${chainId}`
}

/**
 * Parses a BLANC CAIP-2 chain id back to its numeric EVM chain id.
 */
function fromCaip2(chainId: string): number {
  if (!EIP155_CAIP2_REGEX.test(chainId)) {
    throw new Error(`Invalid CAIP-2 chain id: ${chainId}`)
  }

  return Number(chainId.slice('eip155:'.length))
}

/**
 * Narrows arbitrary strings to the only CAIP-2 namespace the orchestrator accepts.
 */
function isCaip2(chainId: string): chainId is `eip155:${number}` {
  return EIP155_CAIP2_REGEX.test(chainId)
}

export { EIP155_CAIP2_REGEX, fromCaip2, isCaip2, toCaip2 }
