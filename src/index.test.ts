import { base } from 'viem/chains'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { accountA } from '../test/consts'
import type { SignData } from './orchestrator'
import type { SessionSignerSet } from './types'

const { mockGetTargetExecutionSignature, mockSignIntent } = vi.hoisted(() => ({
  mockGetTargetExecutionSignature: vi.fn(),
  mockSignIntent: vi.fn(),
}))

vi.mock('./execution/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./execution/utils')>()
  return {
    ...actual,
    getTargetExecutionSignature: mockGetTargetExecutionSignature,
    signIntent: mockSignIntent,
  }
})

const { RhinestoneSDK } = await import('.')

describe('RhinestoneSDK.createAccount', () => {
  beforeEach(() => {
    mockGetTargetExecutionSignature.mockReset()
    mockSignIntent.mockReset()
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
})
