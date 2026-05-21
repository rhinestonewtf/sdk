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

describe.sequential('SDK integration account kinds', () => {
  test('runs a sponsored same-chain intent on a fresh Safe account', async () => {
    const sdk = createIntegrationSDK()
    const owner = createOwner()
    const account = await sdk.createAccount({
      account: { type: 'safe' },
      owners: { type: 'ecdsa', accounts: [owner] },
    })

    await expectNotDeployed(account, sourceChain)

    const execution = await executeIntent({
      account,
      label: 'accounts/safe/same-chain/fresh/sponsored',
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

  test('runs a sponsored same-chain intent on a fresh Kernel account', async () => {
    const sdk = createIntegrationSDK()
    const owner = createOwner()
    const account = await sdk.createAccount({
      account: { type: 'kernel' },
      owners: { type: 'ecdsa', accounts: [owner] },
    })

    await expectNotDeployed(account, sourceChain)

    const execution = await executeIntent({
      account,
      label: 'accounts/kernel/same-chain/fresh/sponsored',
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

  test('runs a sponsored same-chain intent on a fresh Startale account', async () => {
    const sdk = createIntegrationSDK()
    const owner = createOwner()
    const account = await sdk.createAccount({
      account: { type: 'startale' },
      owners: { type: 'ecdsa', accounts: [owner] },
    })

    await expectNotDeployed(account, sourceChain)

    const execution = await executeIntent({
      account,
      label: 'accounts/startale/same-chain/fresh/sponsored',
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

  test.todo(
    'runs a sponsored same-chain intent on a fresh EOA account',
    async () => {
      // EOA accounts are not yet supported on sponsored testnet routes.
      // The orchestrator returns UNPROCESSABLE_CONTENT with
      // "the account type is not supported for the available routes".
    },
  )

  test.todo(
    'runs a sponsored same-chain intent on a fresh Nexus 7702 account',
    async () => {
      // EIP-7702 on Base Sepolia hits a VALIDATION_ERROR:
      // "Invalid CAIP-2 chain id (expected string): 84532".
      // This looks like an orchestrator formatting bug for 7702 accounts.
      //
      // const sdk = createIntegrationSDK()
      // const owner = createOwner()
      // const eoa = createOwner()
      // const account = await sdk.createAccount({
      //   account: { type: 'nexus' },
      //   owners: { type: 'ecdsa', accounts: [owner] },
      //   eoa,
      // })
      // const eip7702InitSignature = await account.signEip7702InitData()
      // const execution = await executeIntent({
      //   account,
      //   label: 'accounts/nexus-7702/same-chain/fresh/sponsored',
      //   transaction: {
      //     chain: sourceChain,
      //     sponsored: true,
      //     calls: [createNoopCall()],
      //     eip7702InitSignature,
      //   },
      //   signAuthorizations: true,
      // })
      // expectOutcome(execution, { kind: 'success' })
    },
  )
})
