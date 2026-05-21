import { describe, test } from 'vitest'
import { ValidationError } from '../../../src/errors/index'
import { sourceChain } from '../config/chains'
import { createIntegrationSDK } from '../config/environment'
import {
  expectDeployed,
  expectNotDeployed,
  expectSessionDisabled,
  expectSessionEnabled,
} from '../framework/assertions'
import {
  createNoopCall,
  createOutOfScopeCall,
  createOwner,
  createScopedSession,
  createWrongTargetCall,
} from '../framework/fixtures'
import {
  executeIntent,
  expectCompletedOperation,
  expectNoFailedOperations,
  expectOutcome,
} from '../framework/runner'

describe.sequential('SDK integration ssx', () => {
  test('enables and uses a scoped smart session inline', async () => {
    const sdk = createIntegrationSDK()
    const owner = createOwner()
    const sessionOwner = createOwner()
    const account = await sdk.createAccount({
      owners: { type: 'ecdsa', accounts: [owner] },
      experimental_sessions: { enabled: true },
    })
    const session = createScopedSession({
      chain: sourceChain,
      owner: sessionOwner,
    })
    const sessionDetails = await account.experimental_getSessionDetails([
      session,
    ])
    const enableSignature =
      await account.experimental_signEnableSession(sessionDetails)

    await expectNotDeployed(account, sourceChain)
    await expectSessionDisabled(account, session)

    const execution = await executeIntent({
      account,
      label: 'ssx/scoped-inline-enable/success',
      transaction: {
        chain: sourceChain,
        sponsored: true,
        calls: [createNoopCall()],
        signers: {
          type: 'experimental_session',
          session,
          enableData: {
            userSignature: enableSignature,
            hashesAndChainIds: sessionDetails.hashesAndChainIds,
            sessionToEnableIndex: 0,
          },
        },
      },
    })

    expectOutcome(execution, { kind: 'success' })
    if (execution.phase !== 'success') return

    expectNoFailedOperations(execution.status)
    expectCompletedOperation(execution.status, sourceChain.id)
    await expectDeployed(account, sourceChain)
    await expectSessionEnabled(account, session)
  })

  test('rejects a session-signed call with wrong selector', async () => {
    const sdk = createIntegrationSDK()
    const owner = createOwner()
    const sessionOwner = createOwner()
    const account = await sdk.createAccount({
      owners: { type: 'ecdsa', accounts: [owner] },
      experimental_sessions: { enabled: true },
    })
    const session = createScopedSession({
      chain: sourceChain,
      owner: sessionOwner,
    })
    const sessionDetails = await account.experimental_getSessionDetails([
      session,
    ])
    const enableSignature =
      await account.experimental_signEnableSession(sessionDetails)

    await expectSessionDisabled(account, session)

    const execution = await executeIntent({
      account,
      label: 'ssx/wrong-selector/submit-error',
      transaction: {
        chain: sourceChain,
        sponsored: true,
        calls: [createOutOfScopeCall()],
        signers: {
          type: 'experimental_session',
          session,
          enableData: {
            userSignature: enableSignature,
            hashesAndChainIds: sessionDetails.hashesAndChainIds,
            sessionToEnableIndex: 0,
          },
        },
      },
    })

    expectOutcome(execution, {
      kind: 'submit-error',
      error: ValidationError,
      code: 'VALIDATION_ERROR',
    })
    await expectNotDeployed(account, sourceChain)
  })

  test('rejects a session-signed call with wrong target', async () => {
    const sdk = createIntegrationSDK()
    const owner = createOwner()
    const sessionOwner = createOwner()
    const account = await sdk.createAccount({
      owners: { type: 'ecdsa', accounts: [owner] },
      experimental_sessions: { enabled: true },
    })
    const session = createScopedSession({
      chain: sourceChain,
      owner: sessionOwner,
    })
    const sessionDetails = await account.experimental_getSessionDetails([
      session,
    ])
    const enableSignature =
      await account.experimental_signEnableSession(sessionDetails)

    await expectSessionDisabled(account, session)

    const execution = await executeIntent({
      account,
      label: 'ssx/wrong-target/submit-error',
      transaction: {
        chain: sourceChain,
        sponsored: true,
        calls: [createWrongTargetCall()],
        signers: {
          type: 'experimental_session',
          session,
          enableData: {
            userSignature: enableSignature,
            hashesAndChainIds: sessionDetails.hashesAndChainIds,
            sessionToEnableIndex: 0,
          },
        },
      },
    })

    expectOutcome(execution, {
      kind: 'submit-error',
      error: ValidationError,
      code: 'VALIDATION_ERROR',
    })
    await expectNotDeployed(account, sourceChain)
  })

  test('uses a pre-enabled smart session without inline enable', async () => {
    const sdk = createIntegrationSDK()
    const owner = createOwner()
    const sessionOwner = createOwner()
    const account = await sdk.createAccount({
      owners: { type: 'ecdsa', accounts: [owner] },
      experimental_sessions: { enabled: true },
    })
    const session = createScopedSession({
      chain: sourceChain,
      owner: sessionOwner,
    })
    const sessionDetails = await account.experimental_getSessionDetails([
      session,
    ])
    const enableSignature =
      await account.experimental_signEnableSession(sessionDetails)

    await expectNotDeployed(account, sourceChain)
    await expectSessionDisabled(account, session)

    const enableExecution = await executeIntent({
      account,
      label: 'ssx/pre-enabled/enable',
      transaction: {
        chain: sourceChain,
        sponsored: true,
        calls: [createNoopCall()],
        signers: {
          type: 'experimental_session',
          session,
          enableData: {
            userSignature: enableSignature,
            hashesAndChainIds: sessionDetails.hashesAndChainIds,
            sessionToEnableIndex: 0,
          },
        },
      },
    })

    expectOutcome(enableExecution, { kind: 'success' })
    if (enableExecution.phase !== 'success') return

    expectNoFailedOperations(enableExecution.status)
    expectCompletedOperation(enableExecution.status, sourceChain.id)
    await expectDeployed(account, sourceChain)
    await expectSessionEnabled(account, session)

    const reuseExecution = await executeIntent({
      account,
      label: 'ssx/pre-enabled/reuse',
      transaction: {
        chain: sourceChain,
        sponsored: true,
        calls: [createNoopCall()],
        signers: {
          type: 'experimental_session',
          session,
        },
      },
    })

    expectOutcome(reuseExecution, { kind: 'success' })
    if (reuseExecution.phase !== 'success') return

    expectNoFailedOperations(reuseExecution.status)
    expectCompletedOperation(reuseExecution.status, sourceChain.id)
    await expectSessionEnabled(account, session)
  })
})
