import type { Hex } from 'viem'
import { base } from 'viem/chains'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { accountA } from '../../test/consts'
import type { SignData } from '../orchestrator/types'
import type {
  RhinestoneConfig,
  Session,
  SessionSignerSet,
  SignerSet,
} from '../types'
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
  SignerNotSupportedError: class extends Error {},
}))

// --- Helpers ---

const makeSignData = (opts?: {
  originCount?: number
  withTargetExecution?: boolean
}): SignData => ({
  origin: Array.from({ length: opts?.originCount ?? 1 }, () => MOCK_TYPED_DATA),
  destination: MOCK_TYPED_DATA,
  targetExecution: opts?.withTargetExecution ? MOCK_TYPED_DATA : undefined,
})

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
  mockGetEmissarySignature.mockResolvedValue(MOCK_EMISSARY)
  mockGetEip1271Signature.mockResolvedValue(MOCK_EIP1271)
  mockIsSessionEnabled.mockResolvedValue(true)
})

describe('getTargetExecutionSignature', () => {
  test('undefined signers returns undefined', async () => {
    const result = await getTargetExecutionSignature(
      config,
      makeSignData({ withTargetExecution: true }),
      base,
      undefined,
    )
    expect(result).toBeUndefined()
  })

  test('non-session signers returns undefined', async () => {
    const result = await getTargetExecutionSignature(
      config,
      makeSignData({ withTargetExecution: true }),
      base,
      ownerSigners,
    )
    expect(result).toBeUndefined()
  })

  test('signData omits targetExecution returns undefined', async () => {
    const signers = makeSessionSigners(sessionWithActions)
    const result = await getTargetExecutionSignature(
      config,
      makeSignData(),
      base,
      signers,
    )
    expect(result).toBeUndefined()
  })

  test('targetExecution + verifyExecutions: true returns emissary sig', async () => {
    const signers = makeSessionSigners(sessionWithActions)
    const result = await getTargetExecutionSignature(
      config,
      makeSignData({ withTargetExecution: true }),
      base,
      signers,
    )
    expect(result).toBe(MOCK_EMISSARY)
  })

  test('targetExecution + verifyExecutions: false (no actions) returns undefined', async () => {
    const signers = makeSessionSigners(sessionNoActions)
    const result = await getTargetExecutionSignature(
      config,
      makeSignData({ withTargetExecution: true }),
      base,
      signers,
    )
    expect(result).toBeUndefined()
  })

  test('explicit verifyExecutions: false on signers overrides session with actions', async () => {
    const signers: SessionSignerSet = {
      type: 'experimental_session',
      session: sessionWithActions,
      verifyExecutions: false,
    }
    const result = await getTargetExecutionSignature(
      config,
      makeSignData({ withTargetExecution: true }),
      base,
      signers,
    )
    expect(result).toBeUndefined()
  })

  test('explicit verifyExecutions: true on signers overrides session without actions', async () => {
    const signers: SessionSignerSet = {
      type: 'experimental_session',
      session: sessionNoActions,
      verifyExecutions: true,
    }
    const result = await getTargetExecutionSignature(
      config,
      makeSignData({ withTargetExecution: true }),
      base,
      signers,
    )
    expect(result).toBe(MOCK_EMISSARY)
  })

  test('session not yet enabled still resolves verifyExecutions from actions', async () => {
    mockIsSessionEnabled.mockResolvedValueOnce(false)
    const signers = makeSessionSigners(sessionWithActions)
    const result = await getTargetExecutionSignature(
      config,
      makeSignData({ withTargetExecution: true }),
      base,
      signers,
    )
    expect(result).toBe(MOCK_EMISSARY)
  })
})

