import { base } from 'viem/chains'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { accountA } from '../test/consts'
import type { IntentOp } from './orchestrator'
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

const { createRhinestoneAccount } = await import('.')

describe('createRhinestoneAccount', () => {
  beforeEach(() => {
    mockGetTargetExecutionSignature.mockReset()
    mockSignIntent.mockReset()
  })

  test('signIntent delegates to SDK intent signing utilities', async () => {
    const config = {
      owners: { type: 'ecdsa' as const, accounts: [accountA], threshold: 1 },
    }
    const intentOp = { elements: [] } as unknown as IntentOp
    const signers = {
      type: 'experimental_session',
      session: {
        chain: base,
        owners: { type: 'ecdsa' as const, accounts: [accountA] },
        actions: [],
      },
      verifyExecutions: true,
    } satisfies SessionSignerSet

    mockSignIntent.mockResolvedValue({
      originSignatures: ['0x11'],
      destinationSignature: '0x22',
    })
    mockGetTargetExecutionSignature.mockResolvedValue('0x33')

    const account = await createRhinestoneAccount(config)
    const result = await account.signIntent(intentOp, base, signers, {
      targetExecution: true,
    })

    // Keep headless integrations on the canonical SDK SmartSession signer.
    expect(mockSignIntent).toHaveBeenCalledWith(
      config,
      intentOp,
      base,
      signers,
      true,
    )
    expect(mockGetTargetExecutionSignature).toHaveBeenCalledWith(
      config,
      intentOp,
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
