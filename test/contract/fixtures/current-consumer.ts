import type { BridgeFill } from '@rhinestone/sdk'
import type { Hex } from 'viem'
import { mainnet } from 'viem/chains'

function readEcoIntentHash(bridgeFill: BridgeFill): Hex | undefined {
  if (bridgeFill.type !== 'ECO') return undefined
  return bridgeFill.intentHash
}

const ecoBridgeFill = {
  type: 'ECO',
  destinationChainId: mainnet.id,
  intentHash: `0x${'11'.repeat(32)}`,
} as const satisfies BridgeFill
const ecoIntentHash: Hex | undefined = readEcoIntentHash(ecoBridgeFill)

void ecoIntentHash
