import { zeroAddress } from 'viem'
import { arbitrum, base, mainnet, optimism } from 'viem/chains'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { accountA } from '../../test/consts'
import type { IntentInput } from '../orchestrator/types'
import type { SessionSignerSet } from '../types'
import {
  hashErc7739TypedDataForSolady,
  prepareTransactionAsIntent,
  resolveSessionForChain,
} from './utils'

const mockGetIntentRoute = vi.fn()

vi.mock('../orchestrator', () => ({
  getOrchestrator: () => ({
    getIntentRoute: mockGetIntentRoute,
  }),
}))

describe('hashErc7739TypedDataForSolady', () => {
  const verifierDomain = {
    name: 'Startale',
    version: '1.0.0',
    chainId: 421614,
    verifyingContract:
      '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as `0x${string}`,
    salt: '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
  }

  test('simple typed data', () => {
    const hash = hashErc7739TypedDataForSolady({
      domain: {
        name: 'TestApp',
        version: '1',
        chainId: 421614,
        verifyingContract: '0x1234567890abcdef1234567890abcdef12345678',
      },
      types: {
        Greeting: [
          { name: 'text', type: 'string' },
          { name: 'value', type: 'uint256' },
        ],
      },
      primaryType: 'Greeting',
      message: {
        text: 'Hello',
        value: 42n,
      },
      verifierDomain,
    })
    expect(hash).toEqual(
      '0xacd2d65e9986501bb617b90505f4b527ee4eac3c29ac4fea21bb74d8e754e61b',
    )
  })

  test('nested types', () => {
    const hash = hashErc7739TypedDataForSolady({
      domain: {
        name: 'TestApp',
        version: '1',
        chainId: 84532,
        verifyingContract: '0x1234567890abcdef1234567890abcdef12345678',
      },
      types: {
        Order: [
          { name: 'sender', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'detail', type: 'Detail' },
        ],
        Detail: [
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      primaryType: 'Order',
      message: {
        sender: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        amount: 1000000n,
        detail: {
          nonce: 1n,
          deadline: 1700000000n,
        },
      },
      verifierDomain: {
        ...verifierDomain,
        chainId: 84532,
      },
    })
    expect(hash).toEqual(
      '0x1ea8d31e9198ac601c92ab8f54b7ff1ff41a7d4956566c1a0825a5ade5d5d045',
    )
  })

  test('different verifier chainId produces different hash', () => {
    const params = {
      domain: {
        name: 'TestApp',
        version: '1',
        chainId: 421614,
        verifyingContract:
          '0x1234567890abcdef1234567890abcdef12345678' as `0x${string}`,
      },
      types: {
        Greeting: [
          { name: 'text', type: 'string' },
          { name: 'value', type: 'uint256' },
        ],
      },
      primaryType: 'Greeting',
      message: {
        text: 'Hello',
        value: 42n,
      },
    }

    const hashSameChain = hashErc7739TypedDataForSolady({
      ...params,
      verifierDomain,
    })
    const hashCrossChain = hashErc7739TypedDataForSolady({
      ...params,
      verifierDomain: {
        ...verifierDomain,
        chainId: 84532,
      },
    })

    expect(hashSameChain).not.toEqual(hashCrossChain)
    expect(hashCrossChain).toEqual(
      '0x685f60853ef1d5fcbb3021db370b6f3c1c099f1fb42f08f9ba4e6b9b7c8c941a',
    )
  })
})

describe('prepareTransactionAsIntent', () => {
  beforeEach(() => {
    mockGetIntentRoute.mockReset()
  })

  test('includes auxiliaryFunds in options when provided', async () => {
    const auxiliaryFunds = {
      [arbitrum.id]: {
        '0xaf88d065e77c8cC2239327C5EDb3A432268e5831': 500000000n,
      } as Record<`0x${string}`, bigint>,
    }

    mockGetIntentRoute.mockResolvedValue({
      intentOp: {},
      intentCost: {},
    })

    await prepareTransactionAsIntent(
      {
        owners: { type: 'ecdsa', accounts: [accountA], threshold: 1 },
        apiKey: 'test',
      },
      [arbitrum],
      base,
      [],
      undefined,
      [{ address: zeroAddress, amount: 1n }],
      undefined,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      auxiliaryFunds,
      undefined,
      undefined,
    )

    expect(mockGetIntentRoute).toHaveBeenCalledOnce()
    const intentInput: IntentInput = mockGetIntentRoute.mock.calls[0][0]
    expect(intentInput.options.auxiliaryFunds).toEqual(auxiliaryFunds)
  })

  test('does not include auxiliaryFunds in options when not provided', async () => {
    mockGetIntentRoute.mockResolvedValue({
      intentOp: {},
      intentCost: {},
    })

    await prepareTransactionAsIntent(
      {
        owners: { type: 'ecdsa', accounts: [accountA], threshold: 1 },
        apiKey: 'test',
      },
      [arbitrum],
      base,
      [],
      undefined,
      [{ address: zeroAddress, amount: 1n }],
      undefined,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    )

    expect(mockGetIntentRoute).toHaveBeenCalledOnce()
    const intentInput: IntentInput = mockGetIntentRoute.mock.calls[0][0]
    expect(intentInput.options.auxiliaryFunds).toBeUndefined()
  })
})

const makeSession = (chainId: number) => ({
  chain: { id: chainId } as any,
  owners: {
    type: 'ecdsa' as const,
    accounts: [accountA],
    threshold: 1,
  },
})

describe('resolveSessionForChain', () => {
  test('single session returns session for any chain', () => {
    const signers: SessionSignerSet = {
      type: 'experimental_session',
      session: makeSession(mainnet.id),
    }
    const result = resolveSessionForChain(signers, optimism.id)
    expect(result).toBeDefined()
    expect(result!.session).toBe(signers.session)
  })

  test('single session with enableData returns enableData', () => {
    const enableData = {
      userSignature: '0x00' as `0x${string}`,
      hashesAndChainIds: [],
      sessionToEnableIndex: 0,
    }
    const signers: SessionSignerSet = {
      type: 'experimental_session',
      session: makeSession(mainnet.id),
      enableData,
    }
    const result = resolveSessionForChain(signers, mainnet.id)
    expect(result!.enableData).toBe(enableData)
  })

  test('per-chain sessions returns correct session per chain', () => {
    const mainnetSession = makeSession(mainnet.id)
    const optimismSession = makeSession(optimism.id)
    const signers: SessionSignerSet = {
      type: 'experimental_session',
      sessions: {
        [mainnet.id]: { session: mainnetSession },
        [optimism.id]: { session: optimismSession },
      },
    }
    expect(resolveSessionForChain(signers, mainnet.id).session).toBe(
      mainnetSession,
    )
    expect(resolveSessionForChain(signers, optimism.id).session).toBe(
      optimismSession,
    )
  })

  test('per-chain sessions throws for missing chain', () => {
    const signers: SessionSignerSet = {
      type: 'experimental_session',
      sessions: {
        [mainnet.id]: { session: makeSession(mainnet.id) },
      },
    }
    expect(() => resolveSessionForChain(signers, optimism.id)).toThrow(
      `No session configured for chain ${optimism.id}`,
    )
  })
})
