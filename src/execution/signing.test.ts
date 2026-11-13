import {
  type Hex,
  type PublicClient,
  type TypedDataDefinition,
  verifyTypedData,
} from 'viem'
import { base } from 'viem/chains'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { accountA } from '../../test/consts'
import { getEip712Domain, getTypedDataPackedSignature } from '../accounts'
import { getOwnerValidator } from '../modules/validators'
import {
  getSocialRecoveryValidator,
  supportsEip712,
} from '../modules/validators/core'
import recordedQuotes from '../orchestrator/__fixtures__/quote-responses.json'
import { getChainById } from '../orchestrator/registry'
import type { Quote, SettlementLayer } from '../orchestrator/types'
import { type BlancRoute, quoteFromBlanc } from '../orchestrator/wire-quote'
import type {
  RhinestoneConfig,
  Session,
  SessionSignerSet,
  SignerSet,
} from '../types'
import {
  getTargetExecutionSignature,
  getValidatorAccount,
  signIntent,
  signPermits,
} from './utils'

const {
  MOCK_EMISSARY,
  MOCK_EIP1271,
  MOCK_ACCOUNT,
  MOCK_EXECUTOR,
  MOCK_VALIDATOR,
  mockGetEmissarySignature,
  mockGetEip1271Signature,
  mockGetSmartAccount,
  mockIsSessionEnabled,
  mockPackEip1271Signature,
  mockSignQuorumHash,
  MOCK_TYPED_DATA,
} = vi.hoisted(() => {
  const MOCK_ACCOUNT = '0x1111111111111111111111111111111111111111'
  const MOCK_EXECUTOR = '0x2222222222222222222222222222222222222222'
  const MOCK_VALIDATOR = '0x3333333333333333333333333333333333333333'
  const MOCK_EMISSARY = `0x${'ee'.repeat(65)}`
  const MOCK_EIP1271 = `0x${'12'.repeat(65)}`

  const mockGetEmissarySignature = vi.fn().mockResolvedValue(MOCK_EMISSARY)
  const mockGetEip1271Signature = vi.fn().mockResolvedValue(MOCK_EIP1271)
  const mockGetSmartAccount = vi.fn().mockResolvedValue({})
  const mockIsSessionEnabled = vi.fn().mockResolvedValue(true)
  const mockPackEip1271Signature = vi.fn(
    async (_config, signature) => signature,
  )
  const mockSignQuorumHash = vi.fn().mockResolvedValue('0xab')

  const MOCK_TYPED_DATA = {
    domain: {
      name: 'Test',
      version: '1',
      chainId: 8453,
      verifyingContract: MOCK_EXECUTOR,
    },
    types: {
      Test: [{ name: 'value', type: 'uint256' }],
    },
    primaryType: 'Test' as const,
    message: { value: 1n },
  }

  return {
    MOCK_EMISSARY: MOCK_EMISSARY as `0x${string}`,
    MOCK_EIP1271: MOCK_EIP1271 as `0x${string}`,
    MOCK_ACCOUNT: MOCK_ACCOUNT as `0x${string}`,
    MOCK_EXECUTOR: MOCK_EXECUTOR as `0x${string}`,
    MOCK_VALIDATOR: MOCK_VALIDATOR as `0x${string}`,
    mockGetEmissarySignature,
    mockGetEip1271Signature,
    mockGetSmartAccount,
    mockIsSessionEnabled,
    mockPackEip1271Signature,
    mockSignQuorumHash,
    MOCK_TYPED_DATA,
  }
})

vi.mock('../orchestrator', () => ({
  getOrchestrator: vi.fn(),
}))

vi.mock('../accounts', () => ({
  getAddress: vi.fn().mockReturnValue(MOCK_ACCOUNT),
  getEmissarySignature: mockGetEmissarySignature,
  getEip1271Signature: mockGetEip1271Signature,
  getSmartAccount: mockGetSmartAccount,
  getEip712Domain: vi.fn(),
  getAccountProvider: vi.fn().mockReturnValue({ type: 'safe' }),
  getInitCode: vi.fn(),
  getGuardianSmartAccount: vi.fn(),
  getTypedDataPackedSignature: vi.fn(),
  packEip1271Signature: mockPackEip1271Signature,
  toErc6492Signature: vi.fn(),
  is7702: vi.fn().mockReturnValue(false),
  getEip7702InitCall: vi.fn(),
  EoaAccountMustHaveAccountError: class extends Error {},
  EoaSigningMethodNotConfiguredError: class extends Error {},
  FactoryArgsNotAvailableError: class extends Error {},
}))

