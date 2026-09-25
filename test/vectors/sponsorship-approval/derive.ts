// Derives each sponsorship approval vector from the SDK itself: the exact body a
// sponsored `POST /quotes` sends and the approval input handed to
// `getIntentExtensionToken`. EVM cases run through the public facade; the
// Solana and smart-session cases through the request builders, whose facade
// paths need a live Swig or session signer.
import { hexToBytes } from 'viem'
import { locateSwigById } from '../../../src/accounts/solana/address'
import {
  hyperCorePerp,
  solanaAddress,
  solanaDevnet,
  solanaMainnet,
  tronMainnet,
} from '../../../src/chains/non-evm'
import { mapIntentRequestToWire } from '../../../src/clients/orchestrator/mappers'
import { projectCompatibleIntentInput } from '../../../src/clients/orchestrator/normalized'
import type { EvmAccountConfig } from '../../../src/evm/index'
import { RhinestoneSDK } from '../../../src/index'
import { buildIntentRequest } from '../../../src/transactions/intents/request'
import {
  buildSolanaIntentRequest,
  type SolanaTransferInput,
} from '../../../src/transactions/intents/solana'
import {
  buildSolanaDeploymentRequest,
  type SolanaDeploymentInput,
} from '../../../src/transactions/intents/solana-deployment'
import { type EvmVectorCase, evmCases, owner } from './cases'

export interface DerivedVector {
  readonly id: string
  readonly body: unknown
  readonly intentInput: unknown
}

const toJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

class QuoteCaptured extends Error {}

/** Runs one EVM case through `prepareTransaction`, capturing what it sends. */
export async function deriveEvmCase(
  vector: EvmVectorCase,
): Promise<DerivedVector> {
  let body: unknown
  let intentInput: unknown
  let extension: string | null = null
  const previous = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString()
    const payload = init?.body ? JSON.parse(String(init.body)) : undefined
    if (payload?.jsonrpc === '2.0' && payload.method === 'eth_getCode') {
      return Response.json({
        jsonrpc: '2.0',
        id: payload.id,
        result: vector.deployed ? '0x01' : '0x',
      })
    }
    if (url.endsWith('/quotes')) {
      body = payload
      extension = new Headers(init?.headers).get('X-Intent-Extension')
      throw new QuoteCaptured()
    }
    throw new Error(`Unexpected request while deriving ${vector.id}: ${url}`)
  }) as typeof fetch
  try {
    const sdk = new RhinestoneSDK({
      auth: {
        mode: 'experimental_jwt',
        accessToken: 'vector',
        getIntentExtensionToken: async (input) => {
          intentInput = input
          return 'vector'
        },
      },
    })
    const account = await sdk.createAccount({
      evm: vector.account as unknown as EvmAccountConfig,
    })
    await account.prepareTransaction(vector.transaction as never).then(
      () => {
        throw new Error(`${vector.id} was quoted without a captured body`)
      },
      (error: unknown) => {
        if (body === undefined) throw error
      },
    )
  } finally {
    globalThis.fetch = previous
  }
  if (extension !== 'Bearer vector') {
    throw new Error(`${vector.id} did not present the grant with its quote`)
  }
  return { id: vector.id, body, intentInput: toJson(intentInput) }
}

function fromBuilder(
  id: string,
  built: {
    readonly request: Parameters<typeof mapIntentRequestToWire>[0]
    readonly normalized: Parameters<typeof projectCompatibleIntentInput>[0]
  },
): DerivedVector {
  return {
    id,
    body: toJson(mapIntentRequestToWire(built.request)),
    intentInput: toJson(projectCompatibleIntentInput(built.normalized)),
  }
}

const ACCOUNT = '0x00000000000000000000000000000000000000a0'
const USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const MOCK_SIGNATURE = `0x${'5e'.repeat(65)}` as const

/** A smart-session intent: mocked signatures and the session signature mode. */
function smartSessionCase(): DerivedVector {
  return fromBuilder(
    'evm-smart-session',
    buildIntentRequest({
      transaction: {
        destination: { kind: 'evm', id: 8453, caip2: 'eip155:8453' },
        sourceChains: [{ kind: 'evm', id: 1, caip2: 'eip155:1' }],
        calls: [],
        tokenRequests: [{ token: USDC_BASE, amount: 1_000_000n }],
        accountAccessList: { chainIds: [1] },
        signatureMode: 4,
        options: {
          sponsorSettings: { gas: true, bridgeFees: false, swapFees: false },
        },
      },
      account: { kind: 'erc7579', address: ACCOUNT, setupOps: [] },
      mockSignatures: { 1: MOCK_SIGNATURE, 8453: MOCK_SIGNATURE },
      calls: [{ target: USDC_BASE, value: 0n, data: '0xa9059cbb' }],
      sourceCalls: {},
      providedFunds: {},
    }),
  )
}

