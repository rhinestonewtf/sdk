import { describe, test } from 'vitest'
import { sourceChain, targetChain } from '../config/chains'
import { createIntegrationSDK } from '../config/environment'
import { expectDeployed, expectNotDeployed } from '../framework/assertions'
import { createNoopCall, createOwner } from '../framework/fixtures'
import {
  executeIntent,
  expectCompletedOperation,
  expectNoFailedOperations,
  expectNoOperationOnChain,
  expectOutcome,
} from '../framework/runner'

describe.sequential('SDK integration chain modes', () => {
  test('runs a sponsored same-chain intent on a fresh default account', async () => {
    const sdk = createIntegrationSDK()
    const owner = createOwner()
    const account = await sdk.createAccount({
      owners: { type: 'ecdsa', accounts: [owner] },
    })

    await expectNotDeployed(account, sourceChain)

    const execution = await executeIntent({
      account,
      label: 'chains/same-chain/fresh/sponsored',
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
      label: 'chains/cross-chain/fresh/sponsored',
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
})