vi.mock('../accounts/signing/common', () => ({
  convertOwnerSetToSignerSet: vi.fn(),
  signQuorumHash: mockSignQuorumHash,
}))

vi.mock('../accounts/startale', () => ({
  K1_DEFAULT_VALIDATOR_ADDRESS: '0x0000000000000000000000000000000000000000',
}))

vi.mock('../accounts/utils', () => ({
  createTransport: vi.fn(),
  getBundlerClient: vi.fn(),
}))

vi.mock('../modules', () => ({
  getIntentExecutor: vi.fn().mockReturnValue({
    address: MOCK_EXECUTOR,
    type: 7,
    initData: '0x',
    deInitData: '0x',
    additionalContext: '0x',
  }),
}))

vi.mock('../modules/validators', () => ({
  isSessionEnabled: mockIsSessionEnabled,
  getOwnerValidator: vi.fn().mockReturnValue({
    address: MOCK_VALIDATOR,
    type: 1,
    initData: '0x',
    deInitData: '0x',
    additionalContext: '0x',
  }),
  buildMockSignature: vi.fn(),
  getPermissionId: vi.fn().mockReturnValue(`0x${'cc'.repeat(32)}`),
  getSmartSessionValidator: vi.fn().mockReturnValue({
    address: MOCK_VALIDATOR,
    type: 1,
    initData: '0x',
    deInitData: '0x',
    additionalContext: '0x',
  }),
}))

vi.mock('../modules/validators/core', () => ({
  supportsEip712: vi.fn().mockReturnValue(false),
  getMultiFactorValidator: vi.fn(),
  getSocialRecoveryValidator: vi.fn(),
  getWebAuthnValidator: vi.fn(),
}))

vi.mock('../orchestrator/registry', () => ({
  getChainById: vi.fn().mockReturnValue(base),
  getTokenAddress: vi.fn(),
  resolveTokenAddress: vi.fn(),
}))

vi.mock('./error', () => ({
  Eip7702InitSignatureRequiredError: class extends Error {},
  OrderPathRequiredForIntentsError: class extends Error {},
  SignerNotSupportedError: class extends Error {},
}))

// --- Helpers ---

// One payload per origin; the destination is the last origin payload and the
// target execution is served unless `targetExecution` is false.
const makeQuote = (
  settlementLayer: SettlementLayer,
  {
    origins = 1,
    origin = MOCK_TYPED_DATA as TypedDataDefinition,
    targetExecution = true,
  }: {
    origins?: number
    origin?: TypedDataDefinition
    targetExecution?: boolean
  } = {},
): Quote =>
  ({
    intentId: '100',
    expiresAt: 9999999999,
    estimatedFillTime: { seconds: 1 },
    settlementLayer,
    signData: {
      origin: Array.from({ length: origins }, () => origin),
      destination: origin,
      targetExecution: targetExecution ? MOCK_TYPED_DATA : undefined,
    },
    cost: { input: [], output: [], fees: {} },
  }) as unknown as Quote

// verifyExecutions auto-derived as true when session.actions is non-empty
const sessionWithActions: Session = {
  chain: base,
  owners: { type: 'ecdsa', accounts: [accountA] },
  actions: [{ policies: [{ type: 'usage-limit', limit: 1n }] }],
}

// verifyExecutions auto-derived as false when session.actions is absent
const sessionNoActions: Session = {
  chain: base,
  owners: { type: 'ecdsa', accounts: [accountA] },
}

const config: RhinestoneConfig = {
  apiKey: 'test',
  owners: { type: 'ecdsa', accounts: [accountA] },
}

const makeSessionSigners = (session: Session): SessionSignerSet => ({
  type: 'experimental_session',
  session,
})

