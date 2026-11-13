import {
  type Address,
  concat,
  encodeAbiParameters,
  type Hex,
  hashTypedData,
  keccak256,
  recoverTypedDataAddress,
  size,
  slice,
  stringToHex,
  zeroAddress,
} from 'viem'
import * as viemChains from 'viem/chains'
import { arbitrumSepolia, baseSepolia } from 'viem/chains'
import { hashStruct } from 'viem/utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { accountA } from '../../test/consts'
import { fixturePasskey } from '../../test/parity/funded/fixtures'
import { RhinestoneSDK } from '../index'
import recorded from '../orchestrator/__fixtures__/quote-responses.json'
import { type BlancRoute, quoteFromBlanc } from '../orchestrator/wire-quote'
import vectors from './__fixtures__/signing-vectors.json'

// Match the published build's single viem instance for RIP-7212 chain identity.
vi.mock('@rhinestone/shared-configs', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@rhinestone/shared-configs')>()
  const esmChains = Object.values(viemChains)
  return {
    ...actual,
    chains: actual.chains.map(
      (chain) => esmChains.find(({ id }) => id === chain.id) ?? chain,
    ),
  }
})

const route = recorded.devMultiChainOpsRoute as BlancRoute
const USDC_BASE: Address = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
const USDC_ARB: Address = '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d'
const transaction = {
  sourceChains: [baseSepolia],
  targetChain: arbitrumSepolia,
  tokenRequests: [{ address: USDC_ARB, amount: 100_000n }],
  auxiliaryFunds: { [baseSepolia.id]: { [USDC_BASE]: 1_000_000n } },
  settlementLayers: ['CCTP'] as ['CCTP'],
}

// Initialization depends on the account, not on the quoted route.
const eip7702InitSignature = (
  vectors as unknown as {
    vectors: { id: string; transaction: { eip7702InitSignature?: Hex } }[]
  }
).vectors.find(({ id }) => id === 'eip7702')!.transaction.eip7702InitSignature!

let quoteRequests: unknown[]

beforeEach(() => {
  quoteRequests = []
  vi.stubGlobal('fetch', async (input: unknown, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? '{}')
    if (String(input).endsWith('/quotes')) {
      quoteRequests.push(body)
      return Response.json({ routes: [route] })
    }
    const results: Record<string, string> = {
      eth_getCode: '0x',
      eth_getTransactionCount: '0x0',
    }
    if (!(body.method in results)) {
      throw new Error(`network blocked: ${String(input)}`)
    }
    return Response.json({
      jsonrpc: '2.0',
      id: body.id,
      result: results[body.method],
    })
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('recorded MultiChainOps signing offline', () => {
  test('Nexus signs once with its real ECDSA owner over a sans-chainId domain', async () => {
    const sdk = new RhinestoneSDK({ apiKey: 'offline' })
    const account = await sdk.createAccount({
      owners: { type: 'ecdsa', accounts: [accountA] },
    })
    const prepared = await account.prepareTransaction(transaction)
    expect(quoteRequests).toHaveLength(1)
    const [payload] = prepared.quote.signData.origin
    expect(payload.primaryType).toBe('MultiChainOps')
    expect(payload.domain).not.toHaveProperty('chainId')
    expect(payload.message).toMatchObject({
      account: account.getAddress().toLowerCase(),
      ops: [{ chainId: 421614n }, { chainId: 84532n }],
    })

    const signed = await account.signTransaction(prepared)
    expect(signed.originSignatures).toHaveLength(1)
    const packed = signed.originSignatures[0] as Hex
    expect(signed.destinationSignature).toBe(packed)
    // Nexus encodes its default validator as a zero address before the signature.
    expect(slice(packed, 0, 20)).toBe(zeroAddress)
    expect(size(packed)).toBe(20 + 65)
    expect(
      await recoverTypedDataAddress({
        ...payload,
        signature: slice(packed, 20),
      }),
    ).toBe(accountA.address)

    const { name, version, verifyingContract } = payload.domain!
    const domainSeparator = keccak256(
      encodeAbiParameters(
        [
          { type: 'bytes32' },
          { type: 'bytes32' },
          { type: 'bytes32' },
          { type: 'address' },
        ],
        [
          keccak256(
            stringToHex(
              'EIP712Domain(string name,string version,address verifyingContract)',
            ),
          ),
          keccak256(stringToHex(name!)),
          keccak256(stringToHex(version!)),
          verifyingContract!,
        ],
      ),
    )
    const structHash = hashStruct({
      data: payload.message,
      primaryType: payload.primaryType,
      types: payload.types,
    })
    expect(hashTypedData(payload)).toBe(
      keccak256(concat(['0x1901', domainSeparator, structHash])),
    )
    expect(
      hashTypedData({
        ...payload,
        domain: { ...payload.domain, chainId: arbitrumSepolia.id },
      }),
    ).not.toBe(hashTypedData(payload))
  })

  test('Kernel reuses one real fixturePasskey signature for the destination', async () => {
    const sdk = new RhinestoneSDK({ apiKey: 'offline' })
    const account = await sdk.createAccount({
      account: { type: 'kernel' },
      owners: { type: 'passkey', accounts: [fixturePasskey()] },
    })
    // The recorded payload names Nexus; this checks packing/reuse, not execution.
    const prepared = await account.prepareTransaction(transaction)
    const signed = await account.signTransaction(prepared)
    expect(quoteRequests).toHaveLength(1)
    expect(signed.originSignatures).toHaveLength(1)
    expect(size(signed.originSignatures[0] as Hex)).toBeGreaterThan(65)
    expect(signed.destinationSignature).toBe(signed.originSignatures[0])
  })

  test('an undelegated 7702 account authorizes every leg chain in ascending order', async () => {
    const sdk = new RhinestoneSDK({ apiKey: 'offline' })
    const account = await sdk.createAccount({
      eoa: accountA,
      owners: { type: 'ecdsa', accounts: [accountA] },
    })
    // Authorization scope depends on the quote's chains, not its named account.
    const prepared = await account.prepareTransaction({
      ...transaction,
      eip7702InitSignature,
    })
    expect(prepared.transaction.recipient).toBeUndefined()
    expect(prepared.quote.signData).toEqual(quoteFromBlanc(route).signData)
    const authorizations = await account.signAuthorizations(prepared)
    expect(authorizations.map(({ chainId }) => chainId)).toEqual([
      84532, 421614,
    ])
    expect(authorizations.every(({ nonce }) => nonce === 0)).toBe(true)
  })
})
