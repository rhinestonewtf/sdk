import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, test } from 'vitest'
import { passkeyAccount } from '../../test/consts'
import { resolveAccountConfig, resolveSdkConfig } from '../config/resolve'
import { ecdsaSignerId } from '../modules/validators/signer-id'
import { adaptSignerSelection } from './signer-selection'

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