describe('signIntent with owner signers', () => {
  test('gives EIP-1271 destinationSignature, not emissary', async () => {
    const { destinationSignature, originSignatures } = await signIntent(
      config,
      makeSignData(),
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
  test('verifyExecutions: true — emissary destinationSignature, both sigs generated', async () => {
    const signers = makeSessionSigners(sessionWithActions)
    const { destinationSignature, originSignatures } = await signIntent(
      config,
      makeSignData(),
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

  test('verifyExecutions: false — EIP-1271 destinationSignature only', async () => {
    const signers = makeSessionSigners(sessionNoActions)
    const { destinationSignature, originSignatures } = await signIntent(
      config,
      makeSignData(),
      base,
      signers,
    )
    expect(destinationSignature).toBe(MOCK_EIP1271)
    expect(mockGetEmissarySignature).not.toHaveBeenCalled()
    expect(originSignatures).toHaveLength(1)
  })

  test('multi-element signData produces one originSignature per element', async () => {
    const signers = makeSessionSigners(sessionWithActions)
    const { originSignatures } = await signIntent(
      config,
      makeSignData({ originCount: 2 }),
      base,
      signers,
    )
    expect(originSignatures).toHaveLength(2)
  })
})

describe('signIntent + getTargetExecutionSignature routing', () => {
  test('verifyExecutions: true — EMISSARY for both destination and target', async () => {
    const signers = makeSessionSigners(sessionWithActions)
    const signData = makeSignData({ withTargetExecution: true })

    const { destinationSignature } = await signIntent(
      config,
      signData,
      base,
      signers,
    )
    const targetExecutionSignature = await getTargetExecutionSignature(
      config,
      signData,
      base,
      signers,
    )

    expect(destinationSignature).toBe(MOCK_EMISSARY)
    expect(targetExecutionSignature).toBe(MOCK_EMISSARY)
  })

  test('verifyExecutions: false + targetExecution present — EIP-1271 destination, undefined target', async () => {
    const signers = makeSessionSigners(sessionNoActions)
    const signData = makeSignData({ withTargetExecution: true })

    const { destinationSignature } = await signIntent(
      config,
      signData,
      base,
      signers,
    )
    const targetExecutionSignature = await getTargetExecutionSignature(
      config,
      signData,
      base,
      signers,
    )

    expect(destinationSignature).toBe(MOCK_EIP1271)
    expect(targetExecutionSignature).toBeUndefined()
  })
})

// Permit2 typed data shape that triggers resolveClaimPolicyData
const MOCK_PERMIT2_TYPED_DATA = {
  domain: {
    name: 'Permit2',
    chainId: base.id,
    verifyingContract: MOCK_EXECUTOR,
  },
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

const sessionWithClaimPolicy: Session = {
  chain: base,
  owners: { type: 'ecdsa', accounts: [accountA] },
  actions: [{ policies: [{ type: 'usage-limit', limit: 1n }] }],
  claimPolicies: [{ type: 'permit2-claim' }],
}

const makePermit2SignData = (): SignData => ({
  origin: [MOCK_PERMIT2_TYPED_DATA as unknown as SignData['origin'][number]],
  destination: MOCK_PERMIT2_TYPED_DATA as unknown as SignData['destination'],
})

describe('signIntent with permit2 claim policy', () => {
  test('Permit2 typed data + claimPolicies → getEip1271Signature called with claimPolicyData', async () => {
    const signers: SessionSignerSet = {
      type: 'experimental_session',
      session: sessionWithClaimPolicy,
      verifyExecutions: true,
    }

    await signIntent(config, makePermit2SignData(), base, signers)

    expect(mockGetEip1271Signature).toHaveBeenCalled()
    const sessionSignersArg = mockGetEip1271Signature.mock.calls[0][1] as {
      claimPolicyData?: Hex
    }
    expect(sessionSignersArg.claimPolicyData).toBeDefined()
    expect(sessionSignersArg.claimPolicyData).not.toBe('0x')
  })

  test('non-Permit2 typed data + claimPolicies → getEip1271Signature called without claimPolicyData', async () => {
    const signers: SessionSignerSet = {
      type: 'experimental_session',
      session: sessionWithClaimPolicy,
      verifyExecutions: true,
    }

    await signIntent(config, makeSignData(), base, signers)

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

    await signIntent(config, makePermit2SignData(), base, signers)

    expect(mockGetEip1271Signature).toHaveBeenCalled()
    const sessionSignersArg = mockGetEip1271Signature.mock.calls[0][1] as {
      claimPolicyData?: Hex
    }
    expect(sessionSignersArg.claimPolicyData).toBeUndefined()
  })
})
