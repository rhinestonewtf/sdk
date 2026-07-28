import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, test, vi } from 'vitest'
import { passkeyAccount } from '../../test/consts'
import {
  adaptSignerSelection,
  adaptUserOperationSignerSelection,
} from '../api/signer-selection'
import { toEvmChainReference } from '../chains/caip2'
import { createStaticAccountRuntime } from '../config/account-runtime'
import { resolveAccountConfig, resolveSdkConfig } from '../config/resolve'
import { resolveValidator } from '../modules/validators/resolve'
import { SOCIAL_RECOVERY_VALIDATOR_ADDRESS } from '../modules/validators/social-recovery'
import { buildUserOperationSigningPlanInput } from '../transactions/user-operations/prepare'
import {
  createAccountSigningContext,
  getAccountSignatureRoute,
} from './context'

const owner = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const guardian = privateKeyToAccount(`0x${'22'.repeat(32)}`)
const chain = toEvmChainReference(1)

describe('account signature routing', () => {
  test.each(['safe', 'nexus', 'kernel', 'startale'] as const)(
    'routes alternate passkey and MFA validators through the selected %s envelope',
    (kind) => {
      const sdk = resolveSdkConfig({ apiKey: 'test' })
      const account = resolveAccountConfig(sdk, {
        account: { type: kind },
        owners: { type: 'ecdsa', accounts: [owner] },
      })
      const runtime = createStaticAccountRuntime(account, chain, true)

      for (const signers of [
        {
          type: 'owner' as const,
          kind: 'passkey' as const,
          accounts: [passkeyAccount],
          module: `0x${'99'.repeat(20)}` as const,
        },
        {
          type: 'owner' as const,
          kind: 'multi-factor' as const,
          validators: [
            { type: 'ecdsa' as const, id: 1, accounts: [owner] },
            { type: 'passkey' as const, id: 2, accounts: [passkeyAccount] },
          ],
          module: `0x${'88'.repeat(20)}` as const,
        },
      ]) {
        const selection = adaptSignerSelection(account, signers)
        if (selection.kind !== 'owner') {
          throw new Error('Expected owner selection')
        }
        const context = createAccountSigningContext({
          runtime,
          purpose: 'erc1271',
          signerInvoker: { invoke: vi.fn() },
          selection,
        })
        const selectedValidator = resolveValidator(selection.validator).address
        const envelope = getAccountSignatureRoute(
          runtime,
          context,
        ).accountEnvelope

        expect(envelope).toMatchObject({ validator: selectedValidator })
        if (envelope.kind === 'kernel') expect(envelope.isRoot).toBe(false)
      }
    },
  )

  test.each(['safe', 'nexus', 'kernel', 'startale'] as const)(
    'routes guardian UserOperations to the social recovery validator on %s',
    (kind) => {
      const sdk = resolveSdkConfig({ apiKey: 'test' })
      const account = resolveAccountConfig(sdk, {
        account: { type: kind },
        owners: { type: 'ecdsa', accounts: [owner] },
        recovery: { guardians: [guardian] },
      })
      const runtime = createStaticAccountRuntime(account, chain, true)
      const selection = adaptUserOperationSignerSelection(account, {
        type: 'guardians',
        guardians: [guardian],
      })
      if (selection.kind !== 'owner')
        throw new Error('Expected owner selection')

      const context = createAccountSigningContext({
        runtime,
        purpose: 'user-operation',
        signerInvoker: { invoke: vi.fn() },
        selection,
      })

      // The nonce key is derived from this address, which is how the account
      // routes the UserOperation to the recovery validator instead of the owner.
      expect(context.validatorCapabilities.compatibilityKey.moduleAddress).toBe(
        SOCIAL_RECOVERY_VALIDATOR_ADDRESS,
      )

      // The module recovers over toEthSignedMessageHash and reads v as 27/28.
      // Offset-4 encoding would double-prefix and recover the wrong signer.
      expect(context.validatorCapabilities.recoveryEncoding).toBe('ethereum')
      const codec = context.validatorCapabilities.contributionCodec
      expect(codec).toMatchObject({
        kind: 'ordered-threshold',
        threshold: 1,
        recoveryEncoding: 'ethereum',
      })
    },
  )

  test('signs guardian UserOperations as a prefixed message, not typed data', () => {
    const sdk = resolveSdkConfig({ apiKey: 'test' })
    const account = resolveAccountConfig(sdk, {
      account: { type: 'nexus' },
      owners: { type: 'ecdsa', accounts: [owner] },
      recovery: { guardians: [guardian, owner], threshold: 2 },
    })
    const runtime = createStaticAccountRuntime(account, chain, true)
    const selection = adaptUserOperationSignerSelection(account, {
      type: 'guardians',
      guardians: [guardian, owner],
    })
    if (selection.kind !== 'owner') throw new Error('Expected owner selection')
    const context = createAccountSigningContext({
      runtime,
      purpose: 'user-operation',
      signerInvoker: { invoke: vi.fn() },
      selection,
    })

    const planInput = buildUserOperationSigningPlanInput(
      context,
      chain,
      `0x${'ab'.repeat(32)}`,
    )

    expect(planInput.tasks).toHaveLength(2)
    for (const task of planInput.tasks) {
      expect(task.invocationKind).toBe('ecdsa-sign-message')
    }
  })
})
