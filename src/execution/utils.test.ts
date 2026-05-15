import { erc20Abi, zeroAddress } from 'viem'
import { arbitrum, base, mainnet, optimism } from 'viem/chains'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { accountA } from '../../test/consts'
import * as validators from '../modules/validators'
import {
  DUMMY_PRECLAIMOP_SELECTOR,
  DUMMY_PRECLAIMOP_TARGET,
  toSession,
} from '../modules/validators'
import {
  type IntentInput,
  SIG_MODE_EMISSARY_EXECUTION_ERC1271,
  SIG_MODE_ERC1271,
} from '../orchestrator/types'
import type { RhinestoneConfig, SessionSignerSet, SignerSet } from '../types'
import {
  hashErc7739TypedDataForSolady,
  prepareTransactionAsIntent,
  resolveSessionForChain,
  resolveSignatureMode,
} from './utils'

const mockCreateQuote = vi.fn()

vi.mock('../orchestrator', () => ({
  getOrchestrator: () => ({
    createQuote: mockCreateQuote,
  }),
}))

const mockQuote = {
  intentId: 'mock-intent-id',
  expiresAt: 0,
  estimatedFillTime: { seconds: 0 },
  settlementLayer: 'INTENT_EXECUTOR',
  signData: {
    origin: [],
    destination: { types: {}, primaryType: '', message: {} },
  },
  cost: {
    input: [],
    output: [],
    fees: {
      total: { usd: 0 },
      breakdown: {
        gas: { usd: 0 },
        bridge: { usd: 0 },
        protocol: { usd: 0 },
        swap: { usd: 0 },
        settlement: { usd: 0 },
      },
    },
  },
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

    mockCreateQuote.mockResolvedValue({ routes: [mockQuote] })

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
      auxiliaryFunds,
      undefined,
      undefined,
    )

    expect(mockCreateQuote).toHaveBeenCalledOnce()
    const intentInput: IntentInput = mockCreateQuote.mock.calls[0][0]
    expect(intentInput.options.auxiliaryFunds).toEqual(auxiliaryFunds)
  })

  test('does not include auxiliaryFunds in options when not provided', async () => {
    mockCreateQuote.mockResolvedValue({ routes: [mockQuote] })

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
    )

    expect(mockCreateQuote).toHaveBeenCalledOnce()
    const intentInput: IntentInput = mockCreateQuote.mock.calls[0][0]
    expect(intentInput.options.auxiliaryFunds).toBeUndefined()
  })

  test('claim-only session sends SIG_MODE_ERC1271 in routing request', async () => {
    mockCreateQuote.mockResolvedValue({ routes: [mockQuote] })
    vi.spyOn(validators, 'isSessionEnabled').mockResolvedValue(false)

    const signers: SessionSignerSet = {
      type: 'experimental_session',
      session: toSession({
        chain: base,
        owners: { type: 'ecdsa', accounts: [accountA], threshold: 1 },
      }),
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
      signers,
    )

    const intentInput: IntentInput = mockCreateQuote.mock.calls[0][0]
    expect(intentInput.options.signatureMode).toBe(SIG_MODE_ERC1271)
  })
})

const getTestChain = (chainId: number) => {
  switch (chainId) {
    case arbitrum.id:
      return arbitrum
    case base.id:
      return base
    case optimism.id:
      return optimism
    default:
      return mainnet
  }
}

const makeSession = (chainId: number) =>
  toSession({
    chain: getTestChain(chainId),
    owners: {
      type: 'ecdsa' as const,
      accounts: [accountA],
      threshold: 1,
    },
  })

const explicitPermissions = [
  {
    abi: erc20Abi,
    address: '0x1111111111111111111111111111111111111111' as `0x${string}`,
    functions: { transfer: {} },
  },
]

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
    mockCreateQuote.mockResolvedValue({ routes: [mockQuote] })
    isSessionEnabledSpy = vi
      .spyOn(validators, 'isSessionEnabled')
      .mockResolvedValue(false)
  })

  test('includes dummy preclaimop in preClaimExecutions when session needs enabling', async () => {
    const signers: SessionSignerSet = {
      type: 'experimental_session',
      session: toSession({
        chain: base,
        owners: { type: 'ecdsa', accounts: [accountA], threshold: 1 },
        permissions: explicitPermissions,
      }),
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
      signers,
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
      session: toSession({
        chain: base,
        owners: { type: 'ecdsa', accounts: [accountA], threshold: 1 },
        permissions: explicitPermissions,
      }),
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
      signers,
    )

    const intentInput: IntentInput = mockCreateQuote.mock.calls[0][0]
    expect(intentInput.preClaimExecutions).toBeUndefined()
  })

  test('omits preClaimExecutions when session has no enableData', async () => {
    const signers: SessionSignerSet = {
      type: 'experimental_session',
      session: toSession({
        chain: base,
        owners: { type: 'ecdsa', accounts: [accountA], threshold: 1 },
        permissions: explicitPermissions,
      }),
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
      signers,
    )

    const intentInput: IntentInput = mockCreateQuote.mock.calls[0][0]
    expect(intentInput.preClaimExecutions).toBeUndefined()
  })

  test('omits preClaimExecutions when session has no explicit actions (verifyExecutions=false)', async () => {
    const signers: SessionSignerSet = {
      type: 'experimental_session',
      session: toSession({
        chain: base,
        owners: { type: 'ecdsa', accounts: [accountA], threshold: 1 },
        // no actions → verifyExecutions defaults to false
      }),
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
      signers,
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

    const makeSessionWithActions = (chainId: number) =>
      toSession({
        chain: getTestChain(chainId),
        owners: {
          type: 'ecdsa' as const,
          accounts: [accountA],
          threshold: 1,
        },
        permissions: explicitPermissions,
      })

    const signers: SessionSignerSet = {
      type: 'experimental_session',
      sessions: {
        [base.id]: {
          session: makeSessionWithActions(base.id),
          enableData: makeEnableData(),
        },
        [arbitrum.id]: {
          session: makeSessionWithActions(arbitrum.id),
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
      signers,
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

  const sessionWithActions = toSession({
    chain: base,
    owners: { type: 'ecdsa', accounts: [accountA], threshold: 1 },
    permissions: explicitPermissions,
  })

  const claimOnlySession = toSession({
    chain: base,
    owners: { type: 'ecdsa', accounts: [accountA], threshold: 1 },
  })

  test('EOA returns SIG_MODE_ERC1271', async () => {
    const mode = await resolveSignatureMode(
      eoaAccountConfig,
      undefined,
      [arbitrum],
      base.id,
    )
    expect(mode).toBe(SIG_MODE_ERC1271)
  })

  test('smart account with undefined signers returns SIG_MODE_ERC1271', async () => {
    const mode = await resolveSignatureMode(
      smartAccountConfig,
      undefined,
      [arbitrum],
      base.id,
    )
    expect(mode).toBe(SIG_MODE_ERC1271)
  })

  test('smart account with owner signers returns SIG_MODE_ERC1271', async () => {
    const mode = await resolveSignatureMode(
      smartAccountConfig,
      ownerSigners,
      [arbitrum],
      base.id,
    )
    expect(mode).toBe(SIG_MODE_ERC1271)
  })

  test('smart account with guardian signers returns SIG_MODE_ERC1271', async () => {
    const mode = await resolveSignatureMode(
      smartAccountConfig,
      guardianSigners,
      [arbitrum],
      base.id,
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
      base.id,
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
      base.id,
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
      base.id,
    )
    expect(mode).toBe(SIG_MODE_EMISSARY_EXECUTION_ERC1271)
  })
})
