import type { Address, Hex } from 'viem'
import * as viemChains from 'viem/chains'
import { arbitrumSepolia, baseSepolia } from 'viem/chains'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { accountA, accountB } from '../../test/consts'
import { fixturePasskey } from '../../test/parity/funded/fixtures'
import { RhinestoneSDK } from '../index'
import { type BlancRoute, quoteFromBlanc } from '../orchestrator/wire-quote'
import type { RhinestoneAccountConfig } from '../types'
import recorded from './__fixtures__/signing-vectors.json'
import { authorizationChainIds } from './utils'

// Signatures 1.22.0 produced over payloads recorded from the prod
// orchestrator, one vector per signer kind. The served blanc payloads were
// aligned with the alps quote's per-quote values, so both versions sign
// byte-identical typed data and every signature must be reproduced exactly
// from the blanc quote.

interface Vector {
  id: string
  transaction: {
    recipient: Address
    tokenRequests: { address: Address; amount: string }[]
    auxiliaryFunds: Record<string, Record<Address, string>>
    eip7702InitSignature?: Hex
  }
  alpsRequest: unknown
  alpsResponse: any
  blancRoutePatched: any
  expected: {
    originSignatures: unknown[]
    destinationSignature: Hex
    targetExecutionSignature?: Hex
    permitSignatures?: Record<string, Record<Address, Hex>>
    authorizations?: { chainId: number }[]
  }
}

// shared-configs loads viem's CommonJS build under vitest, so its chain objects
// are not the ones src compares against by identity (the RIP-7212 passkey flag).
// The published build loads a single viem; mirror that.
vi.mock('@rhinestone/shared-configs', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@rhinestone/shared-configs')>()
  // First export per id: viem also exports variants (e.g. `baseSepoliaPreconf`)
  // that share an id and sort after the canonical chain.
  const esmChains = Object.values(viemChains)
  return {
    ...actual,
    chains: actual.chains.map(
      (chain) => esmChains.find(({ id }) => id === chain.id) ?? chain,
    ),
  }
})

const VECTORS = (recorded as { vectors: Vector[] }).vectors

const ecdsaA = { type: 'ecdsa', accounts: [accountA] } as const
const QUORUM_MODULE: Address = '0x0000000000000000000000000000000000000001'

const CONFIGS: Record<string, () => Partial<RhinestoneAccountConfig>> = {
  'owner-ecdsa-nexus': () => ({ owners: ecdsaA }),
  'owner-ecdsa-safe': () => ({ account: { type: 'safe' }, owners: ecdsaA }),
  'owner-ecdsa-kernel': () => ({
    account: { type: 'kernel' },
    owners: ecdsaA,
  }),
  'owner-ecdsa-startale-k1': () => ({
    account: { type: 'startale' },
    owners: ecdsaA,
  }),
  'owner-multi-ecdsa-2of2': () => ({
    owners: { type: 'ecdsa', accounts: [accountA, accountB], threshold: 2 },
  }),
  'owner-passkey-software': () => ({
    owners: { type: 'passkey', accounts: [fixturePasskey()] },
  }),
  'owner-multi-factor-ecdsa-passkey': () => ({
    owners: {
      type: 'multi-factor',
      validators: [ecdsaA, { type: 'passkey', accounts: [fixturePasskey()] }],
      threshold: 2,
    },
  }),
  'owner-quorum-2of2': () => ({
    owners: {
      type: 'quorum',
      owners: [
        { account: accountA, weight: 1n },
        { account: accountB, weight: 1n },
      ],
      thresholdWeight: 2n,
      module: QUORUM_MODULE,
    },
  }),
  eoa: () => ({ account: { type: 'eoa' }, eoa: accountA }),
  eip7702: () => ({ eoa: accountA, owners: ecdsaA }),
}

function toTransaction(vector: Vector) {
  const { transaction } = vector
  return {
    ...transaction,
    sourceChains: [baseSepolia],
    targetChain: arbitrumSepolia,
    tokenRequests: transaction.tokenRequests.map((request) => ({
      ...request,
      amount: BigInt(request.amount),
    })),
    auxiliaryFunds: Object.fromEntries(
      Object.entries(transaction.auxiliaryFunds).map(([chainId, tokens]) => [
        chainId,
        Object.fromEntries(
          Object.entries(tokens).map(([token, amount]) => [
            token,
            BigInt(amount),
          ]),
        ),
      ]),
    ),
  }
}

function plain(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map(plain)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, plain(entry)]),
    )
  }
  return value
}

// Only the two reads EIP-7702 authorization signing makes are answered: the
// account has no code yet and its nonce is 0, as when the vector was recorded.
const RPC_RESULTS: Record<string, string> = {
  eth_getCode: '0x',
  eth_getTransactionCount: '0x0',
}

beforeEach(() => {
  vi.stubGlobal('fetch', async (input: unknown, init?: { body?: string }) => {
    const { id, method } = JSON.parse(init?.body ?? '{}')
    if (!(method in RPC_RESULTS)) {
      throw new Error(`network blocked: ${String(input)}`)
    }
    return new Response(
      JSON.stringify({ jsonrpc: '2.0', id, result: RPC_RESULTS[method] }),
      { headers: { 'content-type': 'application/json' } },
    )
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('signing vectors', () => {
  test('cover every signer kind', () => {
    expect(VECTORS.map((vector) => vector.id).sort()).toEqual(
      Object.keys(CONFIGS).sort(),
    )
  })

  test.each(VECTORS.map((vector) => [vector.id, vector] as const))(
    '%s signs as 1.22.0 did',
    async (id, vector) => {
      const sdk = new RhinestoneSDK({ apiKey: 'offline' })
      const account = await sdk.createAccount(
        CONFIGS[id]() as RhinestoneAccountConfig,
      )
      const signed = await account.signTransaction({
        quote: quoteFromBlanc(vector.blancRoutePatched as BlancRoute),
        intentInput: vector.alpsRequest,
        transaction: toTransaction(vector),
      })
      expect(
        plain({
          originSignatures: signed.originSignatures,
          destinationSignature: signed.destinationSignature,
          targetExecutionSignature: signed.targetExecutionSignature,
          permitSignatures: signed.permitSignatures,
        }),
      ).toEqual(plain({ ...vector.expected, authorizations: undefined }))
    },
  )

  test('eip7702 authorizes the chains 1.22.0 did', async () => {
    const vector = VECTORS.find(({ id }) => id === 'eip7702')!
    const quote = quoteFromBlanc(vector.blancRoutePatched as BlancRoute)
    const transaction = toTransaction(vector)
    const expected = vector.expected.authorizations!
    expect(authorizationChainIds(quote, transaction)).toEqual(
      expected.map(({ chainId }) => chainId),
    )
    const sdk = new RhinestoneSDK({ apiKey: 'offline' })
    const account = await sdk.createAccount(
      CONFIGS.eip7702() as RhinestoneAccountConfig,
    )
    const authorizations = await account.signAuthorizations({
      quote,
      intentInput: vector.alpsRequest,
      transaction,
    })
    expect(plain(authorizations)).toEqual(plain(expected))
  })
})
