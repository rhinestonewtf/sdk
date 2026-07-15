import { base } from 'viem/chains'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { accountA } from '../test/consts'
import type { SignData } from './orchestrator'
import type { SessionSignerSet } from './types'

const {
  mockAssembleTransaction,
  mockGetTargetExecutionSignature,
  mockSignIntent,
  mockSignTransaction,
} = vi.hoisted(() => ({
  mockAssembleTransaction: vi.fn(),
  mockGetTargetExecutionSignature: vi.fn(),
  mockSignIntent: vi.fn(),
  mockSignTransaction: vi.fn(),
}))

vi.mock('./execution/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./execution/utils')>()
  return {
    ...actual,
    assembleTransaction: mockAssembleTransaction,
    getTargetExecutionSignature: mockGetTargetExecutionSignature,
    signIntent: mockSignIntent,
    signTransaction: mockSignTransaction,
  }
})

const { RhinestoneSDK } = await import('./index')

describe('RhinestoneSDK.createAccount', () => {
  beforeEach(() => {
    mockAssembleTransaction.mockReset()
    mockGetTargetExecutionSignature.mockReset()
    mockSignIntent.mockReset()
    mockSignTransaction.mockReset()
  })

  test('signIntent delegates to SDK intent signing utilities', async () => {
    const config = {
      owners: { type: 'ecdsa' as const, accounts: [accountA], threshold: 1 },
    }
    const signData = {
      origin: [],
      destination: {},
    } as unknown as SignData
    const signers = {
      type: 'experimental_session',
      session: {
        chain: base,
        owners: { type: 'ecdsa' as const, accounts: [accountA] },
      },
    } as unknown as SessionSignerSet

    mockSignIntent.mockResolvedValue({
      originSignatures: ['0x11'],
      destinationSignature: '0x22',
    })
    mockGetTargetExecutionSignature.mockResolvedValue('0x33')

    const sdk = new RhinestoneSDK({
      auth: { mode: 'apiKey', apiKey: 'test' },
    })
    const account = await sdk.createAccount(config)
    const result = await account.signIntent(signData, base, signers)

    // Mirror the canonical signTransaction path: origin/destination always
    // signed in claim mode (targetExecution=false), target-exec sig separate.
    expect(mockSignIntent).toHaveBeenCalledWith(
      expect.objectContaining(config),
      signData,
      base,
      signers,
      false,
    )
    expect(mockGetTargetExecutionSignature).toHaveBeenCalledWith(
      expect.objectContaining(config),
      signData,
      base,
      signers,
    )
    expect(result).toEqual({
      originSignatures: ['0x11'],
      destinationSignature: '0x22',
      targetExecutionSignature: '0x33',
    })
  })

  test('independent signing and assembly delegate to execution utilities', async () => {
    const config = {
      owners: { type: 'ecdsa' as const, accounts: [accountA], threshold: 1 },
    }
    const prepared = { quotes: {} } as never
    const ownerSignature = { intentId: 'intent', kind: 'ecdsa' } as never
    const signedTransaction = { quote: {} } as never
    mockSignTransaction.mockResolvedValue(ownerSignature)
    mockAssembleTransaction.mockResolvedValue(signedTransaction)

    const sdk = new RhinestoneSDK({
      auth: { mode: 'apiKey', apiKey: 'test' },
    })
    const account = await sdk.createAccount(config)

    await expect(
      account.signTransaction(prepared, { owner: accountA }),
    ).resolves.toBe(ownerSignature)
    await expect(
      account.assembleTransaction(prepared, [ownerSignature]),
    ).resolves.toBe(signedTransaction)
    expect(mockSignTransaction).toHaveBeenCalledWith(
      expect.objectContaining(config),
      prepared,
      { owner: accountA },
    )
    expect(mockAssembleTransaction).toHaveBeenCalledWith(
      expect.objectContaining(config),
      prepared,
      [ownerSignature],
    )
  })
})
