import { concat, type Hex, zeroHash } from 'viem'
import { getSmartSessionEmissaryAddress } from './module'
import { encodeSmartSessionSignature } from './signature'
import type {
  ResolvedSessionSignerSet,
  Session,
  SessionEnableData,
  SmartSessionMockShape,
} from './types'

export function buildSmartSessionMockSignature(input: {
  readonly session: Session
  readonly environment: 'production' | 'development'
  readonly chainCount?: number
  readonly targetChainId?: number
  readonly shape?: SmartSessionMockShape
}): Hex {
  const shape = input.shape ?? 'enable'
  let enableData: SessionEnableData | undefined
  if (shape === 'enable') {
    const chainCount =
      Number.isFinite(input.chainCount) && (input.chainCount ?? 0) > 0
        ? Math.floor(input.chainCount as number)
        : 1
    const primaryChainId = input.targetChainId ?? input.session.chain.id
    enableData = {
      userSignature: `0x${'00'.repeat(65)}`,
      hashesAndChainIds: Array.from({ length: chainCount }, (_, index) => ({
        chainId: index === 0 ? BigInt(primaryChainId) : 0n,
        sessionDigest: zeroHash,
      })),
      sessionToEnableIndex: 0,
    }
  }
  const signers: ResolvedSessionSignerSet = {
    kind: 'smart-session',
    session: input.session,
    verifyExecutions: shape !== 'erc1271',
    ...(enableData ? { enableData } : {}),
  }
  return concat([
    getSmartSessionEmissaryAddress(input.environment),
    encodeSmartSessionSignature(signers, `0x${'00'.repeat(65)}` as Hex),
  ])
}
