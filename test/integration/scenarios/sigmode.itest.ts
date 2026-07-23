import { describe, test } from 'vitest'
import {
  SIG_MODE_EMISSARY_EXECUTION_ERC1271,
  SIG_MODE_ERC1271,
} from '../../../src/clients/orchestrator/public'
import { SimulationFailedError } from '../../../src/errors/index'
import type { RhinestoneAccount, Session } from '../../../src/index'
import { sourceChain } from '../config/chains'
import { createIntegrationSDK } from '../config/environment'
import { expectSessionEnabled } from '../framework/assertions'
import {
  createNoopCall,
  createOwner,
  createScopedSession,
  createUnscopedSession,
} from '../framework/fixtures'
import { executeIntent, expectOutcome } from '../framework/runner'
import {
  expectModeMatchesBytes,
  expectOriginSignatures,
  expectSignatureMode,
  tamperExecutionSignatures,
} from '../framework/signatures'

describe.sequential('SDK integration sigmode', () => {
  // A plain owner signature takes the ERC-1271 path: a single hex signature and
  // signatureMode 1.
  test('emits ERC-1271 mode with single signatures for a non-session owner', async () => {
    const sdk = createIntegrationSDK()
    const account = await sdk.createAccount({
      owners: { type: 'ecdsa', accounts: [createOwner()] },
    })

    const execution = await executeIntent({
      account,
      label: 'sigmode/owner/erc1271',
      mode: 'sign',
      transaction: {
        chain: sourceChain,
        sponsored: true,
        calls: [createNoopCall()],
      },
    })

    expectOutcome(execution, { kind: 'success' })
    if (execution.phase !== 'success') return

    expectSignatureMode(execution.prepared, SIG_MODE_ERC1271)
    expectOriginSignatures(execution.signed, 'single')
  })

  // A fresh (not-yet-enabled) session always verifies executions, so it takes
  // the hybrid path: dual { preClaimSig, notarizedClaimSig } signatures and
  // signatureMode 5.
  test('emits hybrid execution mode with dual signatures for a fresh session', async () => {
    const sdk = createIntegrationSDK()
    const account = await sdk.createAccount({
      owners: { type: 'ecdsa', accounts: [createOwner()] },
      sessions: { enabled: true },
    })
    const session = createScopedSession({
      chain: sourceChain,
      owner: createOwner(),
    })

    const execution = await executeIntent({
      account,
      label: 'sigmode/session/hybrid',
      mode: 'sign',
      transaction: await withEnableData(account, session, {
        chain: sourceChain,
        sponsored: true,
        calls: [createNoopCall()],
        signers: { type: 'session' as const, session },
      }),
    })

    expectOutcome(execution, { kind: 'success' })
    if (execution.phase !== 'success') return

    expectSignatureMode(execution.prepared, SIG_MODE_EMISSARY_EXECUTION_ERC1271)
    expectOriginSignatures(execution.signed, 'dual')
    expectModeMatchesBytes(execution.prepared, execution.signed)
  })

  // An enabled session with no explicit permissions verifies nothing extra, so
  // it drops back to the plain ERC-1271 path: single signature, mode 1 — even
  // though a fresh session would have been the hybrid mode 5. This is the path
  // a claim-only session takes once enabled.
  test('emits ERC-1271 mode with single signatures for an enabled session', async () => {
    const sdk = createIntegrationSDK()
    const account = await sdk.createAccount({
      owners: { type: 'ecdsa', accounts: [createOwner()] },
      sessions: { enabled: true },
    })
    const session = createUnscopedSession({
      chain: sourceChain,
      owner: createOwner(),
    })

    const enable = await executeIntent({
      account,
      label: 'sigmode/enabled/enable',
      transaction: await withEnableData(account, session, {
        chain: sourceChain,
        sponsored: true,
        calls: [createNoopCall()],
        signers: { type: 'session' as const, session },
      }),
    })
    expectOutcome(enable, { kind: 'success' })
    await expectSessionEnabled(account, session)

    const execution = await executeIntent({
      account,
      label: 'sigmode/enabled/use',
      mode: 'sign',
      transaction: {
        chain: sourceChain,
        sponsored: true,
        calls: [createNoopCall()],
        signers: { type: 'session' as const, session },
      },
    })

    expectOutcome(execution, { kind: 'success' })
    if (execution.phase !== 'success') return

    expectSignatureMode(execution.prepared, SIG_MODE_ERC1271)
    expectOriginSignatures(execution.signed, 'single')
    expectModeMatchesBytes(execution.prepared, execution.signed)
  })

  // The orchestrator's simulation must reject an intent whose execution
  // signature was tampered with — the hybrid path's ERC-1271 fallback does not
  // rescue corrupted preClaimSig bytes within a single operation.
  test('rejects an intent whose execution signature was tampered with', async () => {
    const sdk = createIntegrationSDK()
    const account = await sdk.createAccount({
      owners: { type: 'ecdsa', accounts: [createOwner()] },
      sessions: { enabled: true },
    })
    const session = createScopedSession({
      chain: sourceChain,
      owner: createOwner(),
    })

    const execution = await executeIntent({
      account,
      label: 'sigmode/tampered/reject',
      transformSigned: tamperExecutionSignatures,
      transaction: await withEnableData(account, session, {
        chain: sourceChain,
        sponsored: true,
        calls: [createNoopCall()],
        signers: { type: 'session' as const, session },
      }),
    })

    expectOutcome(execution, {
      kind: 'submit-error',
      error: SimulationFailedError,
      code: 'SIMULATION_FAILED',
    })
  })
})

async function withEnableData<T extends { signers: { type: string } }>(
  account: RhinestoneAccount,
  session: Session,
  transaction: T,
): Promise<T> {
  const sessionDetails = await account.getSessionDetails([session])
  const userSignature = await account.signEnableSession(sessionDetails)

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
