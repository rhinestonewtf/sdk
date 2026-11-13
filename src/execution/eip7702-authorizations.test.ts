import type { Address, Hex } from 'viem'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { accountA } from '../../test/consts'
import { RhinestoneSDK } from '../index'
import { getChainById } from '../orchestrator/registry'
import type { SettlementLayer } from '../orchestrator/types'
import recorded from './__fixtures__/eip7702-authorizations.json'
import vectors from './__fixtures__/signing-vectors.json'

// Quotes recorded from the prod orchestrator for the same request on both API
// versions: alps reported the chains it requires an EIP-7702 authorization on,
// blanc served the route v1 now signs. Driving prepare and sign over the blanc
// response must authorize exactly the chains, and the contract, alps required.

interface Case {
  id: string
  alpsRequest: {
    destinationChainId: number
    tokenRequests: { tokenAddress: Address; amount: string }[]
    accountAccessList: { chainIds: number[] }
    recipient?: { address: Address }
    options: {
      auxiliaryFunds?: Record<string, Record<Address, string>>
      settlementLayers?: SettlementLayer[]
    }
  }
  alpsRequiredDelegations: Record<string, { contract: Address }>
  blancRequest: unknown
  blancBody: unknown
}

const CASES = (recorded as unknown as { cases: Case[] }).cases

// The init signature only depends on the account, so the one recorded with the
// eip7702 signing vector (same EOA) applies to every case.
const eip7702InitSignature = (
  vectors as unknown as {
    vectors: { id: string; transaction: { eip7702InitSignature?: Hex } }[]
  }
).vectors.find(({ id }) => id === 'eip7702')!.transaction.eip7702InitSignature!

let quoteRequests: unknown[]

function stubNetwork(blancBody: unknown) {
  quoteRequests = []
  vi.stubGlobal('fetch', async (input: unknown, init?: { body?: string }) => {
    const url = String(input)
    const body = JSON.parse(init?.body ?? '{}')
    if (url.endsWith('/quotes')) {
      quoteRequests.push(body)
      return Response.json(blancBody)
    }
    // Only the reads authorization signing makes: no delegation yet, nonce 0.
    const results: Record<string, string> = {
      eth_getCode: '0x',
      eth_getTransactionCount: '0x0',
    }
    if (!(body.method in results)) {
      throw new Error(`network blocked: ${url}`)
    }
    return Response.json({
      jsonrpc: '2.0',
      id: body.id,
      result: results[body.method],
    })
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('EIP-7702 authorizations on recorded quotes', () => {
  beforeEach(() => {
    quoteRequests = []
  })

  test('cover a cross-chain transfer into the account and to a recipient', () => {
    const requiresTarget = CASES.filter(
      ({ alpsRequest, alpsRequiredDelegations }) =>
        String(alpsRequest.destinationChainId) in alpsRequiredDelegations,
    )
    expect(requiresTarget.map(({ id }) => id)).toEqual([
      'unfunded/eip7702',
      'op/eip7702',
    ])
    expect(CASES.some(({ alpsRequest }) => alpsRequest.recipient)).toBe(true)
  })

  test.each(CASES.map((c) => [c.id, c] as const))(
    '%s authorizes what alps required',
    async (_, recordedCase) => {
      stubNetwork(recordedCase.blancBody)
      const { alpsRequest } = recordedCase
      const sdk = new RhinestoneSDK({ apiKey: 'offline' })
      const account = await sdk.createAccount({
        eoa: accountA,
        owners: { type: 'ecdsa', accounts: [accountA] },
      })
      const prepared = await account.prepareTransaction({
        sourceChains: alpsRequest.accountAccessList.chainIds.map(getChainById),
        targetChain: getChainById(alpsRequest.destinationChainId),
        recipient: alpsRequest.recipient?.address,
        tokenRequests: alpsRequest.tokenRequests.map(
          ({ tokenAddress, amount }) => ({
            address: tokenAddress,
            amount: BigInt(amount),
          }),
        ),
        auxiliaryFunds: Object.fromEntries(
          Object.entries(alpsRequest.options.auxiliaryFunds ?? {}).map(
            ([chainId, tokens]) => [
              chainId,
              Object.fromEntries(
                Object.entries(tokens).map(([token, amount]) => [
                  token,
                  BigInt(amount),
                ]),
              ),
            ],
          ),
        ),
        settlementLayers: alpsRequest.options.settlementLayers,
        eip7702InitSignature,
      })
      expect(quoteRequests).toEqual([recordedCase.blancRequest])

      const authorizations = await account.signAuthorizations(prepared)
      const required = Object.entries(recordedCase.alpsRequiredDelegations)
        .map(([chainId, { contract }]) => ({
          chainId: Number(chainId),
          address: contract.toLowerCase(),
        }))
        .sort((a, b) => a.chainId - b.chainId)
      expect(
        authorizations.map(({ chainId, address }) => ({
          chainId,
          address: address.toLowerCase(),
        })),
      ).toEqual(required)
      expect(authorizations.every(({ nonce }) => nonce === 0)).toBe(true)
    },
  )
})