const ownerSigners: SignerSet = {
  type: 'owner',
  kind: 'ecdsa',
  accounts: [accountA],
}

// --- Tests ---

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(supportsEip712).mockReset().mockReturnValue(false)
  vi.mocked(getOwnerValidator)
    .mockReset()
    .mockReturnValue({
      address: MOCK_VALIDATOR,
      type: 1,
      initData: '0x',
      deInitData: '0x',
      additionalContext: '0x',
    } as never)
  mockGetEmissarySignature.mockResolvedValue(MOCK_EMISSARY)
  mockGetEip1271Signature.mockResolvedValue(MOCK_EIP1271)
  mockIsSessionEnabled.mockResolvedValue(true)
  mockPackEip1271Signature.mockImplementation(
    async (_config, signature) => signature,
  )
  mockSignQuorumHash.mockResolvedValue('0xab')
})

describe('getValidatorAccount', () => {
  test('threads selected quorum owners into UserOperation signing', async () => {
    const quorumSigners: SignerSet = {
      type: 'owner',
      kind: 'quorum',
      accounts: [accountA],
    }
    const publicClient = {} as PublicClient

    await getValidatorAccount(config, quorumSigners, publicClient, base)

    expect(mockGetSmartAccount).toHaveBeenCalledWith(
      config,
      publicClient,
      base,
      quorumSigners,
    )
  })
})

describe('getTargetExecutionSignature', () => {
  test('undefined signers returns undefined', async () => {
    const quote = makeQuote('INTENT_EXECUTOR')
    const result = await getTargetExecutionSignature(
      config,
      quote,
      base,
      undefined,
    )
    expect(result).toBeUndefined()
  })

  test('non-session signers returns undefined', async () => {
    const quote = makeQuote('INTENT_EXECUTOR')
    const result = await getTargetExecutionSignature(
      config,
      quote,
      base,
      ownerSigners,
    )
    expect(result).toBeUndefined()
  })

  test('SAME_CHAIN + verifyExecutions: true returns emissary sig', async () => {
    const quote = makeQuote('SAME_CHAIN')
    const signers = makeSessionSigners(sessionWithActions)
    const result = await getTargetExecutionSignature(
      config,
      quote,
      base,
      signers,
    )
    expect(result).toBe(MOCK_EMISSARY)
  })

  test('INTENT_EXECUTOR + verifyExecutions: false (no actions) returns undefined', async () => {
    const quote = makeQuote('INTENT_EXECUTOR')
    const signers = makeSessionSigners(sessionNoActions)
    const result = await getTargetExecutionSignature(
      config,
      quote,
      base,
      signers,
    )
    expect(result).toBeUndefined()
  })

  test('explicit verifyExecutions: false on signers overrides session with actions', async () => {
    const quote = makeQuote('INTENT_EXECUTOR')
    const signers: SessionSignerSet = {
      type: 'experimental_session',
      session: sessionWithActions,
      verifyExecutions: false,
    }
    const result = await getTargetExecutionSignature(
      config,
      quote,
      base,
      signers,
    )
    expect(result).toBeUndefined()
  })

  test('explicit verifyExecutions: true on signers overrides session without actions', async () => {
    const quote = makeQuote('INTENT_EXECUTOR')
    const signers: SessionSignerSet = {
      type: 'experimental_session',
      session: sessionNoActions,
      verifyExecutions: true,
    }
    const result = await getTargetExecutionSignature(
      config,
      quote,
      base,
      signers,
    )
    expect(result).toBe(MOCK_EMISSARY)
  })

  test('session not yet enabled still resolves verifyExecutions from actions', async () => {
    mockIsSessionEnabled.mockResolvedValueOnce(false)
    const quote = makeQuote('INTENT_EXECUTOR')
    const signers = makeSessionSigners(sessionWithActions)
    const result = await getTargetExecutionSignature(
      config,
      quote,
      base,
      signers,
    )
    expect(result).toBe(MOCK_EMISSARY)
  })

  test('ACROSS with a served payload returns undefined', async () => {
    const quote = makeQuote('ACROSS')
    const signers = makeSessionSigners(sessionWithActions)
    const result = await getTargetExecutionSignature(
      config,
      quote,
      base,
      signers,
    )
    expect(result).toBeUndefined()
  })

  test('INTENT_EXECUTOR without a served payload returns undefined', async () => {
    const quote = makeQuote('INTENT_EXECUTOR', { targetExecution: false })
    const signers = makeSessionSigners(sessionWithActions)
    const result = await getTargetExecutionSignature(
      config,
      quote,
      base,
      signers,
    )
    expect(result).toBeUndefined()
    expect(mockGetEmissarySignature).not.toHaveBeenCalled()
  })

  test('INTENT_EXECUTOR + verifyExecutions: true returns emissary sig', async () => {
    const quote = makeQuote('INTENT_EXECUTOR')
    const signers = makeSessionSigners(sessionWithActions)
    const result = await getTargetExecutionSignature(
      config,
      quote,
      base,
      signers,
    )
    expect(result).toBe(MOCK_EMISSARY)
    expect(mockGetEmissarySignature).toHaveBeenCalledTimes(1)
    expect(mockGetEip1271Signature).not.toHaveBeenCalled()
  })
})

