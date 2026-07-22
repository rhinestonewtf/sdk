import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, test, vi } from 'vitest'
import { passkeyAccount } from '../../test/consts'
import { adaptSignerSelection } from '../api/signer-selection'
import { toEvmChainReference } from '../chains/caip2'
import { createStaticAccountRuntime } from '../config/account-runtime'
import { resolveAccountConfig, resolveSdkConfig } from '../config/resolve'
import { resolveValidator } from '../modules/validators/resolve'
import {
  createAccountSigningContext,
  getAccountSignatureRoute,
} from './context'

const owner = privateKeyToAccount(`0x${'11'.repeat(32)}`)
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
})
