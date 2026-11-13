import { zeroAddress } from 'viem'
import { arbitrum, base, mainnet, optimism, sepolia } from 'viem/chains'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { accountA } from '../../test/consts'
import { createAuthProvider } from '../auth/provider'
import * as validators from '../modules/validators'
import {
  DUMMY_PRECLAIMOP_SELECTOR,
  DUMMY_PRECLAIMOP_TARGET,
} from '../modules/validators'
import { zeroEx } from '../modules/validators/smart-sessions'
import recordedQuotes from '../orchestrator/__fixtures__/quote-responses.json'
import { Orchestrator } from '../orchestrator/client'
import {
  type IntentInput,
  SIG_MODE_EMISSARY_EXECUTION_ERC1271,
  SIG_MODE_ERC1271,
} from '../orchestrator/types'
import { convertBigIntFields } from '../orchestrator/utils'
import { type BlancRoute, quoteFromBlanc } from '../orchestrator/wire-quote'
import type { RhinestoneConfig, SessionSignerSet, SignerSet } from '../types'
import { OrderPathRequiredForIntentsError } from './error'
import {
  hashErc7739TypedDataForSolady,
  parseCalls,
  prepareTransaction,
  prepareTransactionAsIntent,
  resolveSessionForChain,
  resolveSignatureMode,
  signTransaction,
  submitTransaction,
} from './utils'

const mockCreateQuote = vi.fn()
const mockCreateIntent = vi.fn()

vi.mock('../orchestrator', () => ({
  getOrchestrator: () => ({
    createQuote: mockCreateQuote,
    createIntent: mockCreateIntent,
  }),
}))

const MOCK_PAYLOAD = {
  domain: { chainId: base.id },
  types: { Test: [{ name: 'value', type: 'uint256' }] },
  primaryType: 'Test',
  message: { value: 1n },
}
const MOCK_QUOTE = {
  intentId: '1',
  signData: { origin: [MOCK_PAYLOAD], destination: MOCK_PAYLOAD },
}

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

describe('parseCalls', () => {
  test('accepts a mis-checksummed call target', () => {
    const target = '0x035ae6188AC22ab79B5018039DFbDA4FFE7990e9'

    expect(parseCalls([{ to: target }], sepolia.id)).toEqual([
      {
        data: '0x',
        value: 0n,
        to: target,
      },
    ])
  })
})

