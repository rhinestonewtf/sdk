import { describe, test } from 'vitest'
import { ValidationError } from '../../../src/errors/index'
import { sourceChain, targetChain } from '../config/chains'
import { createIntegrationSDK } from '../config/environment'
import {
  expectDeployed,
  expectNotDeployed,
  expectSessionDisabled,
  expectSessionEnabled,
} from '../framework/assertions'
import {
  createNoopCall,
  createOwner,
  createScopedSession,
  createUnfundedUsdcTransferCall,
} from '../framework/fixtures'
import {
  executeIntent,
  expectCompletedOperation,
  expectNoFailedOperations,
  expectNoOperationOnChain,
  expectOutcome,
} from '../framework/runner'

describe.sequential('SDK integration smoke', () => {
  test('runs a sponsored same-chain intent on a fresh default account', async () => {
    const sdk = createIntegrationSDK()
    const owner = createOwner()
    const account = await sdk.createAccount({
      owners: { type: 'ecdsa', accounts: [owner] },
    })

    await expectNotDeployed(account, sourceChain)

    const execution = await executeIntent({
      account,
      label: 'smoke/same-chain/fresh/sponsored',
      transaction: {
        chain: sourceChain,
        sponsored: true,
        calls: [createNoopCall()],
      },
    })

    expectOutcome(execution, { kind: 'success' })
    if (execution.phase !== 'success') return

    expectNoFailedOperations(execution.status)
    expectCompletedOperation(execution.status, sourceChain.id)
    expectNoOperationOnChain(execution.status, targetChain.id)
    await expectDeployed(account, sourceChain)
  })

  test('runs a sponsored cross-chain intent on a fresh default account', async () => {
    const sdk = createIntegrationSDK()
    const owner = createOwner()
    const account = await sdk.createAccount({
      owners: { type: 'ecdsa', accounts: [owner] },
    })

    await expectNotDeployed(account, targetChain)

    const execution = await executeIntent({
      account,
      label: 'smoke/cross-chain/fresh/sponsored',
      transaction: {
        sourceChains: [sourceChain],
        targetChain,
        sponsored: true,
        calls: [createNoopCall()],
      },
    })

    expectOutcome(execution, { kind: 'success' })
    if (execution.phase !== 'success') return

    expectNoFailedOperations(execution.status)
    expectCompletedOperation(execution.status, targetChain.id)
    await expectDeployed(account, targetChain)
  })

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

    await expectSessionDisabled(account, session)

    const execution = await executeIntent({
      account,
      label: 'smoke/ssx/scoped-inline-enable',
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
    await expectSessionEnabled(account, session)
  })

  test('reports simulation failure during submit without deploying', async () => {
    const sdk = createIntegrationSDK()
    const owner = createOwner()
    const account = await sdk.createAccount({
      owners: { type: 'ecdsa', accounts: [owner] },
    })

    const execution = await executeIntent({
      account,
      label: 'smoke/simulation-failure/unfunded-usdc-transfer',
      transaction: {
        chain: sourceChain,
        sponsored: true,
        calls: [createUnfundedUsdcTransferCall(sourceChain)],
      },
    })

    expectOutcome(execution, {
      kind: 'submit-error',
      error: ValidationError,
      code: 'VALIDATION_ERROR',
      message: 'Bundle simulation failed',
    })
    await expectNotDeployed(account, sourceChain)
  })

  test('runs a sponsored same-chain intent on a deployed account', async () => {
    const sdk = createIntegrationSDK()
    const owner = createOwner()
    const account = await sdk.createAccount({
      owners: { type: 'ecdsa', accounts: [owner] },
    })

    await expectNotDeployed(account, sourceChain)

    const deployExecution = await executeIntent({
      account,
      label: 'smoke/same-chain/deployed/deploy',
      transaction: {
        chain: sourceChain,
        sponsored: true,
        calls: [createNoopCall()],
      },
    })

    expectOutcome(deployExecution, { kind: 'success' })
    if (deployExecution.phase !== 'success') return

    expectNoFailedOperations(deployExecution.status)
    expectCompletedOperation(deployExecution.status, sourceChain.id)
    await expectDeployed(account, sourceChain)

    const reuseExecution = await executeIntent({
      account,
      label: 'smoke/same-chain/deployed/reuse',
      transaction: {
        chain: sourceChain,
        sponsored: true,
        calls: [createNoopCall()],
      },
    })

    expectOutcome(reuseExecution, { kind: 'success' })
    if (reuseExecution.phase !== 'success') return

    expectNoFailedOperations(reuseExecution.status)
    expectCompletedOperation(reuseExecution.status, sourceChain.id)
  })
})