describe('multi-chain intent signing', () => {
  const recorded = () =>
    quoteFromBlanc(
      recordedQuotes.devMultiChainOpsRoute as unknown as BlancRoute,
    )
  const quorumConfig: RhinestoneConfig = {
    ...config,
    owners: {
      type: 'quorum',
      module: MOCK_VALIDATOR,
      owners: [{ account: accountA, weight: 1n }],
      thresholdWeight: 1n,
    },
  }
  const quorumSigners: SignerSet = {
    type: 'owner',
    kind: 'quorum',
    accounts: [accountA],
  }

  test('signs the recorded route once using the first leaf chain', async () => {
    const result = await signIntent(config, recorded(), base, ownerSigners)
    expect(result.originSignatures).toHaveLength(1)
    expect(result.destinationSignature).toBe(result.originSignatures[0])
    expect(getChainById).toHaveBeenCalledWith(421614)
  })

  test.each(['session', 'quorum', 'K1'] as const)(
    'rejects %s before signing',
    async (kind) => {
      if (kind === 'K1') {
        vi.mocked(getOwnerValidator).mockReturnValueOnce({
          address: '0x0000000000000000000000000000000000000000',
        } as never)
        vi.mocked(supportsEip712).mockReturnValueOnce(true)
      }
      const signers =
        kind === 'session'
          ? makeSessionSigners(sessionNoActions)
          : kind === 'quorum'
            ? quorumSigners
            : ownerSigners
      const expected =
        kind === 'session'
          ? 'smart session'
          : kind === 'quorum'
            ? 'quorum validator'
            : "Startale's K1 validator"
      await expect(
        signIntent(
          kind === 'quorum' ? quorumConfig : config,
          recorded(),
          base,
          signers,
        ),
      ).rejects.toThrow(expected)
      expect(mockGetEip1271Signature).not.toHaveBeenCalled()
      expect(mockGetEmissarySignature).not.toHaveBeenCalled()
      expect(mockSignQuorumHash).not.toHaveBeenCalled()
      expect(getTypedDataPackedSignature).not.toHaveBeenCalled()
    },
  )

  test('rejects implicit quorum owners before signing', async () => {
    await expect(signIntent(quorumConfig, recorded(), base)).rejects.toThrow(
      'quorum validator',
    )
    expect(mockGetEip1271Signature).not.toHaveBeenCalled()
    expect(mockSignQuorumHash).not.toHaveBeenCalled()
  })

  test('allows guardians on a quorum-owned account', async () => {
    const guardianValidator = {
      address: '0x4444444444444444444444444444444444444444',
      type: 1,
      initData: '0x',
      deInitData: '0x',
      additionalContext: '0x',
    } as const
    vi.mocked(getSocialRecoveryValidator).mockReturnValue(guardianValidator)
    const guardians: SignerSet = {
      type: 'guardians',
      guardians: [accountA],
    }
    const result = await signIntent(quorumConfig, recorded(), base, guardians)
    expect(result.originSignatures).toHaveLength(1)
    expect(result.destinationSignature).toBe(result.originSignatures[0])
    expect(mockGetEip1271Signature).toHaveBeenCalledWith(
      quorumConfig,
      guardians,
      base,
      { address: guardianValidator.address, isRoot: false },
      expect.any(String),
    )
    expect(mockSignQuorumHash).not.toHaveBeenCalled()
  })

  test('signs two same-chain chainless payloads with the quorum Merkle path', async () => {
    const quote = recorded()
    const payload = quote.signData.origin[0]
    const message = payload.message as { ops: { chainId: bigint }[] }
    message.ops[1].chainId = message.ops[0].chainId
    quote.signData.origin = [payload, payload]
    quote.signData.destination = payload
    const result = await signIntent(quorumConfig, quote, base, quorumSigners)
    expect(result.originSignatures).toHaveLength(2)
    expect(mockSignQuorumHash).toHaveBeenCalledOnce()
  })

  test('signs same-chain chainless payload with Startale K1', async () => {
    vi.mocked(getOwnerValidator).mockReturnValue({
      address: '0x0000000000000000000000000000000000000000',
    } as never)
    vi.mocked(supportsEip712).mockReturnValue(true)
    vi.mocked(getEip712Domain).mockReturnValue({
      name: 'Startale',
      version: '1',
      chainId: base.id,
      verifyingContract: MOCK_ACCOUNT,
      salt: `0x${'00'.repeat(32)}`,
    })
    const quote = recorded()
    const payload = quote.signData.origin[0]
    const message = payload.message as { ops: { chainId: bigint }[] }
    for (const op of message.ops) op.chainId = BigInt(base.id)
    quote.signData.destination = payload
    const result = await signIntent(config, quote, base, ownerSigners)
    expect(result.originSignatures).toHaveLength(1)
    expect(mockGetEip1271Signature).toHaveBeenCalledTimes(2)
    expect(getEip712Domain).toHaveBeenCalledWith(config, base)
  })

  test('signs same-chain chainless payload with a session', async () => {
    const quote = recorded()
    const payload = quote.signData.origin[0]
    const message = payload.message as { ops: { chainId: bigint }[] }
    message.ops[1].chainId = message.ops[0].chainId
    quote.signData.destination = payload
    const result = await signIntent(
      config,
      quote,
      base,
      makeSessionSigners(sessionNoActions),
    )
    expect(result.originSignatures).toHaveLength(1)
    expect(mockGetEip1271Signature).toHaveBeenCalled()
  })
})

