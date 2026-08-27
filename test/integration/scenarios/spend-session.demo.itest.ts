import {
  type Address,
  createTestClient,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  http,
  keccak256,
  pad,
  parseEther,
  toHex,
} from 'viem'
import { arbitrum, base } from 'viem/chains'
import { beforeAll, describe, expect, test } from 'vitest'
import { type RhinestoneAccount, RhinestoneSDK } from '../../../src/index'
import { experimental_defineSpendSession } from '../../../src/smart-sessions/index'
import { createOwner } from '../framework/fixtures'
import { executeIntent, expectOutcome } from '../framework/runner'

// RHI-6242 DEMO — the experimental spend-session abstraction on the local-fork
// E2E stack. Instead of hand-wiring toSession + claim policies + arbiters, a
// caller declares the spend (tokens, amounts, recipients, target chains) and the
// SDK formulates the policy combination and the one-time-use burn op.
//
// Runs against the same `e2e:up` stack as one-time-use.itest.ts. Same-chain
// settles end-to-end (settle-once / reject-twice); cross-chain is exercised
// through build + submit (its on-chain fill is blocked on the settlement-layer
// mode-byte collision tracked separately — the abstraction itself is unaffected).

const ORCH_URL =
  process.env.INTEGRATION_ORCHESTRATOR_URL ?? 'http://localhost:3000'
const BASE_RPC =
  process.env.INTEGRATION_BASE_FORK_RPC ?? 'http://localhost:30003'
const ARBITRUM_RPC =
  process.env.INTEGRATION_ARB_FORK_RPC ?? 'http://localhost:30002'
const API_KEY = process.env.INTEGRATION_RHINESTONE_API_KEY ?? 'testuserapikey'
const POLICY = (process.env.INTEGRATION_ONE_TIME_USE_ID_POLICY ?? '') as Address
if (!POLICY) {
  throw new Error(
    'Set INTEGRATION_ONE_TIME_USE_ID_POLICY to the deployed OneTimeUseIdPolicy address',
  )
}

const USDC: Address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const ARB_USDC: Address = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'
const USDC_BALANCES_SLOT = 9n
const RECIPIENT: Address = '0x1111111111111111111111111111111111111111'
const FUNDING = 100_000_000n // 100 USDC
const TRANSFER = 1_000_000n // 1 USDC

const fork = createTestClient({
  mode: 'anvil',
  chain: base,
  transport: http(BASE_RPC),
})

function sdk() {
  return new RhinestoneSDK({
    apiKey: API_KEY,
    endpointUrl: ORCH_URL,
    useDevContracts: false,
    provider: {
      type: 'custom',
      urls: { [base.id]: BASE_RPC, [arbitrum.id]: ARBITRUM_RPC },
    },
  })
}

async function fundOnFork(account: Address) {
  await fork.setBalance({ address: account, value: parseEther('10') })
  const slot = keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'uint256' }],
      [account, USDC_BALANCES_SLOT],
    ),
  )
  await fork.setStorageAt({
    address: USDC,
    index: slot,
    value: pad(toHex(FUNDING), { size: 32 }),
  })
  await fork.mine({ blocks: 16 })
}

async function createFundedAccount(): Promise<RhinestoneAccount> {
  const account = await sdk().createAccount({
    owners: { type: 'ecdsa', accounts: [createOwner()] },
    sessions: { enabled: true },
  })
  await fundOnFork(account.getAddress())
  return account
}

function freshId(): bigint {
  // Unique per run so a re-run against a persistent fork isn't pre-burned.
  return BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000))
}

describe('RHI-6242 spend-session demo (local fork)', () => {
  let account: RhinestoneAccount

  beforeAll(async () => {
    account = await createFundedAccount()
  })

  // Same-chain: the SDK picks the executor route and scopes the transfer to the
  // recipient + amount, plus the one-time-use burn. Settles once, rejects twice.
  test('same-chain single-use spend settles once, then rejects', async () => {
    const owner = { type: 'ecdsa' as const, accounts: [createOwner()] }
    const id = freshId()
    const { session, buildBurnOp } = experimental_defineSpendSession({
      chain: base,
      owners: owner,
      spend: {
        tokens: [{ token: USDC, maxAmount: TRANSFER }],
        recipients: [RECIPIENT],
      },
      singleUse: { id },
      policyAddresses: { oneTimeUseId: POLICY },
    })

    const build = async () => {
      const details = await account.getSessionDetails([session])
      const userSignature = await account.signEnableSession(details)
      return {
        chain: base,
        calls: [
          {
            to: USDC,
            value: 0n,
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: 'transfer',
              args: [RECIPIENT, TRANSFER],
            }),
          },
        ],
        sourceCalls: { [base.id]: [buildBurnOp()] },
        signers: {
          type: 'session' as const,
          session,
          enableData: {
            userSignature,
            hashesAndChainIds: details.hashesAndChainIds,
            sessionToEnableIndex: 0,
          },
        },
      }
    }

    const first = await executeIntent({
      account,
      label: 'spend-demo/same-chain/first',
      transaction: await build(),
    })
    expectOutcome(first, { kind: 'success' })

    const second = await executeIntent({
      account,
      label: 'spend-demo/same-chain/second',
      transaction: await build(),
    })
    expect(second.phase).not.toBe('success')
  })

  // Cross-chain: the SDK picks the permit2 route, binds the claim policy to the
  // chosen settlement layer's arbiter, and restricts the destination recipient.
  // Exercised through build + submit; the fill is blocked on the settlement-layer
  // mode-byte collision (tracked separately), so we assert it builds and reaches
  // submission rather than a full settle.
  test('cross-chain single-use spend builds and submits', async () => {
    const owner = { type: 'ecdsa' as const, accounts: [createOwner()] }
    const id = freshId()
    const { session, route, buildBurnOp } = experimental_defineSpendSession({
      chain: base,
      owners: owner,
      spend: {
        tokens: [{ token: USDC, maxAmount: TRANSFER }],
        recipients: [RECIPIENT],
        target: {
          chains: [arbitrum],
          settlementLayers: ['ACROSS'],
          tokens: [{ chain: arbitrum, token: ARB_USDC }],
        },
      },
      singleUse: { id },
      policyAddresses: { oneTimeUseId: POLICY },
    })
    expect(route).toBe('permit2')

    const details = await account.getSessionDetails([session])
    const userSignature = await account.signEnableSession(details)
    const execution = await executeIntent({
      account,
      label: 'spend-demo/cross-chain',
      transaction: {
        sourceChains: [base],
        targetChain: arbitrum,
        calls: [],
        tokenRequests: [{ address: ARB_USDC, amount: 10_000n }],
        sourceCalls: { [base.id]: [buildBurnOp()] },
        signers: {
          type: 'session' as const,
          session,
          enableData: {
            userSignature,
            hashesAndChainIds: details.hashesAndChainIds,
            sessionToEnableIndex: 0,
          },
        },
      },
    })
    // The abstraction produced a signable, submittable cross-chain intent. The
    // fill itself is gated on the separate settlement-layer fix.
    expect(['success', 'submit']).toContain(execution.phase)
  })
})
