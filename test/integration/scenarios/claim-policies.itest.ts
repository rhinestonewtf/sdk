import type { Address } from 'viem'
import { describe, expect, test } from 'vitest'
import type { RhinestoneAccount, Session } from '../../../src/index'
import { toSession } from '../../../src/smart-sessions/index'
import { sourceChain, targetChain } from '../config/chains'
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

// A Permit2 claim policy is enforced through ERC-1271, so it only binds on a
// cross-chain intent, where the session signs a PermitBatchWitnessTransferFrom.
// A same-chain intent never produces one and would pass whatever is configured.

const UNRELATED: Address = '0x4444444444444444444444444444444444444444'

// Each intent moves MOVED; FUNDING is well above it so a rejection can only be
// the policy talking rather than an insufficient-balance revert.
const MOVED = 10_000n
const FUNDING = 100_000n

function permitSession(
  recipients: { chain: typeof targetChain; address: Address }[],
): Session {
  return toSession({
    chain: targetChain,
    owners: { type: 'ecdsa', accounts: [createOwner()] },
    claimPolicies: [{ type: 'permit2', recipients }],
  })
}

function accountRecipientSession(): Session {
  return toSession({
    chain: targetChain,
    owners: { type: 'ecdsa', accounts: [createOwner()] },
    claimPolicies: [{ type: 'permit2', recipientIsAccount: true }],
  })
}

function unrestrictedSession(): Session {
  return toSession({
    chain: targetChain,
    owners: { type: 'ecdsa', accounts: [createOwner()] },
  })
}

describe.sequential('SDK integration claim policies', () => {
  test('settles when the claim policy pins the account as recipient', async () => {
    const account = await createFundedSessionAccount()
    await expectSettled(
      account,
      accountRecipientSession(),
      'claim-policies/recipient-is-account',
    )
  })

  test('settles when the claim policy pins the real recipient', async () => {
    const account = await createFundedSessionAccount()
    await expectSettled(
      account,
      permitSession([{ chain: targetChain, address: account.getAddress() }]),
      'claim-policies/recipient-ok',
    )
  })

  test('rejects when the claim policy pins a different recipient', async () => {
    const account = await createFundedSessionAccount()
    await expectRejected(
      account,
      permitSession([{ chain: targetChain, address: UNRELATED }]),
      'claim-policies/recipient-mismatch',
    )
  })

  // Guards the rejections above against passing for the wrong reason: the same
  // intent on a session with no claim policy must still settle.
  test('settles when no claim policy is declared', async () => {
    const account = await createFundedSessionAccount()
    await expectSettled(
      account,
      unrestrictedSession(),
      'claim-policies/none-declared',
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
  label: string,
): Promise<void> {
  const execution = await executeIntent({
    account,
    label,
    transaction: await crossChainSessionIntent(account, session),
  })
  expectOutcome(execution, { kind: 'success' })
  if (execution.phase !== 'success') return

  expectNoFailedOperations(execution.status)
  expectCompletedOperation(execution.status, targetChain.id)
}

async function expectRejected(
  account: RhinestoneAccount,
  session: Session,
  label: string,
): Promise<void> {
  const execution = await executeIntent({
    account,
    label,
    transaction: await crossChainSessionIntent(account, session),
  })
  // Only that it did not settle. A claim-policy rejection happens inside
  // `isValidSignature` on the source-chain claim, and which phase and error
  // class that surfaces as is not pinned down — asserting one would fail for a
  // reason unrelated to enforcement. The `none-declared` control is what makes
  // this meaningful.
  expect(execution.phase).not.toBe('success')
}

async function crossChainSessionIntent(
  account: RhinestoneAccount,
  session: Session,
) {
  const sessionDetails = await account.getSessionDetails([session])
  const userSignature = await account.signEnableSession(sessionDetails)

  return {
    sourceChains: [sourceChain],
    targetChain,
    sponsored: true as const,
    calls: [],
    // Without a token request nothing is pulled from the source chain, so no
    // PermitBatchWitnessTransferFrom is produced and the claim policy is never
    // consulted — every spec below would pass whatever the policy says.
    tokenRequests: [
      { address: getTokenAddress('USDC', targetChain.id), amount: MOVED },
    ],
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