describe('prepareTransactionAsIntent', () => {
  beforeEach(() => {
    mockCreateQuote.mockReset()
  })

  test('includes auxiliaryFunds in options when provided', async () => {
    const auxiliaryFunds = {
      [arbitrum.id]: {
        '0xaf88d065e77c8cC2239327C5EDb3A432268e5831': 500000000n,
      } as Record<`0x${string}`, bigint>,
    }

    mockCreateQuote.mockResolvedValue([MOCK_QUOTE])

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
      undefined,
    )

    expect(mockCreateQuote).toHaveBeenCalledOnce()
    const intentInput: IntentInput = mockCreateQuote.mock.calls[0][0]
    expect(intentInput.options.auxiliaryFunds).toEqual(auxiliaryFunds)
  })

  test('does not include auxiliaryFunds in options when not provided', async () => {
    mockCreateQuote.mockResolvedValue([MOCK_QUOTE])

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
      undefined,
    )

    expect(mockCreateQuote).toHaveBeenCalledOnce()
    const intentInput: IntentInput = mockCreateQuote.mock.calls[0][0]
    expect(intentInput.options.auxiliaryFunds).toBeUndefined()
  })

  test('forwards the public transaction quoter filter to the wire', async () => {
    mockCreateQuote.mockResolvedValue([MOCK_QUOTE])

    await prepareTransaction(
      {
        owners: { type: 'ecdsa', accounts: [accountA], threshold: 1 },
        apiKey: 'test',
      },
      {
        chain: base,
        quoters: { exclude: ['relay'] },
      },
    )

    const intentInput: IntentInput = mockCreateQuote.mock.calls[0][0]
    expect(intentInput.options.quoters).toEqual({ exclude: ['relay'] })
  })

  test('derives and narrows a session quoter filter on the wire', async () => {
    mockCreateQuote.mockResolvedValue([MOCK_QUOTE])
    const enabled = vi
      .spyOn(validators, 'isSessionEnabled')
      .mockResolvedValue(true)

    try {
      await prepareTransactionAsIntent(
        {
          owners: { type: 'ecdsa', accounts: [accountA], threshold: 1 },
          apiKey: 'test',
        },
        [base],
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
        {
          type: 'experimental_session',
          session: {
            chain: base,
            owners: { type: 'ecdsa', accounts: [accountA] },
            swap: {
              sell: {
                token: '0x1111111111111111111111111111111111111111',
              },
              buy: {
                token: '0x2222222222222222222222222222222222222222',
              },
              to: '0x3333333333333333333333333333333333333333',
              via: [
                zeroEx({
                  settler: '0x4444444444444444444444444444444444444444',
                }),
              ],
            },
          },
        },
        undefined,
        undefined,
        undefined,
        undefined,
        { include: ['0x', 'relay'] },
      )
    } finally {
      enabled.mockRestore()
    }

    const intentInput: IntentInput = mockCreateQuote.mock.calls[0][0]
    expect(intentInput.options.quoters).toEqual({ include: ['0x'] })
  })

  test('preserves an empty quoter include filter on the wire', async () => {
    mockCreateQuote.mockResolvedValue([MOCK_QUOTE])

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
      undefined,
      undefined,
      undefined,
      undefined,
      { include: [] },
    )

    const intentInput: IntentInput = mockCreateQuote.mock.calls[0][0]
    expect(intentInput.options.quoters).toEqual({ include: [] })
  })

  test('includes appFees in options when provided', async () => {
    mockCreateQuote.mockResolvedValue([MOCK_QUOTE])

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
      undefined,
      { feeBps: 100 },
    )

    expect(mockCreateQuote).toHaveBeenCalledOnce()
    const intentInput: IntentInput = mockCreateQuote.mock.calls[0][0]
    expect(intentInput.options.appFees).toEqual({ feeBps: 100 })
  })

  test('includes customDeadline in options when provided', async () => {
    mockCreateQuote.mockResolvedValue([MOCK_QUOTE])

    const customDeadline = 9_999_999_999

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
      undefined,
      undefined,
      customDeadline,
    )

    expect(mockCreateQuote).toHaveBeenCalledOnce()
    const intentInput: IntentInput = mockCreateQuote.mock.calls[0][0]
    expect(intentInput.options.customDeadline).toBe(customDeadline)
  })

  test('omits customDeadline from options when not provided', async () => {
    mockCreateQuote.mockResolvedValue([MOCK_QUOTE])

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
      undefined,
      undefined,
    )

    expect(mockCreateQuote).toHaveBeenCalledOnce()
    const intentInput: IntentInput = mockCreateQuote.mock.calls[0][0]
    expect(intentInput.options.customDeadline).toBeUndefined()
  })

  test('includes protocolFees in options when provided (RHI-4904)', async () => {
    mockCreateQuote.mockResolvedValue([MOCK_QUOTE])

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
      undefined,
      undefined,
      undefined,
      { feeBps: 35 },
    )

    expect(mockCreateQuote).toHaveBeenCalledOnce()
    const intentInput: IntentInput = mockCreateQuote.mock.calls[0][0]
    expect(intentInput.options.protocolFees).toEqual({ feeBps: 35 })
    expect(intentInput.options.appFees).toBeUndefined()
  })

  test('maps sponsored.protocolFees onto sponsorSettings (RHI-4904)', async () => {
    mockCreateQuote.mockResolvedValue([MOCK_QUOTE])

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
      { gas: false, bridging: false, swaps: false, protocolFees: true },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { feeBps: 35 },
    )

    const intentInput: IntentInput = mockCreateQuote.mock.calls[0][0]
    expect(intentInput.options.sponsorSettings).toEqual({
      gasSponsored: false,
      bridgeFeesSponsored: false,
      swapFeesSponsored: false,
      protocolFeesSponsored: true,
    })
  })

  test('boolean sponsored: true enables protocolFeesSponsored too (RHI-4904)', async () => {
    mockCreateQuote.mockResolvedValue([MOCK_QUOTE])

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
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    )

    const intentInput: IntentInput = mockCreateQuote.mock.calls[0][0]
    expect(intentInput.options.sponsorSettings).toEqual({
      gasSponsored: true,
      bridgeFeesSponsored: true,
      swapFeesSponsored: true,
      protocolFeesSponsored: true,
    })
  })

  test('claim-only session sends SIG_MODE_ERC1271 in routing request', async () => {
    mockCreateQuote.mockResolvedValue([MOCK_QUOTE])
    vi.spyOn(validators, 'isSessionEnabled').mockResolvedValue(false)

    const signers: SessionSignerSet = {
      type: 'experimental_session',
      session: {
        chain: base,
        owners: { type: 'ecdsa', accounts: [accountA], threshold: 1 },
      },
      enableData: {
        userSignature: '0xdeadbeef',
        hashesAndChainIds: [],
        sessionToEnableIndex: 0,
      },
    }

    await prepareTransactionAsIntent(
      {
        owners: { type: 'ecdsa', accounts: [accountA], threshold: 1 },
        apiKey: 'test',
      },
      [base],
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
      signers,
      undefined,
    )

    const intentInput: IntentInput = mockCreateQuote.mock.calls[0][0]
    expect(intentInput.options.signatureMode).toBe(SIG_MODE_ERC1271)
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

// ---------------------------------------------------------------------------
// preClaimExecutions in routing request
// ---------------------------------------------------------------------------

const makeEnableData = () => ({
  userSignature: `0x${'00'.repeat(65)}` as `0x${string}`,
  hashesAndChainIds: [
    {
      chainId: BigInt(base.id),
      sessionDigest: `0x${'00'.repeat(32)}` as `0x${string}`,
    },
  ],
  sessionToEnableIndex: 0,
})

describe('prepareTransactionAsIntent — preClaimExecutions', () => {
  let isSessionEnabledSpy: any

  beforeEach(() => {
    mockCreateQuote.mockReset()
    mockCreateQuote.mockResolvedValue([MOCK_QUOTE])
    isSessionEnabledSpy = vi
      .spyOn(validators, 'isSessionEnabled')
      .mockResolvedValue(false)
  })

  test('includes dummy preclaimop in preClaimExecutions when session needs enabling', async () => {
    const signers: SessionSignerSet = {
      type: 'experimental_session',
      session: {
        chain: base,
        owners: { type: 'ecdsa', accounts: [accountA], threshold: 1 },
        actions: [
          {
            target:
              '0x1111111111111111111111111111111111111111' as `0x${string}`,
            selector: '0xdeadbeef' as `0x${string}`,
          },
        ],
      },
      enableData: makeEnableData(),
    }

    await prepareTransactionAsIntent(
      {
        owners: { type: 'ecdsa', accounts: [accountA], threshold: 1 },
        apiKey: 'test',
      },
      [base],
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
      signers,
      undefined,
    )

    const intentInput: IntentInput = mockCreateQuote.mock.calls[0][0]
    expect(intentInput.preClaimExecutions).toBeDefined()
    expect(intentInput.preClaimExecutions![base.id]).toHaveLength(1)
    expect(intentInput.preClaimExecutions![base.id][0].to).toBe(
      DUMMY_PRECLAIMOP_TARGET,
    )
    expect(intentInput.preClaimExecutions![base.id][0].data).toBe(
      DUMMY_PRECLAIMOP_SELECTOR,
    )
  })

  test('omits preClaimExecutions when session is already enabled', async () => {
    isSessionEnabledSpy.mockResolvedValue(true)

    const signers: SessionSignerSet = {
      type: 'experimental_session',
      session: {
        chain: base,
        owners: { type: 'ecdsa', accounts: [accountA], threshold: 1 },
        actions: [
          {
            target:
              '0x1111111111111111111111111111111111111111' as `0x${string}`,
            selector: '0xdeadbeef' as `0x${string}`,
          },
        ],
      },
      enableData: makeEnableData(),
    }

    await prepareTransactionAsIntent(
      {
        owners: { type: 'ecdsa', accounts: [accountA], threshold: 1 },
        apiKey: 'test',
      },
      [base],
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
      signers,
      undefined,
    )

    const intentInput: IntentInput = mockCreateQuote.mock.calls[0][0]
    expect(intentInput.preClaimExecutions).toBeUndefined()
  })

  test('omits preClaimExecutions when session has no enableData', async () => {
    const signers: SessionSignerSet = {
      type: 'experimental_session',
      session: {
        chain: base,
        owners: { type: 'ecdsa', accounts: [accountA], threshold: 1 },
        actions: [
          {
            target:
              '0x1111111111111111111111111111111111111111' as `0x${string}`,
            selector: '0xdeadbeef' as `0x${string}`,
          },
        ],
      },
      // no enableData
    }

    await prepareTransactionAsIntent(
      {
        owners: { type: 'ecdsa', accounts: [accountA], threshold: 1 },
        apiKey: 'test',
      },
      [base],
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
      signers,
      undefined,
    )

    const intentInput: IntentInput = mockCreateQuote.mock.calls[0][0]
    expect(intentInput.preClaimExecutions).toBeUndefined()
  })

  test('omits preClaimExecutions when session has no explicit actions (verifyExecutions=false)', async () => {
    const signers: SessionSignerSet = {
      type: 'experimental_session',
      session: {
        chain: base,
        owners: { type: 'ecdsa', accounts: [accountA], threshold: 1 },
        // no actions → verifyExecutions defaults to false
      },
      enableData: makeEnableData(),
    }

    await prepareTransactionAsIntent(
      {
        owners: { type: 'ecdsa', accounts: [accountA], threshold: 1 },
        apiKey: 'test',
      },
      [base],
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
      signers,
      undefined,
    )

    const intentInput: IntentInput = mockCreateQuote.mock.calls[0][0]
    expect(intentInput.preClaimExecutions).toBeUndefined()
  })

  test('injects only for not-yet-enabled chains when multiple source chains', async () => {
    // base: not enabled → gets dummy preclaimop
    // arbitrum: already enabled → skipped
    isSessionEnabledSpy.mockImplementation(
      async (_address: any, _provider: any, session: any) =>
        session.chain.id === arbitrum.id,
    )

    const makeSessionWithActions = (chainId: number) => ({
      ...makeSession(chainId),
      actions: [
        {
          target: '0x1111111111111111111111111111111111111111' as `0x${string}`,
          selector: '0xdeadbeef' as `0x${string}`,
        },
      ],
    })

    const signers: SessionSignerSet = {
      type: 'experimental_session',
      sessions: {
        [base.id]: {
          session: makeSessionWithActions(base.id) as any,
          enableData: makeEnableData(),
        },
        [arbitrum.id]: {
          session: makeSessionWithActions(arbitrum.id) as any,
          enableData: makeEnableData(),
        },
      },
    }

    await prepareTransactionAsIntent(
      {
        owners: { type: 'ecdsa', accounts: [accountA], threshold: 1 },
        apiKey: 'test',
      },
      [base, arbitrum],
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
      signers,
      undefined,
    )

    const intentInput: IntentInput = mockCreateQuote.mock.calls[0][0]
    expect(intentInput.preClaimExecutions).toBeDefined()
    expect(intentInput.preClaimExecutions![base.id]).toHaveLength(1)
    expect(intentInput.preClaimExecutions![base.id][0].to).toBe(
      DUMMY_PRECLAIMOP_TARGET,
    )
    expect(intentInput.preClaimExecutions![arbitrum.id]).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// sourceCalls in routing request
// ---------------------------------------------------------------------------

describe('prepareTransactionAsIntent — sourceCalls', () => {
  beforeEach(() => {
    mockCreateQuote.mockReset()
    mockCreateQuote.mockResolvedValue([MOCK_QUOTE])
  })

  const callA = {
    to: '0x1111111111111111111111111111111111111111' as `0x${string}`,
    value: 0n,
    data: '0xaaaa' as `0x${string}`,
  }
  const callB = {
    to: '0x2222222222222222222222222222222222222222' as `0x${string}`,
    value: 1n,
    data: '0xbbbb' as `0x${string}`,
  }

  test('user-provided sourceCalls flow into preClaimExecutions', async () => {
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
      { [arbitrum.id]: [callA, callB] },
    )

    const intentInput: IntentInput = mockCreateQuote.mock.calls[0][0]
    expect(intentInput.preClaimExecutions).toBeDefined()
    expect(intentInput.preClaimExecutions![arbitrum.id]).toEqual([callA, callB])
  })

  test('sourceCalls on the target chain (same-chain) are accepted', async () => {
    await prepareTransactionAsIntent(
      {
        owners: { type: 'ecdsa', accounts: [accountA], threshold: 1 },
        apiKey: 'test',
      },
      [base],
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
      { [base.id]: [callA] },
    )

    const intentInput: IntentInput = mockCreateQuote.mock.calls[0][0]
    expect(intentInput.preClaimExecutions![base.id]).toEqual([callA])
  })

  test('throws when sourceCalls references a chain not in sourceChains', async () => {
    await expect(
      prepareTransactionAsIntent(
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
        { [optimism.id]: [callA] },
      ),
    ).rejects.toThrow(/optimism|10|sourceChains/i)
  })

  test('lazy CallInput.resolve is invoked with the per-chain context', async () => {
    const resolve = vi.fn(async ({ chain }: { chain: any }) => ({
      to: '0x3333333333333333333333333333333333333333' as `0x${string}`,
      value: 0n,
      data: `0x${chain.id.toString(16).padStart(8, '0')}` as `0x${string}`,
    }))

    await prepareTransactionAsIntent(
      {
        owners: { type: 'ecdsa', accounts: [accountA], threshold: 1 },
        apiKey: 'test',
      },
      [arbitrum, optimism],
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
      {
        [arbitrum.id]: [{ resolve }],
        [optimism.id]: [{ resolve }],
      },
    )

    expect(resolve).toHaveBeenCalledTimes(2)
    const chainIds = resolve.mock.calls.map((c: any[]) => c[0].chain.id).sort()
    expect(chainIds).toEqual([arbitrum.id, optimism.id].sort())

    const intentInput: IntentInput = mockCreateQuote.mock.calls[0][0]
    expect(intentInput.preClaimExecutions![arbitrum.id]).toHaveLength(1)
    expect(intentInput.preClaimExecutions![optimism.id]).toHaveLength(1)
  })

  test('user sourceCalls merge after the dummy session preclaimop on the same chain', async () => {
    vi.spyOn(validators, 'isSessionEnabled').mockResolvedValue(false)

    const signers: SessionSignerSet = {
      type: 'experimental_session',
      session: {
        chain: base,
        owners: { type: 'ecdsa', accounts: [accountA], threshold: 1 },
        actions: [
          {
            target:
              '0x1111111111111111111111111111111111111111' as `0x${string}`,
            selector: '0xdeadbeef' as `0x${string}`,
          },
        ],
      },
      enableData: makeEnableData(),
    }

    await prepareTransactionAsIntent(
      {
        owners: { type: 'ecdsa', accounts: [accountA], threshold: 1 },
        apiKey: 'test',
      },
      [base],
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
      signers,
      { [base.id]: [callA] },
    )

    const intentInput: IntentInput = mockCreateQuote.mock.calls[0][0]
    const ops = intentInput.preClaimExecutions![base.id]
    expect(ops).toHaveLength(2)
    expect(ops[0].to).toBe(DUMMY_PRECLAIMOP_TARGET)
    expect(ops[0].data).toBe(DUMMY_PRECLAIMOP_SELECTOR)
    expect(ops[1]).toEqual(callA)
  })

  test('omits preClaimExecutions when sourceCalls is undefined and no session', async () => {
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
      undefined,
    )

    const intentInput: IntentInput = mockCreateQuote.mock.calls[0][0]
    expect(intentInput.preClaimExecutions).toBeUndefined()
  })

  test('empty sourceCalls entry is dropped', async () => {
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
      { [arbitrum.id]: [] },
    )

    const intentInput: IntentInput = mockCreateQuote.mock.calls[0][0]
    expect(intentInput.preClaimExecutions).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// resolveSignatureMode
// ---------------------------------------------------------------------------

describe('resolveSignatureMode', () => {
  beforeEach(() => {
    vi.spyOn(validators, 'isSessionEnabled').mockResolvedValue(false)
  })

  const ownerSigners: SignerSet = {
    type: 'owner',
    kind: 'ecdsa',
    accounts: [accountA],
  } as unknown as SignerSet

  const guardianSigners: SignerSet = {
    type: 'guardians',
    guardians: [accountA],
  } as unknown as SignerSet

  const smartAccountConfig: RhinestoneConfig = {
    owners: { type: 'ecdsa', accounts: [accountA], threshold: 1 },
    apiKey: 'test',
  } as unknown as RhinestoneConfig

  const eoaAccountConfig: RhinestoneConfig = {
    account: { type: 'eoa' },
    owners: { type: 'ecdsa', accounts: [accountA], threshold: 1 },
    apiKey: 'test',
  } as unknown as RhinestoneConfig

  const sessionWithActions: SessionSignerSet['session'] = {
    chain: base,
    owners: { type: 'ecdsa', accounts: [accountA], threshold: 1 },
    actions: [
      {
        target: '0x1111111111111111111111111111111111111111' as `0x${string}`,
        selector: '0xdeadbeef' as `0x${string}`,
      },
    ],
  } as unknown as SessionSignerSet['session']

  const claimOnlySession: SessionSignerSet['session'] = {
    chain: base,
    owners: { type: 'ecdsa', accounts: [accountA], threshold: 1 },
  } as unknown as SessionSignerSet['session']

  test('EOA returns SIG_MODE_ERC1271', async () => {
    const mode = await resolveSignatureMode(
      eoaAccountConfig,
      undefined,
      [arbitrum],
      base,
    )
    expect(mode).toBe(SIG_MODE_ERC1271)
  })

  test('smart account with undefined signers returns SIG_MODE_ERC1271', async () => {
    const mode = await resolveSignatureMode(
      smartAccountConfig,
      undefined,
      [arbitrum],
      base,
    )
    expect(mode).toBe(SIG_MODE_ERC1271)
  })

  test('smart account with owner signers returns SIG_MODE_ERC1271', async () => {
    const mode = await resolveSignatureMode(
      smartAccountConfig,
      ownerSigners,
      [arbitrum],
      base,
    )
    expect(mode).toBe(SIG_MODE_ERC1271)
  })

  test('smart account with guardian signers returns SIG_MODE_ERC1271', async () => {
    const mode = await resolveSignatureMode(
      smartAccountConfig,
      guardianSigners,
      [arbitrum],
      base,
    )
    expect(mode).toBe(SIG_MODE_ERC1271)
  })

  test('session with actions returns SIG_MODE_EMISSARY_EXECUTION_ERC1271', async () => {
    const signers: SessionSignerSet = {
      type: 'experimental_session',
      session: sessionWithActions,
    }
    const mode = await resolveSignatureMode(
      smartAccountConfig,
      signers,
      [base],
      base,
    )
    expect(mode).toBe(SIG_MODE_EMISSARY_EXECUTION_ERC1271)
  })

  test('claim-only session returns SIG_MODE_ERC1271', async () => {
    const signers: SessionSignerSet = {
      type: 'experimental_session',
      session: claimOnlySession,
    }
    const mode = await resolveSignatureMode(
      smartAccountConfig,
      signers,
      [base],
      base,
    )
    expect(mode).toBe(SIG_MODE_ERC1271)
  })

  test('claim-only session with verifyExecutions=true override returns SIG_MODE_EMISSARY_EXECUTION_ERC1271', async () => {
    const signers: SessionSignerSet = {
      type: 'experimental_session',
      session: claimOnlySession,
      verifyExecutions: true,
    }
    const mode = await resolveSignatureMode(
      smartAccountConfig,
      signers,
      [base],
      base,
    )
    expect(mode).toBe(SIG_MODE_EMISSARY_EXECUTION_ERC1271)
  })

  test('session with actions and verifyExecutions=false override returns SIG_MODE_ERC1271', async () => {
    const signers: SessionSignerSet = {
      type: 'experimental_session',
      session: sessionWithActions,
      verifyExecutions: false,
    }
    const mode = await resolveSignatureMode(
      smartAccountConfig,
      signers,
      [base],
      base,
    )
    expect(mode).toBe(SIG_MODE_ERC1271)
  })

  test('multi-chain session with divergent verifyExecutions returns SIG_MODE_EMISSARY_EXECUTION_ERC1271', async () => {
    const signers: SessionSignerSet = {
      type: 'experimental_session',
      sessions: {
        [base.id]: { session: sessionWithActions },
        [arbitrum.id]: { session: claimOnlySession },
      },
    }
    const mode = await resolveSignatureMode(
      smartAccountConfig,
      signers,
      [base, arbitrum],
      base,
    )
    expect(mode).toBe(SIG_MODE_EMISSARY_EXECUTION_ERC1271)
  })
})

describe('quote, sign and submit through blanc', () => {
  const config: RhinestoneConfig = {
    owners: { type: 'ecdsa', accounts: [accountA], threshold: 1 },
    apiKey: 'test',
  }

  beforeEach(() => {
    mockCreateQuote.mockReset()
    mockCreateIntent.mockReset()
  })

  test('prepares the recommended quote', async () => {
    const alternative = { ...MOCK_QUOTE, intentId: '2' }
    mockCreateQuote.mockResolvedValue([MOCK_QUOTE, alternative])
    const transaction = { chain: base }
    const prepared = await prepareTransaction(config, transaction)
    expect(prepared.quote).toBe(MOCK_QUOTE)
    expect(prepared.transaction).toBe(transaction)
    expect(Object.keys(prepared)).toEqual([
      'quote',
      'intentInput',
      'transaction',
    ])
  })

  test.each([
    undefined,
    true,
    false,
    { gas: true, bridging: false, swaps: false },
    { gas: false, bridging: true, swaps: false },
    { gas: false, bridging: false, swaps: true },
    { gas: false, bridging: false, swaps: false, protocolFees: true },
    { gas: false, bridging: false, swaps: false, protocolFees: false },
  ])(
    'retains serialized intentInput across prepare, sign and submit (%j)',
    async (sponsored) => {
      mockCreateQuote.mockResolvedValue([MOCK_QUOTE])
      mockCreateIntent.mockResolvedValue({ intentId: '1' })
      const prepared = await prepareTransaction(config, {
        chain: base,
        sponsored,
      })
      const legacyInput = convertBigIntFields(mockCreateQuote.mock.calls[0][0])
      expect(prepared.intentInput).toStrictEqual(legacyInput)
      expect(prepared.intentInput).not.toBe(mockCreateQuote.mock.calls[0][0])
      const eoaConfig: RhinestoneConfig = {
        ...config,
        account: { type: 'eoa' },
        eoa: accountA,
      }
      const signed = await signTransaction(eoaConfig, prepared)
      expect(signed.intentInput).toBe(prepared.intentInput)
      expect(signed.intentInput).toStrictEqual(legacyInput)
      expect(mockCreateQuote).toHaveBeenCalledTimes(1)
      await submitTransaction(eoaConfig, signed, [])
      expect(mockCreateIntent).toHaveBeenCalledTimes(1)
      expect(mockCreateIntent.mock.calls[0]).toHaveLength(1)
      expect(signed.intentInput).toStrictEqual(legacyInput)
    },
  )

  test('high-level preparation approves once; signing and submitting never approve again', async () => {
    const approve = vi.fn(async (_input: unknown) => 'extension')
    const auth = createAuthProvider({
      auth: {
        mode: 'experimental_jwt',
        accessToken: 'access',
        getIntentExtensionToken: approve,
      },
    })
    const client = new Orchestrator('https://example.test', auth)
    const fetchMock = vi.fn(
      async (url: string, _init?: RequestInit) =>
        new Response(
          JSON.stringify(
            url.endsWith('/quotes')
              ? { routes: [recordedQuotes.devMultiChainOpsRoute] }
              : { intentId: '77' },
          ),
        ),
    )
    vi.stubGlobal('fetch', fetchMock)
    mockCreateQuote.mockImplementation((input) => client.createQuote(input))
    mockCreateIntent.mockImplementation((request) =>
      client.createIntent(request),
    )
    const jwtConfig: RhinestoneConfig = { ...config, _authProvider: auth }
    try {
      const prepared = await prepareTransaction(jwtConfig, {
        chain: base,
        sponsored: true,
      })
      const legacyInput = convertBigIntFields(mockCreateQuote.mock.calls[0][0])
      expect(approve).toHaveBeenCalledExactlyOnceWith(legacyInput)
      expect(prepared.intentInput).toStrictEqual(legacyInput)
      const signed = await signTransaction(
        { ...jwtConfig, account: { type: 'eoa' }, eoa: accountA },
        prepared,
      )
      expect(signed.intentInput).toBe(prepared.intentInput)
      const result = await submitTransaction(jwtConfig, signed, [])
      expect(result).toMatchObject({ type: 'intent', id: 77n })
      expect(approve).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
        'X-Intent-Extension': 'Bearer extension',
      })
      expect(fetchMock.mock.calls[1][1]?.headers).toMatchObject({
        Authorization: 'Bearer access',
        'x-api-version': '2026-04.blanc',
      })
      expect(fetchMock.mock.calls[1][1]?.headers).not.toHaveProperty(
        'X-Intent-Extension',
      )
      expect(mockCreateIntent.mock.calls[0]).toHaveLength(1)
      expect(signed.intentInput).toStrictEqual(legacyInput)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test('refuses a quote without routes', async () => {
    mockCreateQuote.mockResolvedValue([])
    await expect(prepareTransaction(config, { chain: base })).rejects.toThrow(
      OrderPathRequiredForIntentsError,
    )
  })

  test('prepares the recorded multi-chain route for owners', async () => {
    const quote = quoteFromBlanc(
      recordedQuotes.devMultiChainOpsRoute as unknown as BlancRoute,
    )
    mockCreateQuote.mockResolvedValue([quote])
    expect((await prepareTransaction(config, { chain: base })).quote).toBe(
      quote,
    )
  })

  test('refuses a payload naming no chain', async () => {
    const chainless = { ...MOCK_PAYLOAD, domain: {} }
    mockCreateQuote.mockResolvedValue([
      {
        ...MOCK_QUOTE,
        signData: { origin: [chainless], destination: chainless },
      },
    ])
    await expect(prepareTransaction(config, { chain: base })).rejects.toThrow(
      'Intent payload "Test" names no chain',
    )
  })

  test.each([false, true])(
    'session prepare with same-chain leaves: %s',
    async (sameChain) => {
      const quote = quoteFromBlanc(
        recordedQuotes.devMultiChainOpsRoute as unknown as BlancRoute,
      )
      if (sameChain) {
        const payload = quote.signData.origin[0]
        const message = payload.message as { ops: { chainId: bigint }[] }
        message.ops[1].chainId = message.ops[0].chainId
        quote.signData.destination = payload
      }
      mockCreateQuote.mockResolvedValue([quote])
      const enabled = vi
        .spyOn(validators, 'isSessionEnabled')
        .mockResolvedValue(true)
      const signers: SessionSignerSet = {
        type: 'experimental_session',
        session: {
          chain: base,
          owners: { type: 'ecdsa', accounts: [accountA] },
        },
      }
      try {
        const result = prepareTransaction(config, { chain: base, signers })
        if (sameChain) expect((await result).quote).toBe(quote)
        else
          await expect(result).rejects.toThrow(
            'Cannot sign a chain-agnostic intent payload with a smart session',
          )
      } finally {
        enabled.mockRestore()
      }
    },
  )

  test('submits signatures by role against the quote id', async () => {
    mockCreateIntent.mockResolvedValue({ intentId: '77' })
    const intentInput = { options: { sponsorSettings: { gasSponsored: true } } }
    const result = await submitTransaction(
      config,
      {
        quote: MOCK_QUOTE as never,
        intentInput,
        transaction: { sourceChains: [arbitrum], targetChain: base },
        originSignatures: ['0x01'],
        destinationSignature: '0x01',
        targetExecutionSignature: undefined,
      },
      [],
      true,
    )
    expect(mockCreateIntent).toHaveBeenCalledWith({
      intentId: '1',
      signatures: { origin: ['0x01'], destination: '0x01' },
      options: { dryRun: true },
    })
    expect(result).toEqual({
      type: 'intent',
      id: 77n,
      sourceChains: [arbitrum.id],
      targetChain: base.id,
    })
  })
})
