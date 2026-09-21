import { describe, test } from 'vitest'
import { sourceChain } from '../config/chains'
import { createIntegrationSDK } from '../config/environment'
import { expectDeployed, expectNotDeployed } from '../framework/assertions'
import { createNoopCall, createOwner } from '../framework/fixtures'
import {
  executeIntent,
  expectCompletedOperation,
  expectNoFailedOperations,
  expectOutcome,
} from '../framework/runner'

// Each account type's factory/init encoding is exercised by deploying and
// running a sponsored same-chain intent on a fresh account.
describe.sequential('SDK integration account kinds', () => {
  for (const type of ['safe', 'kernel', 'startale'] as const) {
    test(`runs a sponsored same-chain intent on a fresh ${type} account`, async () => {
      const sdk = createIntegrationSDK()
      const account = await sdk.createAccount({
        account: { type },
        owners: { type: 'ecdsa', accounts: [createOwner()] },
      })

      await expectNotDeployed(account, sourceChain)

      const execution = await executeIntent({
        account,
        label: `accounts/${type}/same-chain/fresh`,
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
      await expectDeployed(account, sourceChain)
    })
  }

  test.todo('runs a sponsored same-chain intent on a fresh EOA account', () => {
    // EOA accounts are not yet supported on sponsored testnet routes. The
    // orchestrator returns UNPROCESSABLE_CONTENT with "the account type is
    // not supported for the available routes".
  })

  test('runs a sponsored same-chain intent on a fresh Nexus 7702 account', async () => {
    const sdk = createIntegrationSDK()
    const account = await sdk.createAccount({
      account: { type: 'nexus' },
      owners: { type: 'ecdsa', accounts: [createOwner()] },
      eoa: createOwner(),
    })
    const eip7702InitSignature = await account.signEip7702InitData()

    const execution = await executeIntent({
      account,
      label: 'accounts/nexus-7702/same-chain/fresh',
      signAuthorizations: true,
      transaction: {
        chain: sourceChain,
        sponsored: true,
        calls: [createNoopCall()],
        eip7702InitSignature,
      },
    })

    expectOutcome(execution, { kind: 'success' })
    if (execution.phase !== 'success') return

    expectNoFailedOperations(execution.status)
    expectCompletedOperation(execution.status, sourceChain.id)
  })
})