describe('signIntent with owner signers', () => {
  test('gives EIP-1271 destinationSignature, not emissary', async () => {
    const quote = makeQuote('INTENT_EXECUTOR')
    const { destinationSignature, originSignatures } = await signIntent(
      config,
      quote,
      base,
      ownerSigners,
    )
    expect(destinationSignature).toBe(MOCK_EIP1271)
    expect(mockGetEip1271Signature).toHaveBeenCalled()
    expect(mockGetEmissarySignature).not.toHaveBeenCalled()
    expect(originSignatures).toHaveLength(1)
  })
})

describe('signIntent with quorum owners', () => {
  test('signs one Merkle root and emits a proof envelope per origin', async () => {
    const quorumConfig: RhinestoneConfig = {
      ...config,
      owners: {
        type: 'quorum',
        module: MOCK_VALIDATOR,
        owners: [{ account: accountA, weight: 1n }],
        thresholdWeight: 1n,
      },
    }
    const quorumSigners: SignerSet = {
      type: 'owner',
      kind: 'quorum',
      accounts: [accountA],
    }

    const { originSignatures, destinationSignature } = await signIntent(
      quorumConfig,
      makeQuote('INTENT_EXECUTOR', { origins: 2 }),
      base,
      quorumSigners,
    )

    expect(mockSignQuorumHash).toHaveBeenCalledTimes(1)
    expect(originSignatures).toHaveLength(2)
    expect(
      originSignatures.every((signature) => signature.endsWith('ab')),
    ).toBe(true)
    expect(mockPackEip1271Signature).toHaveBeenCalledTimes(2)
    expect(destinationSignature).toBe(originSignatures[1])
    expect(mockGetEip1271Signature).not.toHaveBeenCalled()
  })
})

