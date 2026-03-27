import { type Hex, zeroAddress } from 'viem'
import { base } from 'viem/chains'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { accountA } from '../../test/consts'
import type {
  IntentOp,
  IntentOpElement,
  SettlementLayer,
} from '../orchestrator/types'
import type { RhinestoneConfig, Session, SessionSignerSet } from '../types'
import { getTargetExecutionSignature, signIntent } from './utils'

const {
  MOCK_EMISSARY,
  MOCK_EIP1271,
  MOCK_ACCOUNT,
  MOCK_EXECUTOR,
  MOCK_VALIDATOR,
  mockGetEmissarySignature,
  mockGetEip1271Signature,
  mockIsSessionEnabled,
  MOCK_TYPED_DATA,
} = vi.hoisted(() => {
  const MOCK_ACCOUNT = '0x1111111111111111111111111111111111111111'
  const MOCK_EXECUTOR = '0x2222222222222222222222222222222222222222'
  const MOCK_VALIDATOR = '0x3333333333333333333333333333333333333333'
  const MOCK_EMISSARY = `0x${'ee'.repeat(65)}`
  const MOCK_EIP1271 = `0x${'12'.repeat(65)}`

  const mockGetEmissarySignature = vi.fn().mockResolvedValue(MOCK_EMISSARY)
  const mockGetEip1271Signature = vi.fn().mockResolvedValue(MOCK_EIP1271)
  const mockIsSessionEnabled = vi.fn().mockResolvedValue(true)

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
    mockIsSessionEnabled,
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
  getSmartAccount: vi.fn(),
  getEip712Domain: vi.fn(),
  getAccountProvider: vi.fn(),
  getInitCode: vi.fn(),
  getGuardianSmartAccount: vi.fn(),
  getTypedDataPackedSignature: vi.fn(),
  toErc6492Signature: vi.fn(),
  is7702: vi.fn().mockReturnValue(false),
  getEip7702InitCall: vi.fn(),
  EoaAccountMustHaveAccountError: class extends Error {},
  EoaSigningMethodNotConfiguredError: class extends Error {},
  FactoryArgsNotAvailableError: class extends Error {},
}))

