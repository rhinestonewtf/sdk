import { describe, test } from 'vitest'
import { sourceChain } from '../config/chains'
import { createIntegrationSDK } from '../config/environment'
import { expectNotDeployed } from '../framework/assertions'
import { createNoopCall, createOwner } from '../framework/fixtures'
import { executeIntent, expectOutcome } from '../framework/runner'

describe.sequential('SDK integration failures', () => {
  test('reports unsupported route for fake token', async () => {
    const sdk = createIntegrationSDK()
    const owner = createOwner()
    const account = await sdk.createAccount({
      owners: { type: 'ecdsa', accounts: [owner] },
    })

    const execution = await executeIntent({
      account,
      label: 'failures/unsupported-route/fake-token',
      transaction: {
        chain: sourceChain,
        sponsored: true,
        calls: [createNoopCall()],
        tokenRequests: [
          {
            address: '0x000000000000000000000000000000000000dead',
            amount: 1_000_000n,
          },
        ],
      },
    })

    expectOutcome(execution, {
      kind: 'prepare-error',
      code: 'UNPROCESSABLE_CONTENT',
    })
    await expectNotDeployed(account, sourceChain)
  })
})
