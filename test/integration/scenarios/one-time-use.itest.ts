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
import type { Session } from '../../../src/index'
import { type RhinestoneAccount, RhinestoneSDK } from '../../../src/index'
import {
  buildOneTimeUseBurnOp,
  toSession,
} from '../../../src/smart-sessions/index'
import { createOwner } from '../framework/fixtures'
import { executeIntent, expectOutcome } from '../framework/runner'

// LOCAL-FORK E2E (RHI-5798) — SDK bundle-gen → LOCAL orchestrator → base mainnet
// anvil fork. Settle-once / reject-twice through both settlement routes.
//
// Unlike the testnet integration suite, this drives the local `e2e:up` stack:
// the SDK reads base (8453) from the fork RPC and talks to the local orchestrator
// with prod (mainnet-canonical) contracts. Funding is done directly on the fork.
//
// Prereqs (see /tmp/onetime-e2e-runbook.sh): local stack up; OneTimeUseIdPolicy
// deployed on the base fork and wired into the orchestrator env.

const ORCH_URL =
  process.env.INTEGRATION_ORCHESTRATOR_URL ?? 'http://localhost:3000'
const BASE_RPC =
  process.env.INTEGRATION_BASE_FORK_RPC ?? 'http://localhost:30003'
const ARBITRUM_RPC =
  process.env.INTEGRATION_ARB_FORK_RPC ?? 'http://localhost:30002'
// dev Across 7579 arbiter — the spender the permit2 claim policy binds to for the
// cross-chain (Across) settlement route.
const ACROSS_ARBITER: Address = '0x28a4D41776968c1201A807ec51fFB405362B8882'
const API_KEY = process.env.INTEGRATION_RHINESTONE_API_KEY ?? 'testuserapikey'
const POLICY = (process.env.INTEGRATION_ONE_TIME_USE_ID_POLICY ?? '') as Address
if (!POLICY) {
  throw new Error(
    'Set INTEGRATION_ONE_TIME_USE_ID_POLICY to the deployed OneTimeUseIdPolicy address',
  )
}

// Canonical base-mainnet USDC (FiatTokenV2_2). Its `balances` mapping is at
// storage slot 9, which we write directly on the fork to fund accounts.
const USDC: Address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const ARB_USDC: Address = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'
const USDC_BALANCES_SLOT = 9n
const RECIPIENT: Address = '0x1111111111111111111111111111111111111111'
const FUNDING = 100_000_000n // 100 USDC (6 decimals)
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
    useDevContracts: false, // staging contracts (orchestrator ENVIRONMENT=production)
    provider: {
      kind: 'custom',
      urls: { [base.id]: BASE_RPC, [arbitrum.id]: ARBITRUM_RPC },
    },
  })
}

// Fund an account on the fork: gas + USDC (via the balances storage slot).
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
  // Bury the funding several blocks deep: the relayer estimates the fill at a
  // block a few behind the tip (getBlock lag), and cheatcode funding is
  // forward-only, so funding at the tip isn't visible at the relayer's slightly
  // stale block. Mining a batch puts the funding safely below any lagged block.
  await fork.mine({ blocks: 16 })
}

function usdcTransfer(amount: bigint) {
  return {
    to: USDC,
    value: 0n,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: [RECIPIENT, amount],
    }),
  }
}

function permit2OneTimeUseSession(id: bigint): Session {
  return toSession({
    chain: base,
    owners: { type: 'ecdsa', accounts: [createOwner()] },
    // Permit2 claim policy needs at least one arbiter (spender) — a bare
    // { type: 'permit2' } encodes an empty modeConfig and reverts on-chain
    // (InvalidConfigurationData). Same-chain settlement uses the samechainArbiter.
    claimPolicies: [
      {
        type: 'permit2',
        spenders: ['0x000000000006e2569CaF8Ff021810790e0A0D740'],
      },
    ],
    oneTimeUse: { id },
    policyAddresses: { oneTimeUseId: POLICY },
  })
}

function executorOneTimeUseSession(id: bigint): Session {
  return toSession({
    chain: base,
    owners: { type: 'ecdsa', accounts: [createOwner()] },
    oneTimeUse: { id },
    policyAddresses: { oneTimeUseId: POLICY },
  })
}

// A one-time-use session whose permit2 claim policy binds the Across arbiter, for
// the real cross-chain (permit2/arbiter) settlement route.
function crossChainPermit2Session(id: bigint): Session {
  return toSession({
    chain: base,
    owners: { type: 'ecdsa', accounts: [createOwner()] },
    claimPolicies: [{ type: 'permit2', spenders: [ACROSS_ARBITER] }],
    oneTimeUse: { id },
    policyAddresses: { oneTimeUseId: POLICY },
  })
}