vi.mock('../accounts/signing/common', () => ({
  convertOwnerSetToSignerSet: vi.fn(),
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
  getPermissionId: vi.fn().mockReturnValue('0x' + 'cc'.repeat(32)),
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

vi.mock('./singleChainOps', () => ({
  getTypedData: vi.fn().mockReturnValue(MOCK_TYPED_DATA),
}))

vi.mock('./compact', () => ({
  getCompactTypedData: vi.fn().mockReturnValue(MOCK_TYPED_DATA),
}))

vi.mock('./error', () => ({
  Eip7702InitSignatureRequiredError: class extends Error {},
  SignerNotSupportedError: class extends Error {},
}))

vi.mock('./permit2', () => ({
  getTypedData: vi.fn().mockReturnValue(MOCK_TYPED_DATA),
}))

// --- Helpers ---

const makeElement = (settlementLayer: SettlementLayer): IntentOpElement =>
  ({
    mandate: {
      destinationChainId: base.id,
      destinationOps: {
        vt: ('0x' + '00'.repeat(32)) as Hex,
        ops: [],
      },
      preClaimOps: {
        vt: ('0x' + '00'.repeat(32)) as Hex,
        ops: [],
      },
      qualifier: {
        settlementContext: {
          settlementLayer,
          fundingMethod: 'NO_FUNDING',
          using7579: true,
          gasRefund: {
            token: zeroAddress,
            exchangeRate: 0n,
            overhead: 0n,
          },
        },
      },
    },
  }) as unknown as IntentOpElement

const makeIntentOp = (
  settlementLayer: SettlementLayer | SettlementLayer[],
  targetExecutionNonce = '200',
): IntentOp => {
  const layers = Array.isArray(settlementLayer)
    ? settlementLayer
    : [settlementLayer]
  return {
    sponsor: MOCK_ACCOUNT,
    nonce: '100',
    targetExecutionNonce,
    expires: '9999999999',
    elements: layers.map(makeElement),
    serverSignature: '0x',
    signedMetadata: { fees: {} },
  } as unknown as IntentOp
}

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

const ownerSigners = {
  type: 'owner',
  kind: 'ecdsa',
  accounts: [accountA],
} as const

// --- Tests ---

beforeEach(() => {
  vi.clearAllMocks()
  mockGetEmissarySignature.mockResolvedValue(MOCK_EMISSARY)
  mockGetEip1271Signature.mockResolvedValue(MOCK_EIP1271)
  mockIsSessionEnabled.mockResolvedValue(true)
})

describe('getTargetExecutionSignature', () => {
  test('undefined signers returns undefined', async () => {
    const intentOp = makeIntentOp('INTENT_EXECUTOR')
    const result = await getTargetExecutionSignature(
      config,
      intentOp,
      base,
      undefined,
    )
    expect(result).toBeUndefined()
  })

  test('non-session signers returns undefined', async () => {
    const intentOp = makeIntentOp('INTENT_EXECUTOR')
    const result = await getTargetExecutionSignature(
      config,
      intentOp,
      base,
      ownerSigners,
    )
    expect(result).toBeUndefined()
  })

  test('no INTENT_EXECUTOR ops (SAME_CHAIN only) returns undefined', async () => {
    // PERMIT2 settlement also uses SAME_CHAIN layer — both are covered by this case
    const intentOp = makeIntentOp('SAME_CHAIN')
    const signers = makeSessionSigners(sessionWithActions)
    const result = await getTargetExecutionSignature(
      config,
      intentOp,
      base,
      signers,
    )
    expect(result).toBeUndefined()
  })

  test('INTENT_EXECUTOR + verifyExecutions: false (no actions) returns undefined', async () => {
    const intentOp = makeIntentOp('INTENT_EXECUTOR')
    const signers = makeSessionSigners(sessionNoActions)
    const result = await getTargetExecutionSignature(
      config,
      intentOp,
      base,
      signers,
    )
    expect(result).toBeUndefined()
  })

  test('explicit verifyExecutions: false on signers overrides session with actions', async () => {
    const intentOp = makeIntentOp('INTENT_EXECUTOR')
    const signers: SessionSignerSet = {
      type: 'experimental_session',
      session: sessionWithActions,
      verifyExecutions: false,
    }
    const result = await getTargetExecutionSignature(
      config,
      intentOp,
      base,
      signers,
    )
    expect(result).toBeUndefined()
  })

  test('explicit verifyExecutions: true on signers overrides session without actions', async () => {
    const intentOp = makeIntentOp('INTENT_EXECUTOR')
    const signers: SessionSignerSet = {
      type: 'experimental_session',
      session: sessionNoActions,
      verifyExecutions: true,
    }
    const result = await getTargetExecutionSignature(
      config,
      intentOp,
      base,
      signers,
    )
    expect(result).toBe(MOCK_EMISSARY)
  })

  test('session not yet enabled still resolves verifyExecutions from actions', async () => {
    mockIsSessionEnabled.mockResolvedValueOnce(false)
    const intentOp = makeIntentOp('INTENT_EXECUTOR')
    const signers = makeSessionSigners(sessionWithActions)
    const result = await getTargetExecutionSignature(
      config,
      intentOp,
      base,
      signers,
    )
    expect(result).toBe(MOCK_EMISSARY)
  })

  test('mixed INTENT_EXECUTOR + SAME_CHAIN elements returns emissary sig', async () => {
    const intentOp = makeIntentOp(['INTENT_EXECUTOR', 'SAME_CHAIN'])
    const signers = makeSessionSigners(sessionWithActions)
    const result = await getTargetExecutionSignature(
      config,
      intentOp,
      base,
      signers,
    )
    expect(result).toBe(MOCK_EMISSARY)
  })

  test('INTENT_EXECUTOR + verifyExecutions: true returns emissary sig', async () => {
    const intentOp = makeIntentOp('INTENT_EXECUTOR')
    const signers = makeSessionSigners(sessionWithActions)
    const result = await getTargetExecutionSignature(
      config,
      intentOp,
      base,
      signers,
    )
    expect(result).toBe(MOCK_EMISSARY)
    expect(mockGetEmissarySignature).toHaveBeenCalledTimes(1)
    expect(mockGetEip1271Signature).not.toHaveBeenCalled()
  })
})

describe('signIntent with owner signers', () => {
  test('gives EIP-1271 destinationSignature, not emissary', async () => {
    const intentOp = makeIntentOp('INTENT_EXECUTOR')
    const { destinationSignature, originSignatures } = await signIntent(
      config,
      intentOp,
      base,
      ownerSigners,
    )
    expect(destinationSignature).toBe(MOCK_EIP1271)
    expect(mockGetEip1271Signature).toHaveBeenCalled()
    expect(mockGetEmissarySignature).not.toHaveBeenCalled()
    expect(originSignatures).toHaveLength(1)
  })
})

describe('signIntent destinationSignature', () => {
  test('verifyExecutions: true + INTENT_EXECUTOR — emissary destinationSignature, both sigs generated', async () => {
    const intentOp = makeIntentOp('INTENT_EXECUTOR')
    const signers = makeSessionSigners(sessionWithActions)
    const { destinationSignature, originSignatures } = await signIntent(
      config,
      intentOp,
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
    const intentOp = makeIntentOp('INTENT_EXECUTOR')
    const signers = makeSessionSigners(sessionNoActions)
    const { destinationSignature, originSignatures } = await signIntent(
      config,
      intentOp,
      base,
      signers,
    )
    expect(destinationSignature).toBe(MOCK_EIP1271)
    expect(mockGetEmissarySignature).not.toHaveBeenCalled()
    expect(originSignatures).toHaveLength(1)
  })

  test('verifyExecutions: true + SAME_CHAIN — emissary destinationSignature', async () => {
    const intentOp = makeIntentOp('SAME_CHAIN')
    const signers = makeSessionSigners(sessionWithActions)
    const { destinationSignature } = await signIntent(
      config,
      intentOp,
      base,
      signers,
    )
    expect(destinationSignature).toBe(MOCK_EMISSARY)
  })

  test('multi-element op produces one originSignature per element', async () => {
    const intentOp = makeIntentOp(['INTENT_EXECUTOR', 'INTENT_EXECUTOR'])
    const signers = makeSessionSigners(sessionWithActions)
    const { originSignatures } = await signIntent(
      config,
      intentOp,
      base,
      signers,
    )
    expect(originSignatures).toHaveLength(2)
  })
})

describe('signIntent + getTargetExecutionSignature routing', () => {
  test('INTENT_EXECUTOR + verifyExecutions: true — EMISSARY for both', async () => {
    const intentOp = makeIntentOp('INTENT_EXECUTOR')
    const signers = makeSessionSigners(sessionWithActions)

    const { destinationSignature } = await signIntent(
      config,
      intentOp,
      base,
      signers,
    )
    const targetExecutionSignature = await getTargetExecutionSignature(
      config,
      intentOp,
      base,
      signers,
    )

    expect(destinationSignature).toBe(MOCK_EMISSARY)
    expect(targetExecutionSignature).toBe(MOCK_EMISSARY)
  })

  test('INTENT_EXECUTOR + verifyExecutions: false — EIP-1271 destination, undefined target', async () => {
    const intentOp = makeIntentOp('INTENT_EXECUTOR')
    const signers = makeSessionSigners(sessionNoActions)

    const { destinationSignature } = await signIntent(
      config,
      intentOp,
      base,
      signers,
    )
    const targetExecutionSignature = await getTargetExecutionSignature(
      config,
      intentOp,
      base,
      signers,
    )

    expect(destinationSignature).toBe(MOCK_EIP1271)
    expect(targetExecutionSignature).toBeUndefined()
  })

  test('SAME_CHAIN + verifyExecutions: true — EMISSARY destination, undefined target', async () => {
    const intentOp = makeIntentOp('SAME_CHAIN')
    const signers = makeSessionSigners(sessionWithActions)

    const { destinationSignature } = await signIntent(
      config,
      intentOp,
      base,
      signers,
    )
    const targetExecutionSignature = await getTargetExecutionSignature(
      config,
      intentOp,
      base,
      signers,
    )

    expect(destinationSignature).toBe(MOCK_EMISSARY)
    expect(targetExecutionSignature).toBeUndefined()
  })
})
