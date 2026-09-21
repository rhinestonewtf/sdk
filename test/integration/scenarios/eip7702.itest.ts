import { describe, test } from 'vitest'
import { ValidationError } from '../../../src/errors/index'
import { sourceChain } from '../config/chains'
import { createIntegrationSDK } from '../config/environment'
import { expectNotDeployed } from '../framework/assertions'
import { createNoopCall, createOwner } from '../framework/fixtures'
import { executeIntent, expectOutcome } from '../framework/runner'

describe.sequential('SDK integration eip7702', () => {
  test('fails at submit when authorizations are not signed', async () => {
    const sdk = createIntegrationSDK()
    const owner = createOwner()
    const eoa = createOwner()
    const account = await sdk.createAccount({
      account: { type: 'nexus' },
      owners: { type: 'ecdsa', accounts: [owner] },
      eoa,
    })
    const eip7702InitSignature = await account.signEip7702InitData()

    const execution = await executeIntent({
      account,
      label: 'eip7702/missing-authorization/submit-error',
      transaction: {
        chain: sourceChain,
        sponsored: true,
        calls: [createNoopCall()],
        eip7702InitSignature,
      },
      signAuthorizations: false,
    })

    expectOutcome(execution, {
      kind: 'submit-error',
      error: ValidationError,
    })
    await expectNotDeployed(account, sourceChain)
  })
})
