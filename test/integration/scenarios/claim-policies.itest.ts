import type { Address } from 'viem'
import { describe, expect, test } from 'vitest'
import type { RhinestoneAccount, Session } from '../../../src/index'
import { toSession } from '../../../src/smart-sessions/index'
import { sourceChain, targetChain } from '../config/chains'
import { createIntegrationSDK } from '../config/environment'
import { crossChainSessionIntent } from '../framework/claim-policies'
import { createOwner } from '../framework/fixtures'
import { ensureFunded, waitForOrchestratorUsdc } from '../framework/funding'
import {
  executeIntent,
  expectCompletedOperation,
  expectNoFailedOperations,
  expectOutcome,
} from '../framework/runner'
import { expectOriginSignatures } from '../framework/signatures'
import { getTokenAddress } from '../framework/tokens'

// The Permit2 claim is signed on the source chain; a same-chain intent would
// never exercise its ERC-1271 recipient gate.
const UNRELATED: Address = '0x4444444444444444444444444444444444444444'
const FUNDING = 100_000n

function permitSession(account: Address, recipient?: Address): Session {
  const session = toSession({
    chain: sourceChain,
    account,
    owners: { type: 'ecdsa', accounts: [createOwner()] },
    crossChainPermits: [
      {
        from: {
          chain: sourceChain,
          token: getTokenAddress('USDC', sourceChain.id),
          maxAmount: FUNDING,
        },
        to: {
          chain: targetChain,
          token: getTokenAddress('USDC', targetChain.id),
          ...(recipient ? { recipient } : {}),
        },
        settlementLayers: ['ACROSS'],
        // Opt out only for the deliberate mismatch, not for valid sessions.
        ...(recipient && recipient !== account
          ? { allowRecipientNotAccount: true }
          : {}),
      },
    ],
  })
  expect(session.access?.kind).toBe('scoped')
  expect(session.claimPolicies).not.toHaveLength(0)
  return session
}

function unrestrictedSession(): Session {
  return toSession({
    chain: sourceChain,
    owners: { type: 'ecdsa', accounts: [createOwner()] },
  })
}

describe.sequential('SDK integration claim policies', () => {
  test('settles when the permit defaults to the account as recipient', async () => {
    const account = await createFundedSessionAccount()
    await expectSettled(
      account,
      permitSession(account.getAddress('evm')),
      'claim-policies/recipient-is-account',
    )
  })

  test('settles when the permit pins the real recipient', async () => {
    const account = await createFundedSessionAccount()
    await expectSettled(
      account,
      permitSession(account.getAddress('evm'), account.getAddress('evm')),
      'claim-policies/recipient-ok',
    )
  })

  test('rejects when the permit pins a different recipient', async () => {
    const account = await createFundedSessionAccount()
    const execution = await executeIntent({
      account,
      label: 'claim-policies/recipient-mismatch',
      transaction: await crossChainSessionIntent(
        account,
        permitSession(account.getAddress('evm'), UNRELATED),
      ),
    })
    // Preparation/signing failures cannot prove on-chain claim enforcement.
    // The matching-recipient and no-policy controls use the same funded route.
    expect(['submit', 'execution']).toContain(execution.phase)
    expect(execution.signed).toBeDefined()
    if (execution.signed) expectOriginSignatures(execution.signed, 'dual')
  })

  test('settles when no claim policy is declared', async () => {
    const account = await createFundedSessionAccount()
    const session = unrestrictedSession()
    expect(session.claimPolicies).toHaveLength(0)
    await expectSettled(account, session, 'claim-policies/none-declared')
  })
})

async function createFundedSessionAccount(): Promise<RhinestoneAccount> {
  const account = await createIntegrationSDK().createAccount({
    evm: {
      owners: { type: 'ecdsa', accounts: [createOwner()] },
      sessions: { enabled: true },
    },
  })
  await ensureFunded(account.getAddress('evm'), sourceChain, { usdc: FUNDING })
  await waitForOrchestratorUsdc(account, sourceChain, FUNDING)
  return account
}

async function expectSettled(
  account: RhinestoneAccount,
  session: Session,
  label: string,
): Promise<void> {
  const execution = await executeIntent({
    account,
    label,
    transaction: await crossChainSessionIntent(account, session),
  })
  expectOutcome(execution, { kind: 'success' })
  if (execution.phase !== 'success') return

  expectOriginSignatures(execution.signed, 'dual')
  expectNoFailedOperations(execution.status)
  expectCompletedOperation(execution.status, targetChain.id)
}