const SWIG_ID = `0x${'07'.repeat(32)}` as const
const swig = locateSwigById(hexToBytes(SWIG_ID))
const MINT = solanaAddress('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')
const SOLANA_RECIPIENT = solanaAddress('11111111111111111111111111111112')
const PASSKEY = `0x02${'3c'.repeat(32)}` as const
const k1 = { kind: 'secp256k1', address: owner.address } as const
const r1 = { kind: 'secp256r1', publicKey: PASSKEY } as const
const sponsorSettings = { gas: true, bridgeFees: false, swapFees: false }

function transfer(
  overrides: Partial<SolanaTransferInput> = {},
): SolanaTransferInput {
  return {
    chain: solanaDevnet,
    action: {
      kind: 'transfer',
      mint: MINT,
      amount: 1_000_000n,
      delivery: { kind: 'same-chain', recipient: SOLANA_RECIPIENT },
    },
    accountAddress: swig.wallet,
    authority: k1,
    walletAddress: swig.wallet,
    swigAddress: swig.swig,
    namespace: 'dev-v1',
    endpoint: 'https://dev.v1.orchestrator.rhinestone.dev',
    sponsorSettings,
    ...overrides,
  }
}

const delivery = {
  kind: 'cross-chain',
  chainId: 8453,
  token: USDC_BASE,
  recipient: ACCOUNT,
} as const

function solanaCases(): DerivedVector[] {
  const deployment = (
    authorization: SolanaDeploymentInput['authorization'],
    initAuthority: SolanaDeploymentInput['initAuthority'],
  ): SolanaDeploymentInput => ({
    chain: solanaDevnet,
    walletAddress: swig.wallet,
    swigAddress: swig.swig,
    authorization,
    initAuthority,
    swigId: SWIG_ID,
    namespace: 'dev-v1',
    endpoint: 'https://dev.v1.orchestrator.rhinestone.dev',
  })
  return [
    fromBuilder('solana-same-chain', buildSolanaIntentRequest(transfer())),
    fromBuilder(
      'solana-same-chain-capped',
      buildSolanaIntentRequest(
        transfer({
          chain: solanaMainnet,
          authority: r1,
          action: {
            kind: 'transfer',
            mint: MINT,
            amount: 1_000_000n,
            sourceLimit: 1_500_000n,
            delivery: { kind: 'same-chain', recipient: SOLANA_RECIPIENT },
          },
        }),
      ),
    ),
    fromBuilder(
      'solana-instructions',
      buildSolanaIntentRequest(
        transfer({
          action: {
            kind: 'instructions',
            instructions: [
              {
                programId: MINT,
                accounts: [
                  { pubkey: swig.wallet, isSigner: true, isWritable: true },
                ],
                data: 'AQID',
              },
            ],
            addressLookupTables: [SOLANA_RECIPIENT],
          },
        }),
      ),
    ),
    fromBuilder(
      'solana-to-evm',
      buildSolanaIntentRequest(
        transfer({
          action: {
            kind: 'transfer',
            mint: MINT,
            amount: 1_000_000n,
            sourceLimit: 2_000_000n,
            delivery,
          },
        }),
      ),
    ),
    fromBuilder(
      'solana-to-evm-calls',
      buildSolanaIntentRequest(
        transfer({
          accountAddress: ACCOUNT,
          accountType: 'ERC7579',
          action: {
            kind: 'transfer',
            mint: MINT,
            amount: 1_000_000n,
            delivery: {
              ...delivery,
              execution: {
                calls: [{ target: USDC_BASE, value: 0n, data: '0xa9059cbb' }],
                gasLimit: 200_000n,
                account: {
                  kind: 'erc7579',
                  address: ACCOUNT,
                  setupOps: [{ to: USDC_BASE, data: '0xfa' }],
                },
              },
            },
          },
        }),
      ),
    ),
    fromBuilder(
      'swig-creation-secp256k1',
      buildSolanaDeploymentRequest(
        deployment(k1, { kind: 'secp256k1', publicKey: owner.publicKey }),
      ),
    ),
    fromBuilder(
      'swig-creation-secp256r1',
      buildSolanaDeploymentRequest(deployment(r1, r1)),
    ),
  ]
}

export async function deriveVectors(): Promise<DerivedVector[]> {
  const evm: DerivedVector[] = []
  for (const vector of evmCases({
    solanaMainnet,
    tronMainnet,
    hyperCorePerp,
  })) {
    evm.push(await deriveEvmCase(vector))
  }
  return [...evm, smartSessionCase(), ...solanaCases()]
}
