import { encodeFunctionData, erc20Abi } from 'viem'
import { describe, expect, test } from 'vitest'
import type {
  PreparedTransactionData,
  RhinestoneAccount,
  Session,
} from '../../../src/index'
import {
  DUMMY_PRECLAIMOP_SELECTOR,
  DUMMY_PRECLAIMOP_TARGET,
} from '../../../src/modules/validators/smart-sessions'
import { sourceChain, targetChain } from '../config/chains'
import { createIntegrationSDK } from '../config/environment'
import {
  createNoopCall,
  createOwner,
  createScopedSession,
  noopSelector,
  noopTarget,
} from '../framework/fixtures'
import {
  ensureFunded,
  usdcBalanceOf,
  waitForOrchestratorUsdc,
} from '../framework/funding'
import {
  executeIntent,
  expectCompletedOperation,
  expectOutcome,
} from '../framework/runner'
import { getTokenAddress } from '../framework/tokens'

type Execution = { to: string; value: bigint; data: string }

function readPreClaimExecutions(
  prepared: PreparedTransactionData,
): Record<number, Execution[]> | undefined {
  const input = prepared.intentInput as
    | { preClaimExecutions?: Record<number, Execution[]> }
    | undefined
  return input?.preClaimExecutions
}

describe.sequential('SDK integration preclaim-ops', () => {
  // A fresh session needs enabling, so the SDK injects the dummy enable op as
  // the first source-chain preclaim op; user source calls must follow it (the
  // filler runs the enable op before the user's calls).
  test('injects the session-enable op before user source calls', async () => {
    const sdk = createIntegrationSDK()
    const account = await sdk.createAccount({
      owners: { type: 'ecdsa', accounts: [createOwner()] },
      experimental_sessions: { enabled: true },
    })
    const session = createScopedSession({
      chain: sourceChain,
      owner: createOwner(),
    })

    const execution = await executeIntent({
      account,
      label: 'preclaim/dummy-ordering',
      mode: 'sign',
      transaction: await withEnableData(account, session, {
        sourceChains: [sourceChain],
        targetChain,
        sponsored: true,
        calls: [createNoopCall()],
        sourceCalls: { [sourceChain.id]: [createNoopCall()] },
        signers: { type: 'experimental_session', session },
      }),
    })

    expectOutcome(execution, { kind: 'success' })
    if (execution.phase !== 'success') return

    const preClaim = readPreClaimExecutions(execution.prepared)
    const ops = preClaim?.[sourceChain.id]
    expect(ops?.length).toBe(2)
    expect(ops?.[0].to.toLowerCase()).toBe(
      DUMMY_PRECLAIMOP_TARGET.toLowerCase(),
    )
    expect(ops?.[0].data).toBe(DUMMY_PRECLAIMOP_SELECTOR)
    expect(ops?.[1].to.toLowerCase()).toBe(noopTarget.toLowerCase())
    expect(ops?.[1].data).toBe(noopSelector)
  })

  // A plain owner intent has no session to enable and no source calls, so no
  // preclaim ops are attached.
  test('attaches no preclaim ops to a plain owner intent', async () => {
    const sdk = createIntegrationSDK()
    const account = await sdk.createAccount({
      owners: { type: 'ecdsa', accounts: [createOwner()] },
    })

    const execution = await executeIntent({
      account,
      label: 'preclaim/none',
      mode: 'sign',
      transaction: {
        sourceChains: [sourceChain],
        targetChain,
        sponsored: true,
        calls: [createNoopCall()],
      },
    })

    expectOutcome(execution, { kind: 'success' })
    if (execution.phase !== 'success') return

    expect(readPreClaimExecutions(execution.prepared)).toBeUndefined()
  })

  // Source calls aren't just encoded — they run on-chain. A cross-chain intent
  // moves USDC from the source (creating the source element the source call
  // rides in), and the source call transfers USDC to a fresh recipient. After
  // settlement that recipient must actually hold the transferred amount.
  test('executes a user source call on-chain', async () => {
    const sdk = createIntegrationSDK()
    const account = await sdk.createAccount({
      owners: { type: 'ecdsa', accounts: [createOwner()] },
    })
    await ensureFunded(account.getAddress(), sourceChain, { usdc: 1_000_000n })
    await waitForOrchestratorUsdc(account, sourceChain, 1_000_000n)

    const recipient = createOwner().address
    const sourceCallAmount = 5_000n
    const usdc = getTokenAddress('USDC', sourceChain.id)

    const execution = await executeIntent({
      account,
      label: 'preclaim/execute',
      transaction: {
        sourceChains: [sourceChain],
        targetChain,
        sponsored: true,
        calls: [],
        tokenRequests: [{ address: usdc, amount: 10_000n }],
        sourceCalls: {
          [sourceChain.id]: [
            {
              to: usdc,
              value: 0n,
              data: encodeFunctionData({
                abi: erc20Abi,
                functionName: 'transfer',
                args: [recipient, sourceCallAmount],
              }),
            },
          ],
        },
      },
    })

    expectOutcome(execution, { kind: 'success' })
    if (execution.phase !== 'success') return

    expectCompletedOperation(execution.status, targetChain.id)
    expect(await usdcBalanceOf(recipient, sourceChain)).toBe(sourceCallAmount)
  })
})

async function withEnableData<T extends { signers: { type: string } }>(
  account: RhinestoneAccount,
  session: Session,
  transaction: T,
): Promise<T> {
  const sessionDetails = await account.experimental_getSessionDetails([session])
  const userSignature =
    await account.experimental_signEnableSession(sessionDetails)

  return {
    ...transaction,
    signers: {
      ...transaction.signers,
      enableData: {
        userSignature,
        hashesAndChainIds: sessionDetails.hashesAndChainIds,
        sessionToEnableIndex: 0,
      },
    },
  }
}
