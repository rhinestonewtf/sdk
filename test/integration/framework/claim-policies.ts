import type { RhinestoneAccount, Session } from '../../../src/index'
import { toSession } from '../../../src/smart-sessions/index'
import { sourceChain, targetChain } from '../config/chains'
import { getTokenAddress } from './tokens'

export async function crossChainSessionIntent(
  account: Pick<RhinestoneAccount, 'getSessionDetails' | 'signEnableSession'>,
  session: Session,
): Promise<Parameters<RhinestoneAccount['prepareTransaction']>[0]> {
  // Destination authorization is independent of the source Permit2 claim policy.
  const destinationSession = toSession({
    chain: targetChain,
    owners: session.owners,
  })
  const sessionDetails = await account.getSessionDetails([
    session,
    destinationSession,
  ])
  const userSignature = await account.signEnableSession(sessionDetails)

  return {
    source: {
      chain: sourceChain,
      token: getTokenAddress('USDC', sourceChain.id),
      maxAmount: 100_000n,
    },
    // A real token delivery forces a source-chain Permit2 claim; empty calls
    // alone could settle without ever consulting the recipient policy.
    destination: {
      chain: targetChain,
      token: getTokenAddress('USDC', targetChain.id),
      amount: 10_000n,
      calls: [],
    },
    sponsored: true,
    settlementLayers: { include: ['ACROSS'] },
    signers: {
      type: 'session',
      sessions: {
        [sourceChain.id]: {
          session,
          enableData: {
            userSignature,
            hashesAndChainIds: sessionDetails.hashesAndChainIds,
            sessionToEnableIndex: 0,
          },
        },
        [targetChain.id]: {
          session: destinationSession,
          enableData: {
            userSignature,
            hashesAndChainIds: sessionDetails.hashesAndChainIds,
            sessionToEnableIndex: 1,
          },
        },
      },
    },
  }
}
