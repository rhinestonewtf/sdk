import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, test, vi } from 'vitest'
import type { Session } from '../../../src/index'
import { getSessionDetails } from '../../../src/modules/validators/smart-sessions/authorization'
import {
  type SessionDetails,
  toSession,
} from '../../../src/smart-sessions/index'
import { sourceChain, targetChain } from '../config/chains'
import { crossChainSessionIntent } from './claim-policies'
import { getTokenAddress } from './tokens'

const owner = privateKeyToAccount(
  '0x0000000000000000000000000000000000000000000000000000000000000001',
)
const accountAddress = '0x1111111111111111111111111111111111111111'
const unrelated = '0x4444444444444444444444444444444444444444'
const owners = { type: 'ecdsa' as const, accounts: [owner] }

describe('claim-policy cross-chain fixture', () => {
  test.each(['default', 'explicit', 'mismatch', 'unrestricted'] as const)(
    'enables independent chain grants without changing the %s source policy',
    async (variant) => {
      const createSourceSession = () =>
        toSession({
          chain: sourceChain,
          account: accountAddress,
          owners,
          ...(variant === 'unrestricted'
            ? {}
            : {
                crossChainPermits: [
                  {
                    from: {
                      chain: sourceChain,
                      token: getTokenAddress('USDC', sourceChain.id),
                      maxAmount: 100_000n,
                    },
                    to: {
                      chain: targetChain,
                      token: getTokenAddress('USDC', targetChain.id),
                      ...(variant === 'explicit'
                        ? { recipient: accountAddress }
                        : variant === 'mismatch'
                          ? { recipient: unrelated }
                          : {}),
                    },
                    settlementLayers: ['ACROSS' as const],
                    ...(variant === 'mismatch'
                      ? { allowRecipientNotAccount: true }
                      : {}),
                  },
                ],
              }),
        })
      const sourceSession = createSourceSession()
      const account = {
        getSessionDetails: vi.fn((sessions: Session[]) =>
          getSessionDetails({
            account: accountAddress,
            sessions,
            environment: 'development',
            readNonce: async (session) =>
              session.chain.id === sourceChain.id ? 7n : 11n,
            readNonceAndEnabled: async () => ({ nonce: 7n, enabled: false }),
          }),
        ),
        signEnableSession: vi.fn((details: SessionDetails) =>
          owner.signTypedData(details.data),
        ),
      }

      const transaction = await crossChainSessionIntent(account, sourceSession)
      const signers = transaction.signers
      if (signers?.type !== 'session' || !('sessions' in signers)) {
        throw new Error('Expected explicit per-chain session grants')
      }
      const source = signers.sessions[sourceChain.id]
      const destination = signers.sessions[targetChain.id]
      expect(Object.keys(signers.sessions)).toHaveLength(2)
      expect(source.session).toBe(sourceSession)
      expect(source.session.chain).toBe(sourceChain)
      expect(source.session).toEqual(createSourceSession())
      expect(source.session.claimPolicies.length > 0).toBe(
        variant !== 'unrestricted',
      )
      expect(destination.session).not.toBe(sourceSession)
      expect(destination.session).toEqual(
        toSession({ chain: targetChain, owners }),
      )
      expect(destination.session.claimPolicies).toEqual([])
      expect(account.getSessionDetails).toHaveBeenCalledExactlyOnceWith([
        sourceSession,
        destination.session,
      ])
      const details: SessionDetails =
        await account.getSessionDetails.mock.results[0].value
      expect(details.nonces).toEqual([7n, 11n])
      expect(details.hashesAndChainIds.map(({ chainId }) => chainId)).toEqual([
        BigInt(sourceChain.id),
        BigInt(targetChain.id),
      ])
      expect(account.signEnableSession).toHaveBeenCalledExactlyOnceWith(details)
      const signature = await account.signEnableSession.mock.results[0].value
      for (const [index, grant] of [source, destination].entries()) {
        expect(grant.enableData).toEqual({
          userSignature: signature,
          hashesAndChainIds: details.hashesAndChainIds,
          sessionToEnableIndex: index,
        })
        expect(details.hashesAndChainIds[index].chainId).toBe(
          BigInt(grant.session.chain.id),
        )
      }
      expect(transaction).toMatchObject({
        source: {
          chain: sourceChain,
          token: getTokenAddress('USDC', sourceChain.id),
          maxAmount: 100_000n,
        },
        destination: {
          chain: targetChain,
          token: getTokenAddress('USDC', targetChain.id),
          amount: 10_000n,
          calls: [],
        },
        sponsored: true,
        settlementLayers: { include: ['ACROSS'] },
      })
    },
  )
})
