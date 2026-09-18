import type { Address } from 'viem'
import { describe, expect, test } from 'vitest'
import {
  asIntentRecipient,
  type IntentAccountProjection,
  projectIntentRecipient,
  toNormalizedAccount,
  toNormalizedRecipient,
  toWireEvmAccount,
  toWireRecipient,
} from './account'

const ACCOUNT = '0x0000000000000000000000000000000000000010' as Address
const FACTORY = '0x0000000000000000000000000000000000000020' as Address
const DELEGATE = '0x0000000000000000000000000000000000000030' as Address

const smart: IntentAccountProjection = {
  kind: 'erc7579',
  address: ACCOUNT,
  setupOps: [{ to: FACTORY, data: '0xdeadbeef' }],
}
const eoa: IntentAccountProjection = {
  kind: 'eoa',
  address: ACCOUNT,
  setupOps: [],
}

describe('toWireEvmAccount', () => {
  test('omits initData for a deployed smart account with no setup ops', () => {
    expect(toWireEvmAccount({ ...smart, setupOps: [] })).toEqual({
      type: 'erc7579',
      address: ACCOUNT,
    })
  })

  // A true EOA permits neither setup operations nor simulation stubs, so
  // neither is sent even when the caller supplies them.
  test('sends a bare EOA with no setup or simulation', () => {
    expect(
      toWireEvmAccount(eoa, {
        signatureMode: 1,
        mockSignaturesByChain: { 'eip155:1': '0xaa' },
      }),
    ).toEqual({ type: 'eoa', address: ACCOUNT, signatureMode: 1 })
  })

  test('carries a delegation on an EOA', () => {
    expect(
      toWireEvmAccount({ ...eoa, delegationContract: DELEGATE }),
    ).toMatchObject({ delegations: { default: { contract: DELEGATE } } })
  })

  test('omits signatureMode when the caller sets none', () => {
    expect(toWireEvmAccount(smart)).not.toHaveProperty('signatureMode')
  })
})

describe('toWireRecipient', () => {
  // A bare address is a payee and nothing more. Labelling it as an account
  // would read on the wire as "this recipient can execute" — it cannot.
  test('sends a bare payee with no account type', () => {
    expect(toWireRecipient({ kind: 'bare', address: ACCOUNT })).toEqual({
      address: ACCOUNT,
    })
  })

  test('keeps a configured EOA recipient an EOA', () => {
    expect(
      toWireRecipient(
        asIntentRecipient({ ...eoa, delegationContract: DELEGATE }),
      ),
    ).toEqual({
      type: 'eoa',
      address: ACCOUNT,
      delegations: { default: { contract: DELEGATE } },
    })
  })

  test('keeps a configured smart-account recipient and its setup ops', () => {
    expect(toWireRecipient(asIntentRecipient(smart))).toEqual({
      type: 'erc7579',
      address: ACCOUNT,
      initData: { setupOps: [{ to: FACTORY, data: '0xdeadbeef' }] },
    })
  })

  test('omits initData for a deployed smart-account recipient', () => {
    expect(
      toWireRecipient(asIntentRecipient({ ...smart, setupOps: [] })),
    ).toEqual({ type: 'erc7579', address: ACCOUNT })
  })
})

describe('normalized projections', () => {
  // The key is always present — `undefined` for a non-7702 account — because
  // that is the shape existing sponsorship digests were computed over.
  test('always carries the delegations key', () => {
    expect(toNormalizedAccount(smart)).toEqual({
      address: ACCOUNT,
      accountType: 'ERC7579',
      setupOps: [{ to: FACTORY, data: '0xdeadbeef' }],
      delegations: undefined,
    })
    expect(
      toNormalizedAccount({ ...smart, delegationContract: DELEGATE })
        .delegations,
    ).toEqual({ 0: { contract: DELEGATE } })
  })

  test('maps an EOA to its historical account type', () => {
    expect(toNormalizedAccount(eoa).accountType).toBe('EOA')
  })

  test('carries session mock signatures keyed by decimal chain id', () => {
    expect(
      toNormalizedAccount(smart, { mockSignatures: { 1: '0xaa' } })
        .mockSignatures,
    ).toEqual({ 1: '0xaa' })
  })

  test('projects a bare recipient as an address alone', () => {
    expect(toNormalizedRecipient({ kind: 'bare', address: ACCOUNT })).toEqual({
      address: ACCOUNT,
    })
  })

  test('projects a configured recipient like an account', () => {
    expect(toNormalizedRecipient(asIntentRecipient(smart))).toMatchObject({
      address: ACCOUNT,
      accountType: 'ERC7579',
    })
  })
})

describe('projectIntentRecipient', () => {
  test('returns undefined for an absent recipient', () => {
    expect(projectIntentRecipient(undefined)).toBeUndefined()
  })

  test('wraps an address as a bare payee', () => {
    expect(projectIntentRecipient(ACCOUNT)).toEqual({
      kind: 'bare',
      address: ACCOUNT,
    })
  })
})