describe('signIntent destinationSignature', () => {
  test('verifyExecutions: true + INTENT_EXECUTOR — emissary destinationSignature, both sigs generated', async () => {
    const quote = makeQuote('INTENT_EXECUTOR')
    const signers = makeSessionSigners(sessionWithActions)
    const { destinationSignature, originSignatures } = await signIntent(
      config,
      quote,
      base,
      signers,
    )
    // destinationSignature picks preClaimSig (emissary format) from the { preClaimSig, notarizedClaimSig } pair
    expect(destinationSignature).toBe(MOCK_EMISSARY)
    // Both emissary and EIP-1271 are produced internally (preClaimSig + notarizedClaimSig)
    expect(mockGetEmissarySignature).toHaveBeenCalled()
    expect(mockGetEip1271Signature).toHaveBeenCalled()
    expect(originSignatures).toHaveLength(1)
  })

  test('verifyExecutions: false + INTENT_EXECUTOR — EIP-1271 destinationSignature only', async () => {
    const quote = makeQuote('INTENT_EXECUTOR')
    const signers = makeSessionSigners(sessionNoActions)
    const { destinationSignature, originSignatures } = await signIntent(
      config,
      quote,
      base,
      signers,
    )
    expect(destinationSignature).toBe(MOCK_EIP1271)
    expect(mockGetEmissarySignature).not.toHaveBeenCalled()
    expect(originSignatures).toHaveLength(1)
  })

  test('verifyExecutions: true + SAME_CHAIN — emissary destinationSignature', async () => {
    const quote = makeQuote('SAME_CHAIN')
    const signers = makeSessionSigners(sessionWithActions)
    const { destinationSignature } = await signIntent(
      config,
      quote,
      base,
      signers,
    )
    expect(destinationSignature).toBe(MOCK_EMISSARY)
  })

  test('multi-element op produces one originSignature per element', async () => {
    const quote = makeQuote('INTENT_EXECUTOR', { origins: 2 })
    const signers = makeSessionSigners(sessionWithActions)
    const { originSignatures } = await signIntent(config, quote, base, signers)
    expect(originSignatures).toHaveLength(2)
  })
})

describe('signIntent + getTargetExecutionSignature routing', () => {
  test('INTENT_EXECUTOR + verifyExecutions: true — EMISSARY for both', async () => {
    const quote = makeQuote('INTENT_EXECUTOR')
    const signers = makeSessionSigners(sessionWithActions)

    const { destinationSignature } = await signIntent(
      config,
      quote,
      base,
      signers,
    )
    const targetExecutionSignature = await getTargetExecutionSignature(
      config,
      quote,
      base,
      signers,
    )

    expect(destinationSignature).toBe(MOCK_EMISSARY)
    expect(targetExecutionSignature).toBe(MOCK_EMISSARY)
  })

  test('INTENT_EXECUTOR + verifyExecutions: false — EIP-1271 destination, undefined target', async () => {
    const quote = makeQuote('INTENT_EXECUTOR')
    const signers = makeSessionSigners(sessionNoActions)

    const { destinationSignature } = await signIntent(
      config,
      quote,
      base,
      signers,
    )
    const targetExecutionSignature = await getTargetExecutionSignature(
      config,
      quote,
      base,
      signers,
    )

    expect(destinationSignature).toBe(MOCK_EIP1271)
    expect(targetExecutionSignature).toBeUndefined()
  })

  test('SAME_CHAIN + verifyExecutions: true — EMISSARY for both destination and target', async () => {
    const quote = makeQuote('SAME_CHAIN')
    const signers = makeSessionSigners(sessionWithActions)

    const { destinationSignature } = await signIntent(
      config,
      quote,
      base,
      signers,
    )
    const targetExecutionSignature = await getTargetExecutionSignature(
      config,
      quote,
      base,
      signers,
    )

    expect(destinationSignature).toBe(MOCK_EMISSARY)
    expect(targetExecutionSignature).toBe(MOCK_EMISSARY)
  })
})

