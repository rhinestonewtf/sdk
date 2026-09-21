import { type Address, encodeFunctionData, erc20Abi } from 'viem'
import { describe, test } from 'vitest'
import { SimulationFailedError } from '../../../src/errors/index'
import type { RhinestoneAccount, Session } from '../../../src/index'
import { toSession } from '../../../src/smart-sessions/index'
import { sourceChain } from '../config/chains'
import { createIntegrationSDK } from '../config/environment'
import { createOwner } from '../framework/fixtures'
import { ensureFunded, waitForOrchestratorUsdc } from '../framework/funding'
import {
  executeIntent,
  expectCompletedOperation,
  expectNoFailedOperations,
  expectOutcome,
} from '../framework/runner'
import { getTokenAddress } from '../framework/tokens'

const ALICE: Address = '0x1111111111111111111111111111111111111111'
const BOB: Address = '0x2222222222222222222222222222222222222222'
const CAROL: Address = '0x3333333333333333333333333333333333333333'

const usdc = getTokenAddress('USDC', sourceChain.id)

// Comfortably above every transfer amount below, so an allowed transfer settles
// against a real balance and a rejected one can only be the policy talking —
// never an insufficient-balance revert.
const FUNDING = 100_000n

function usdcTransfer(to: Address, amount: bigint) {
  return {
    to: usdc,
    value: 0n,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: [to, amount],
    }),
  }
}

function spendingLimitSession(amount: bigint): Session {
  return toSession({
    chain: sourceChain,
    owners: { type: 'ecdsa', accounts: [createOwner()] },
    permissions: [
      {
        abi: erc20Abi,
        address: usdc,
        functions: { transfer: { spendingLimit: { token: usdc, amount } } },
      },
    ],
  })
}

function allowlistSession(
  recipients: readonly [Address, ...Address[]],
): Session {
  return toSession({
    chain: sourceChain,
    owners: { type: 'ecdsa', accounts: [createOwner()] },
    permissions: [
      {
        abi: erc20Abi,
        address: usdc,
        functions: {
          transfer: { params: { recipient: { anyOf: recipients } } },
        },
      },
    ],
  })
}

describe.sequential('SDK integration ssx policies', () => {
  test('allows a transfer within the spending limit', async () => {
    const account = await createFundedSessionAccount()
    await expectSettled(
      account,
      spendingLimitSession(100n),
      usdcTransfer(ALICE, 50n),
      'spend/ok',
    )
  })

  test('rejects a transfer over the spending limit', async () => {
    const account = await createFundedSessionAccount()
    await expectRejected(
      account,
      spendingLimitSession(100n),
      usdcTransfer(ALICE, 1_000n),
      'spend/over',
    )
  })

  test('allows a transfer to an allowlisted recipient', async () => {
    const account = await createFundedSessionAccount()
    await expectSettled(
      account,
      allowlistSession([ALICE, BOB]),
      usdcTransfer(ALICE, 1n),
      'anyof/ok',
    )
  })

  test('rejects a transfer to a non-allowlisted recipient', async () => {
    const account = await createFundedSessionAccount()
    await expectRejected(
      account,
      allowlistSession([ALICE, BOB]),
      usdcTransfer(CAROL, 1n),
      'anyof/bad',
    )
  })
})

async function createFundedSessionAccount(): Promise<RhinestoneAccount> {
  const account = await createIntegrationSDK().createAccount({
    owners: { type: 'ecdsa', accounts: [createOwner()] },
    sessions: { enabled: true },
  })
  await ensureFunded(account.getAddress(), sourceChain, { usdc: FUNDING })
  await waitForOrchestratorUsdc(account, sourceChain, FUNDING)
  return account
}

async function expectSettled(
  account: RhinestoneAccount,
  session: Session,
  call: ReturnType<typeof usdcTransfer>,
  label: string,
): Promise<void> {
  const execution = await executeIntent({
    account,
    label: `ssx-policies/${label}`,
    transaction: await sessionTransfer(account, session, call),
  })
  expectOutcome(execution, { kind: 'success' })
  if (execution.phase !== 'success') return

  expectNoFailedOperations(execution.status)
  expectCompletedOperation(execution.status, sourceChain.id)
}

async function expectRejected(
  account: RhinestoneAccount,
  session: Session,
  call: ReturnType<typeof usdcTransfer>,
  label: string,
): Promise<void> {
  const execution = await executeIntent({
    account,
    label: `ssx-policies/${label}`,
    transaction: await sessionTransfer(account, session, call),
  })
  expectOutcome(execution, {
    kind: 'submit-error',
    error: SimulationFailedError,
    code: 'SIMULATION_FAILED',
  })
}

async function sessionTransfer(
  account: RhinestoneAccount,
  session: Session,
  call: ReturnType<typeof usdcTransfer>,
) {
  const sessionDetails = await account.getSessionDetails([session])
  const userSignature = await account.signEnableSession(sessionDetails)

  return {
    chain: sourceChain,
    sponsored: true as const,
    calls: [call],
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
