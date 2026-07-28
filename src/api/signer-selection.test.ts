import { encodeAbiParameters } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, test } from 'vitest'
import { passkeyAccount } from '../../test/consts'
import { resolveAccountConfig, resolveSdkConfig } from '../config/resolve'
import { SignerNotSupportedError } from '../errors/execution'
import { resolveValidator } from '../modules/validators/resolve'
import { ecdsaSignerId } from '../modules/validators/signer-id'
import { SOCIAL_RECOVERY_VALIDATOR_ADDRESS } from '../modules/validators/social-recovery'
import {
  adaptSignerSelection,
  adaptUserOperationSignerSelection,
} from './signer-selection'

const first = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const second = privateKeyToAccount(`0x${'22'.repeat(32)}`)

function account(owners: Parameters<typeof resolveAccountConfig>[1]['owners']) {
  const sdk = resolveSdkConfig({ apiKey: 'test' })
  return resolveAccountConfig(sdk, { account: { type: 'safe' }, owners })
}

describe('public signer selection adapter', () => {
  test('retains configured owner order and threshold while selecting a subset', () => {
    const configuredModule = `0x${'33'.repeat(20)}` as const
    const selected = adaptSignerSelection(
      account({
        type: 'ecdsa',
        accounts: [first, second],
        threshold: 2,
        module: configuredModule,
      }),
      {
        type: 'owner',
        kind: 'ecdsa',
        accounts: [second],
        module: `0x${'44'.repeat(20)}`,
      },
    )

    expect(selected.kind).toBe('owner')
    if (selected.kind !== 'owner') throw new Error('Expected owner selection')
    expect(selected.signerIds).toEqual([ecdsaSignerId(second)])
    expect(selected.validator).toMatchObject({
      kind: 'ecdsa',
      threshold: 2,
      module: { source: 'explicit', address: configuredModule },
      owners: [
        { signerId: ecdsaSignerId(first) },
        { signerId: ecdsaSignerId(second), account: second },
      ],
    })
  })

  test('creates the selected passkey validator with its module', () => {
    const module = `0x${'55'.repeat(20)}` as const
    const selected = adaptSignerSelection(
      account({ type: 'ecdsa', accounts: [first] }),
      {
        type: 'owner',
        kind: 'passkey',
        accounts: [passkeyAccount],
        module,
      },
    )

    expect(selected.kind).toBe('owner')
    if (selected.kind !== 'owner') throw new Error('Expected owner selection')
    expect(selected.validator).toMatchObject({
      kind: 'passkey',
      threshold: 1,
      module: { source: 'explicit', address: module },
    })
  })

  test('preserves explicit multi-factor IDs and module selection', () => {
    const module = `0x${'33'.repeat(20)}` as const
    const selected = adaptSignerSelection(
      account({ type: 'ecdsa', accounts: [first] }),
      {
        type: 'owner',
        kind: 'multi-factor',
        module,
        validators: [
          { type: 'ecdsa', id: 7, accounts: [first] },
          { type: 'ecdsa', id: '0x08', accounts: [second] },
        ],
      },
    )

    expect(selected.kind).toBe('owner')
    if (
      selected.kind !== 'owner' ||
      selected.validator.kind !== 'multi-factor'
    ) {
      throw new Error('Expected multi-factor owner selection')
    }
    expect(selected.validator.module).toEqual({
      source: 'explicit',
      address: module,
    })
    expect(
      selected.validator.validators.map(({ publicId }) => publicId),
    ).toEqual([7, '0x08'])
  })

  test('pins guardians to the social recovery validator', () => {
    const selected = adaptUserOperationSignerSelection(
      account({ type: 'ecdsa', accounts: [first] }),
      { type: 'guardians', guardians: [first, second] },
    )

    expect(selected.kind).toBe('owner')
    if (selected.kind !== 'owner') throw new Error('Expected owner selection')
    expect(selected.signerIds).toEqual([
      ecdsaSignerId(first),
      ecdsaSignerId(second),
    ])
    // Threshold matches the guardian count: the validator reads exactly
    // `threshold` signatures, so every supplied guardian has to sign.
    expect(selected.validator).toMatchObject({
      kind: 'ecdsa',
      threshold: 2,
      module: {
        source: 'explicit',
        address: SOCIAL_RECOVERY_VALIDATOR_ADDRESS,
      },
    })
  })

  test('resolves the guardian validator to the audited module with sorted guardians', () => {
    const selected = adaptUserOperationSignerSelection(
      account({ type: 'ecdsa', accounts: [first] }),
      { type: 'guardians', guardians: [second, first] },
    )
    if (selected.kind !== 'owner') throw new Error('Expected owner selection')
    const module = resolveValidator(selected.validator)

    expect(module.address).toBe(SOCIAL_RECOVERY_VALIDATOR_ADDRESS)
    const sorted = [first, second]
      .map((entry) => entry.address.toLowerCase())
      .sort()
    expect(module.initData.toLowerCase()).toBe(
      encodeAbiParameters(
        [
          { name: 'threshold', type: 'uint256' },
          { name: 'owners', type: 'address[]' },
        ],
        [2n, sorted as `0x${string}`[]],
      ).toLowerCase(),
    )
  })

  test('rejects guardians outside the UserOperation flow', () => {
    const configured = account({ type: 'ecdsa', accounts: [first] })
    // The social recovery validator reverts on isValidSignatureWithSender and
    // never validates intents, so these paths must fail loudly.
    expect(() =>
      adaptSignerSelection(configured, {
        type: 'guardians',
        guardians: [first],
      }),
    ).toThrow(SignerNotSupportedError)
  })

  test('rejects an empty guardian set', () => {
    expect(() =>
      adaptUserOperationSignerSelection(
        account({ type: 'ecdsa', accounts: [first] }),
        { type: 'guardians', guardians: [] },
      ),
    ).toThrow('at least one guardian')
  })

  test('projects per-chain Smart Session selections without dropping enable data', () => {
    const session = {
      chain: { id: 1 },
      permissionId: `0x${'44'.repeat(32)}`,
    } as never
    const enableData = {
      userSignature: '0x12' as const,
      hashesAndChainIds: [] as never[],
      sessionToEnableIndex: 0,
    }
    const selected = adaptSignerSelection(
      account({ type: 'ecdsa', accounts: [first] }),
      {
        type: 'session',
        sessions: { 1: { session, enableData } },
      },
    )

    expect(selected).toEqual({
      kind: 'smart-session',
      byChain: { 1: { session, enableData } },
    })
  })
})
