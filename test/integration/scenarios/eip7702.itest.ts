import { describe, expect, test } from 'vitest'
import { ValidationError } from '../../../src/errors/index'
import { sourceChain } from '../config/chains'
import { createIntegrationSDK } from '../config/environment'
import { expectNotDeployed } from '../framework/assertions'
import { createNoopCall, createOwner } from '../framework/fixtures'
import { executeIntent, expectOutcome } from '../framework/runner'

describe.sequential('SDK integration eip7702', () => {
  test('rejects a missing delegation proof without deploying the account', async () => {
    const sdk = createIntegrationSDK()
    const owner = createOwner()
    const eoa = createOwner()
    const account = await sdk.createAccount({
      evm: {
        account: { type: 'nexus' },
        owners: { type: 'ecdsa', accounts: [owner] },
        eoa,
      },
    })
    await expectNotDeployed(account, sourceChain)
    const eip7702InitSignature = await account.signEip7702InitData()

    const execution = await executeIntent({
      account,
      label: 'eip7702/missing-authorization/submit-error',
      transaction: {
        destination: { chain: sourceChain, calls: [createNoopCall()] },
        sponsored: true,
        eip7702InitSignature,
      },
      transformSigned: (signed) => {
        expect(signed.proofs.some((proof) => proof.kind === 'eip7702')).toBe(
          true,
        )
        return {
          ...signed,
          proofs: signed.proofs.filter((proof) => proof.kind !== 'eip7702'),
        }
      },
    })

    expectOutcome(execution, {
      kind: 'submit-error',
      error: ValidationError,
      code: 'VALIDATION_ERROR',
    })
    if (
      execution.phase === 'submit' &&
      execution.error instanceof ValidationError
    ) {
      expect(execution.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            context: expect.objectContaining({ code: 'PROOF_COUNT_MISMATCH' }),
          }),
        ]),
      )
    }
    await expectNotDeployed(account, sourceChain)
  })
})