// Permit2 typed data shape that triggers resolveClaimPolicyData
const MOCK_PERMIT2_TYPED_DATA = {
  domain: { name: 'Permit2', chainId: 8453, verifyingContract: MOCK_EXECUTOR },
  types: {
    PermitBatchWitnessTransferFrom: [{ name: 'nonce', type: 'uint256' }],
  },
  primaryType: 'PermitBatchWitnessTransferFrom' as const,
  message: {
    permitted: [
      { token: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', amount: 20000n },
    ],
    spender: MOCK_EXECUTOR,
    nonce: 1n,
    deadline: 9999999999n,
    mandate: {
      target: {
        recipient: MOCK_ACCOUNT,
        tokenOut: [],
        targetChain: 8453n,
        fillExpiry: 9999999999n,
      },
      minGas: 0n,
      originOps: { vt: `0x${'00'.repeat(32)}` as Hex, ops: [] },
      destOps: { vt: `0x${'00'.repeat(32)}` as Hex, ops: [] },
      q: `0x${'ab'.repeat(32)}` as Hex,
    },
  },
}

const makePermit2Quote = () =>
  makeQuote('SAME_CHAIN', {
    origin: MOCK_PERMIT2_TYPED_DATA as unknown as TypedDataDefinition,
  })

const sessionWithClaimPolicy: Session = {
  chain: base,
  owners: { type: 'ecdsa', accounts: [accountA] },
  actions: [{ policies: [{ type: 'usage-limit', limit: 1n }] }],
  claimPolicies: [{ type: 'permit2-claim' }],
}

describe('signIntent with permit2 claim policy', () => {
  test('Permit2 typed data + claimPolicies → getEip1271Signature called with claimPolicyData', async () => {
    const signers: SessionSignerSet = {
      type: 'experimental_session',
      session: sessionWithClaimPolicy,
      verifyExecutions: true,
    }

    await signIntent(config, makePermit2Quote(), base, signers)

    expect(mockGetEip1271Signature).toHaveBeenCalled()
    const sessionSignersArg = mockGetEip1271Signature.mock.calls[0][1] as {
      claimPolicyData?: Hex
    }
    expect(sessionSignersArg.claimPolicyData).toBeDefined()
    expect(sessionSignersArg.claimPolicyData).not.toBe('0x')
  })

  test('non-Permit2 typed data + claimPolicies → getEip1271Signature called without claimPolicyData', async () => {
    // MOCK_TYPED_DATA (primaryType: 'Test') is not Permit2
    const signers: SessionSignerSet = {
      type: 'experimental_session',
      session: sessionWithClaimPolicy,
      verifyExecutions: true,
    }

    await signIntent(config, makeQuote('INTENT_EXECUTOR'), base, signers)

    expect(mockGetEip1271Signature).toHaveBeenCalled()
    const sessionSignersArg = mockGetEip1271Signature.mock.calls[0][1] as {
      claimPolicyData?: Hex
    }
    expect(sessionSignersArg.claimPolicyData).toBeUndefined()
  })

  test('Permit2 typed data without claimPolicies → getEip1271Signature called without claimPolicyData', async () => {
    const signers: SessionSignerSet = {
      type: 'experimental_session',
      session: sessionWithActions, // no claimPolicies
      verifyExecutions: true,
    }

    await signIntent(config, makePermit2Quote(), base, signers)

    expect(mockGetEip1271Signature).toHaveBeenCalled()
    const sessionSignersArg = mockGetEip1271Signature.mock.calls[0][1] as {
      claimPolicyData?: Hex
    }
    expect(sessionSignersArg.claimPolicyData).toBeUndefined()
  })
})

describe('signPermits', () => {
  const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
  const WETH = '0x4200000000000000000000000000000000000006'
  const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
  // As it arrives on the wire: uints as strings, EIP712Domain included.
  const permit = {
    domain: {
      name: 'USD Coin',
      version: '2',
      chainId: 8453,
      verifyingContract: USDC,
    },
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      Permit: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'Permit',
    message: {
      owner: accountA.address,
      spender: PERMIT2,
      value: (2n ** 256n - 1n).toString(),
      nonce: '0',
      deadline: '1800000000',
    },
  }
  const quote = {
    tokenRequirements: {
      8453: {
        [USDC]: { type: 'approval', amount: 1n, spender: PERMIT2, permit },
        [WETH]: { type: 'approval', amount: 1n, spender: PERMIT2 },
      },
    },
  } as unknown as Quote
  const eoaConfig = {
    account: { type: 'eoa' },
    eoa: accountA,
  } as unknown as RhinestoneConfig

  test('signs each offered permit with the EOA, keyed by chain and token', async () => {
    const signatures = await signPermits(eoaConfig, quote)

    expect(Object.keys(signatures?.[8453] ?? {})).toEqual([USDC])
    const { EIP712Domain: _, ...types } = permit.types
    expect(
      await verifyTypedData({
        address: accountA.address,
        domain: permit.domain,
        types,
        primaryType: 'Permit',
        message: {
          ...permit.message,
          value: BigInt(permit.message.value),
          nonce: 0n,
          deadline: 1800000000n,
        },
        signature: signatures?.[8453]?.[USDC] as Hex,
      }),
    ).toBe(true)
  })

  test('returns undefined when no permit is offered', async () => {
    expect(
      await signPermits(eoaConfig, {
        tokenRequirements: {},
      } as unknown as Quote),
    ).toBeUndefined()
  })

  test('signs nothing for a smart account', async () => {
    const smartAccountConfig = {
      owners: { type: 'ecdsa', accounts: [accountA], threshold: 1 },
      eoa: accountA,
    } as unknown as RhinestoneConfig
    expect(await signPermits(smartAccountConfig, quote)).toBeUndefined()
  })
})

describe('signIntent destination payload', () => {
  const recorded = (id: string) => {
    const found = (
      recordedQuotes as unknown as {
        cases: { id: string; blanc: { body?: { routes: BlancRoute[] } } }[]
      }
    ).cases.find((entry) => entry.id === id)
    return quoteFromBlanc(found!.blanc.body!.routes[0])
  }

  beforeEach(() => {
    let call = 0
    mockGetEip1271Signature.mockImplementation(
      async () => `0x0${++call}` as Hex,
    )
  })

  test('reuses the origin signature over the same payload (relayer-delivered CCTP)', async () => {
    // A destination-chain child payload, then the burn, which is the
    // destination.
    const quote = recorded('unfunded/nexus')
    expect(quote.signData.origin).toHaveLength(2)
    const { originSignatures, destinationSignature } = await signIntent(
      config,
      quote,
      base,
      ownerSigners,
    )
    expect(originSignatures).toEqual(['0x01', '0x02'])
    expect(destinationSignature).toBe('0x02')
  })

  test('reuses the matching origin signature even when it is not the last', async () => {
    const other = {
      ...MOCK_TYPED_DATA,
      message: { value: 2n },
    } as TypedDataDefinition
    const quote = makeQuote('INTENT_EXECUTOR')
    quote.signData = {
      origin: [MOCK_TYPED_DATA as TypedDataDefinition, other],
      destination: MOCK_TYPED_DATA as TypedDataDefinition,
    }
    const { destinationSignature } = await signIntent(
      config,
      quote,
      base,
      ownerSigners,
    )
    expect(destinationSignature).toBe('0x01')
  })

  test('signs a destination no origin payload matches on its own chain', async () => {
    const destination = {
      ...MOCK_TYPED_DATA,
      domain: { ...MOCK_TYPED_DATA.domain, chainId: 10 },
    } as TypedDataDefinition
    const quote = makeQuote('INTENT_EXECUTOR')
    quote.signData = {
      origin: [MOCK_TYPED_DATA as TypedDataDefinition],
      destination,
    }
    const { originSignatures, destinationSignature } = await signIntent(
      config,
      quote,
      base,
      ownerSigners,
    )
    expect(originSignatures).toEqual(['0x01'])
    expect(destinationSignature).toBe('0x02')
    expect(vi.mocked(getChainById)).toHaveBeenCalledWith(10)
  })
})