describe.sequential('SDK integration one-time-use (local fork)', () => {
  beforeAll(async () => {
    // Sanity: fork must be reachable and be base mainnet.
    const id = await fork.request({ method: 'eth_chainId' })
    expect(Number(id)).toBe(base.id)
  })

  // CONTROL: a plain session (no one-time-use) through the identical fork stack.
  // Isolates whether ValidatorNotInstalled is our one-time-use code or the
  // SDK↔deployed-contract environment.
  test('CONTROL: a plain session settles (isolates env vs one-time-use)', async () => {
    const account = await createFundedAccount()
    const session = toSession({
      chain: base,
      owners: { type: 'ecdsa', accounts: [createOwner()] },
    })
    const sessionDetails = await account.getSessionDetails([session])
    const userSignature = await account.signEnableSession(sessionDetails)
    const execution = await executeIntent({
      account,
      label: 'one-time-use/control',
      transaction: {
        chain: base,
        calls: [usdcTransfer(TRANSFER)],
        signers: {
          type: 'session' as const,
          session,
          enableData: {
            userSignature,
            hashesAndChainIds: sessionDetails.hashesAndChainIds,
            sessionToEnableIndex: 0,
          },
        },
      },
    })
    expectOutcome(execution, { kind: 'success' })
  })

  test('permit2 route settles once, then rejects the second settlement', async () => {
    const id = 0x5798_0001n
    const account = await createFundedAccount()
    const session = permit2OneTimeUseSession(id)

    await expectSettled(account, session, id, 'permit2', 'permit2/first')
    await expectRejected(account, session, id, 'permit2', 'permit2/second')
  })

  test('executor route settles once, then rejects the second settlement', async () => {
    const id = 0x5798_0002n
    const account = await createFundedAccount()
    const session = executorOneTimeUseSession(id)

    await expectSettled(account, session, id, 'executor', 'executor/first')
    await expectRejected(account, session, id, 'executor', 'executor/second')
  })

  // Cross-route: the burn is keyed on (id, account), not on a session/route. Burn
  // the id via one session, then a DIFFERENT session (different config) with the
  // SAME id on the SAME account must be refused.
  test('cross-route: a second session with the same id + account is rejected', async () => {
    const id = 0x5798_0003n
    const account = await createFundedAccount()
    const first = executorOneTimeUseSession(id)
    const second = permit2OneTimeUseSession(id)

    await expectSettled(account, first, id, 'executor', 'cross/first')
    await expectRejected(account, second, id, 'executor', 'cross/second')
  })

  // The REAL permit2 settlement layer: a cross-chain (base→arbitrum) intent
  // routes through the Across arbiter, so the once-policy is enforced via
  // check1271SignedAction on the erc1271 list (not the executor's checkAction).
  test('permit2 settlement layer (cross-chain base→arbitrum): settles once, rejects second', async () => {
    const id = 0x5798_0004n
    const account = await createFundedAccount()
    const session = crossChainPermit2Session(id)

    const first = await executeIntent({
      account,
      label: 'one-time-use/xchain/first',
      transaction: await crossChainTx(account, session, id),
    })
    expectOutcome(first, { kind: 'success' })

    const second = await executeIntent({
      account,
      label: 'one-time-use/xchain/second',
      transaction: await crossChainTx(account, session, id),
    })
    expect(second.phase).not.toBe('success')
  })
})

async function crossChainTx(
  account: RhinestoneAccount,
  session: Session,
  id: bigint,
) {
  const sessionDetails = await account.getSessionDetails([session])
  const userSignature = await account.signEnableSession(sessionDetails)
  const burnOp = buildOneTimeUseBurnOp({ policy: POLICY, id, route: 'permit2' })
  return {
    sourceChains: [base],
    targetChain: arbitrum,
    calls: [],
    tokenRequests: [{ address: ARB_USDC, amount: 10_000n }],
    sourceCalls: { [base.id]: [burnOp] },
    signers: {
      type: 'session' as const,
      session,
      enableData: {
        userSignature,
        hashesAndChainIds: sessionDetails.hashesAndChainIds,
        sessionToEnableIndex: 0,
      },
    },
  }
}

async function createFundedAccount(): Promise<RhinestoneAccount> {
  const account = await sdk().createAccount({
    owners: { type: 'ecdsa', accounts: [createOwner()] },
    sessions: { enabled: true },
  })
  await fundOnFork(account.getAddress())
  console.log(`[E2E] funded account: ${account.getAddress()}`)
  return account
}

async function expectSettled(
  account: RhinestoneAccount,
  session: Session,
  id: bigint,
  route: 'permit2' | 'executor',
  label: string,
) {
  const execution = await executeIntent({
    account,
    label: `one-time-use/${label}`,
    transaction: await burnTransaction(account, session, id, route),
  })
  // First run: expect it to go through prepare+sign+submit without error.
  expectOutcome(execution, { kind: 'success' })
}

async function expectRejected(
  account: RhinestoneAccount,
  session: Session,
  id: bigint,
  route: 'permit2' | 'executor',
  label: string,
) {
  // The id is burned on-chain by the first settlement → the second attempt's
  // consume/consumeFor reverts in simulation.
  const execution = await executeIntent({
    account,
    label: `one-time-use/${label}`,
    transaction: await burnTransaction(account, session, id, route),
  })
  expect(execution.phase).not.toBe('success')
}

async function burnTransaction(
  account: RhinestoneAccount,
  session: Session,
  id: bigint,
  route: 'permit2' | 'executor',
) {
  const sessionDetails = await account.getSessionDetails([session])
  const userSignature = await account.signEnableSession(sessionDetails)
  const burnOp = buildOneTimeUseBurnOp({ policy: POLICY, id, route })

  return {
    chain: base,
    calls: [usdcTransfer(TRANSFER)],
    sourceCalls: { [base.id]: [burnOp] },
    signers: {
      type: 'session' as const,
      session,
      enableData: {
        userSignature,
        hashesAndChainIds: sessionDetails.hashesAndChainIds,
        sessionToEnableIndex: 0,
      },
    },
  }
}
