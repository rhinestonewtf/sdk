import {
  type Address,
  encodeAbiParameters,
  encodePacked,
  erc20Abi,
  type Hex,
  isAddressEqual,
  parseEther,
  slice,
  zeroHash,
} from 'viem'
import { base } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { accountA, accountB } from '../../../test/consts'
import type { Session } from '../../types'
import { PERMIT2_CLAIM_POLICY_ADDRESS } from './policies/claim/permit2'
import type { ResolvedSessionSignerSet } from './smart-sessions'
import {
  buildMockSignature,
  DUMMY_PRECLAIMOP_SELECTOR,
  DUMMY_PRECLAIMOP_TARGET,
  getPermissionId,
  getPolicyData,
  getSessionData,
  INTENT_EXECUTION_POLICY_ADDRESS,
  packSignature,
  SMART_SESSION_EMISSARY_ADDRESS,
  SMART_SESSIONS_FALLBACK_TARGET_FLAG,
  SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG,
  SPENDING_LIMITS_POLICY_ADDRESS,
  SUDO_POLICY_ADDRESS,
  TIME_FRAME_POLICY_ADDRESS,
  toSession,
  UNIVERSAL_ACTION_POLICY_ADDRESS,
  USAGE_LIMIT_POLICY_ADDRESS,
  VALUE_LIMIT_POLICY_ADDRESS,
} from './smart-sessions'

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const baseSession: Session = toSession({
  chain: base,
  owners: { type: 'ecdsa', accounts: [accountA] },
})

const sessionWithAction: Session = toSession({
  chain: base,
  owners: { type: 'ecdsa', accounts: [accountA] },
  permissions: [
    {
      abi: erc20Abi,
      address: '0x1111111111111111111111111111111111111111' as Address,
      functions: {
        transfer: { policies: [{ type: 'sudo' }] },
      },
    },
  ],
})

const dummySig = `0x${'00'.repeat(65)}` as Hex
const USDC: Address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const RECIPIENT: Address = '0x1111111111111111111111111111111111111111'

// ---------------------------------------------------------------------------
// A. Policy encoding
// ---------------------------------------------------------------------------

describe('getPolicyData', () => {
  test('sudo → SUDO_POLICY_ADDRESS, empty initData', () => {
    const result = getPolicyData({ type: 'sudo' })
    expect(result.policy).toBe(SUDO_POLICY_ADDRESS)
    expect(result.initData).toBe('0x')
  })

  test('intent-execution → INTENT_EXECUTION_POLICY_ADDRESS, empty initData', () => {
    const result = getPolicyData({ type: 'intent-execution' })
    expect(result.policy).toBe(INTENT_EXECUTION_POLICY_ADDRESS)
    expect(result.initData).toBe('0x')
  })

  test('spending-limits encodes token addresses and amounts', () => {
    const token = '0xaabbccdd00000000000000000000000000000001' as Address
    const result = getPolicyData({
      type: 'spending-limits',
      limits: [{ token, amount: 1000n }],
    })
    expect(result.policy).toBe(SPENDING_LIMITS_POLICY_ADDRESS)
    const expected = encodeAbiParameters(
      [{ type: 'address[]' }, { type: 'uint256[]' }],
      [[token], [1000n]],
    )
    expect(result.initData).toBe(expected)
  })

  test('time-frame encodes validUntil/validAfter in seconds (ms → s)', () => {
    const validUntil = 1_800_000_000_000
    const validAfter = 1_700_000_000_000
    const result = getPolicyData({ type: 'time-frame', validUntil, validAfter })
    expect(result.policy).toBe(TIME_FRAME_POLICY_ADDRESS)
    const expected = encodePacked(
      ['uint48', 'uint48'],
      [Math.floor(validUntil / 1000), Math.floor(validAfter / 1000)],
    )
    expect(result.initData).toBe(expected)
  })

  test('usage-limit encodes limit as uint128', () => {
    const result = getPolicyData({ type: 'usage-limit', limit: 5n })
    expect(result.policy).toBe(USAGE_LIMIT_POLICY_ADDRESS)
    expect(result.initData).toBe(encodePacked(['uint128'], [5n]))
  })

  test('value-limit encodes limit as uint256', () => {
    const limit = parseEther('1')
    const result = getPolicyData({ type: 'value-limit', limit })
    expect(result.policy).toBe(VALUE_LIMIT_POLICY_ADDRESS)
    expect(result.initData).toBe(
      encodeAbiParameters([{ type: 'uint256' }], [limit]),
    )
  })

  test('universal-action → UNIVERSAL_ACTION_POLICY_ADDRESS, non-empty initData', () => {
    const result = getPolicyData({
      type: 'universal-action',
      valueLimitPerUse: 0n,
      rules: [
        {
          condition: 'equal',
          calldataOffset: 4n,
          referenceValue: 100n,
        },
      ],
    })
    expect(result.policy).toBe(UNIVERSAL_ACTION_POLICY_ADDRESS)
    expect(result.initData.length).toBeGreaterThan(2)
  })
})

// ---------------------------------------------------------------------------
// B. getSessionData
// ---------------------------------------------------------------------------

describe('getSessionData', () => {
  test('no actions → single sudoAction fallback', () => {
    const data = getSessionData(baseSession)
    expect(data.actions).toHaveLength(1)
    expect(data.actions[0].actionTarget).toBe(
      SMART_SESSIONS_FALLBACK_TARGET_FLAG,
    )
    expect(data.actions[0].actionTargetSelector).toBe(
      SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG,
    )
  })

  test('explicit actions → user action + 3 injected (WETH deposit + intent-execution fallback + dummy preclaimop)', () => {
    const data = getSessionData(sessionWithAction)
    expect(data.actions).toHaveLength(4)
    expect(data.actions[0].actionTarget).toBe(
      '0x1111111111111111111111111111111111111111',
    )
    // injected WETH deposit — target is the wrapped token (non-zero address)
    expect(data.actions[1].actionTarget).not.toBe(
      '0x0000000000000000000000000000000000000000',
    )
    // injected intent-execution fallback
    expect(data.actions[2].actionTarget).toBe(
      SMART_SESSIONS_FALLBACK_TARGET_FLAG,
    )
    // injected dummy preclaimop action
    expect(data.actions[3].actionTarget).toBe(DUMMY_PRECLAIMOP_TARGET)
    expect(data.actions[3].actionTargetSelector).toBe(DUMMY_PRECLAIMOP_SELECTOR)
  })

  test('dummy preclaimop action uses sudo policy', () => {
    const data = getSessionData(sessionWithAction)
    const dummyAction = data.actions.find(
      (a) => a.actionTargetSelector === DUMMY_PRECLAIMOP_SELECTOR,
    )
    expect(dummyAction).toBeDefined()
    expect(dummyAction!.actionPolicies).toHaveLength(1)
    expect(dummyAction!.actionPolicies[0].policy).toBe(SUDO_POLICY_ADDRESS)
    expect(dummyAction!.actionPolicies[0].initData).toBe('0x')
  })

  test('no explicit actions → sudoAction fallback only (dummy injected via injectedActions path is not used)', () => {
    // Sessions without explicit actions use the [sudoAction] fallback directly,
    // which covers all (target, selector) pairs — no dummy action needed.
    const data = getSessionData(baseSession)
    expect(data.actions).toHaveLength(1)
    expect(data.actions[0].actionTarget).toBe(
      SMART_SESSIONS_FALLBACK_TARGET_FLAG,
    )
  })

  test('empty permissions array → same sudoAction fallback as no permissions', () => {
    // permissions: [] is truthy but has no elements — must be treated the same as
    // permissions: undefined so injectedActions are not appended.
    const sessionWithEmptyPermissions = toSession({
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountA] },
      permissions: [],
    })
    const data = getSessionData(sessionWithEmptyPermissions)
    expect(data.actions).toHaveLength(1)
    expect(data.actions[0].actionTarget).toBe(
      SMART_SESSIONS_FALLBACK_TARGET_FLAG,
    )
  })

  test('multiple policies on one action', () => {
    const session = toSession({
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountA] },
      permissions: [
        {
          abi: erc20Abi,
          address: '0x2222222222222222222222222222222222222222' as Address,
          functions: {
            transfer: {
              policies: [{ type: 'sudo' }, { type: 'usage-limit', limit: 3n }],
            },
          },
        },
      ],
    })
    const data = getSessionData(session)
    expect(data.actions[0].actionPolicies).toHaveLength(2)
    expect(data.actions[0].actionPolicies[0].policy).toBe(SUDO_POLICY_ADDRESS)
    expect(data.actions[0].actionPolicies[1].policy).toBe(
      USAGE_LIMIT_POLICY_ADDRESS,
    )
  })

  test('salt is always zeroHash', () => {
    expect(getSessionData(baseSession).salt).toBe(zeroHash)
    expect(getSessionData(sessionWithAction).salt).toBe(zeroHash)
  })

  test('erc7739Policies has sudo erc1271 policy', () => {
    const data = getSessionData(baseSession)
    expect(data.erc7739Policies.erc1271Policies[0].policy).toBe(
      SUDO_POLICY_ADDRESS,
    )
  })

  test('claimPolicies resolves public Permit2 policy to policy data', () => {
    const session = toSession({
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountA] },
      claimPolicies: [
        {
          type: 'permit2',
          spenders: ['0x1234567890123456789012345678901234567890'],
          sourceTokens: [{ chain: base, address: USDC }],
          destinationTokens: [{ chain: base, address: RECIPIENT }],
          recipients: [{ chain: base, address: 'any' }],
          recipientIsAccount: true,
          permitDeadline: { min: 1n, max: 2n },
          fillDeadline: [{ chain: base, min: 3n, max: 4n }],
        },
      ],
    })
    const data = getSessionData(session)
    expect(data.claimPolicies).toHaveLength(1)
    expect(data.claimPolicies[0].policy).toBe(PERMIT2_CLAIM_POLICY_ADDRESS)
    expect(data.claimPolicies[0].initData).not.toBe('0x')
  })
})

// ---------------------------------------------------------------------------
// C. getPermissionId
// ---------------------------------------------------------------------------

describe('getPermissionId', () => {
  test('deterministic — same session returns same id', () => {
    expect(getPermissionId(baseSession)).toBe(getPermissionId(baseSession))
  })

  test('different owners → different permissionId', () => {
    const sessionB = toSession({
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountB] },
    })
    expect(getPermissionId(baseSession)).not.toBe(getPermissionId(sessionB))
  })

  test('actions do not affect permissionId (only validator identity does)', () => {
    // permissionId is derived from sessionValidator + sessionValidatorInitData + salt,
    // NOT from actions — so same owner with different actions yields the same id
    expect(getPermissionId(baseSession)).toBe(
      getPermissionId(sessionWithAction),
    )
  })

  test('returns 32-byte hex string', () => {
    const id = getPermissionId(baseSession)
    expect(id).toMatch(/^0x[0-9a-f]{64}$/)
  })
})

// ---------------------------------------------------------------------------
// D. packSignature
// ---------------------------------------------------------------------------

describe('packSignature', () => {
  test('verifyExecutions: false → MODE_USE (0x00) prefix', () => {
    const signers: ResolvedSessionSignerSet = {
      type: 'experimental_session',
      session: baseSession,
      verifyExecutions: false,
    }
    const result = packSignature(signers, dummySig)
    expect(slice(result, 0, 1)).toBe('0x00')
  })

  test('verifyExecutions: false → bytes 1-32 are the permissionId', () => {
    const signers: ResolvedSessionSignerSet = {
      type: 'experimental_session',
      session: baseSession,
      verifyExecutions: false,
    }
    const result = packSignature(signers, dummySig)
    const permissionId = getPermissionId(baseSession)
    expect(slice(result, 1, 33)).toBe(permissionId)
  })

  test('verifyExecutions: false → total length > 66 bytes', () => {
    const signers: ResolvedSessionSignerSet = {
      type: 'experimental_session',
      session: baseSession,
      verifyExecutions: false,
    }
    const result = packSignature(signers, dummySig)
    const byteLen = (result.length - 2) / 2
    expect(byteLen).toBeGreaterThan(66)
  })

  test('verifyExecutions: true + enableData → MODE_ENABLE (0x01) prefix', () => {
    const signers: ResolvedSessionSignerSet = {
      type: 'experimental_session',
      session: baseSession,
      verifyExecutions: true,
      enableData: {
        userSignature: dummySig,
        hashesAndChainIds: [
          { chainId: BigInt(base.id), sessionDigest: zeroHash },
        ],
        sessionToEnableIndex: 0,
      },
    }
    const result = packSignature(signers, dummySig)
    expect(slice(result, 0, 1)).toBe('0x01')
  })

  test('verifyExecutions: true + enableData → longer output (has compressed payload)', () => {
    const signers: ResolvedSessionSignerSet = {
      type: 'experimental_session',
      session: baseSession,
      verifyExecutions: true,
      enableData: {
        userSignature: dummySig,
        hashesAndChainIds: [
          { chainId: BigInt(base.id), sessionDigest: zeroHash },
        ],
        sessionToEnableIndex: 0,
      },
    }
    const result = packSignature(signers, dummySig)
    const byteLen = (result.length - 2) / 2
    expect(byteLen).toBeGreaterThan(33)
  })

  test('verifyExecutions: true, no enableData → MODE_USE (0x00) prefix', () => {
    const signers: ResolvedSessionSignerSet = {
      type: 'experimental_session',
      session: baseSession,
      verifyExecutions: true,
    }
    const result = packSignature(signers, dummySig)
    expect(slice(result, 0, 1)).toBe('0x00')
  })

  test('different owners produce different packed bytes', () => {
    const sessionB = toSession({
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountB] },
    })
    const signersA: ResolvedSessionSignerSet = {
      type: 'experimental_session',
      session: baseSession,
      verifyExecutions: false,
    }
    const signersB: ResolvedSessionSignerSet = {
      type: 'experimental_session',
      session: sessionB,
      verifyExecutions: false,
    }
    expect(packSignature(signersA, dummySig)).not.toBe(
      packSignature(signersB, dummySig),
    )
  })
})

// ---------------------------------------------------------------------------
// E. buildMockSignature (existing tests preserved + extras)
// ---------------------------------------------------------------------------

describe('buildMockSignature', () => {
  test('first 20 bytes are the emissary address', () => {
    const sig = buildMockSignature(baseSession)
    const validatorBytes = slice(sig, 0, 20)
    expect(
      isAddressEqual(validatorBytes as Address, SMART_SESSION_EMISSARY_ADDRESS),
    ).toBe(true)
  })

  test('byte 20 is SMART_SESSION_MODE_ENABLE (0x01)', () => {
    const sig = buildMockSignature(baseSession)
    const modeByte = slice(sig, 20, 21)
    expect(modeByte).toBe('0x01')
  })

  test('total length is larger than just emissary + mode byte (has compressed payload)', () => {
    const sig = buildMockSignature(baseSession)
    const byteLen = (sig.length - 2) / 2
    expect(byteLen).toBeGreaterThan(21)
  })

  test('sessions with different actions produce different sigData', () => {
    const sigBase = buildMockSignature(baseSession)
    const sigWithAction = buildMockSignature(sessionWithAction)
    expect(sigBase).not.toBe(sigWithAction)
  })

  test('useDevContracts=true produces different emissary prefix', () => {
    const sigProd = buildMockSignature(baseSession, false)
    const sigDev = buildMockSignature(baseSession, true)
    expect(slice(sigProd, 0, 20)).not.toBe(slice(sigDev, 0, 20))
  })

  test('chainCount=2 produces valid output (LibZip may compress smaller than chainCount=1)', () => {
    const sig = buildMockSignature(baseSession, false, 2)
    // Must be at least emissaryAddress (20) + mode byte (1) + some payload
    const byteLen = (sig.length - 2) / 2
    expect(byteLen).toBeGreaterThan(21)
    // Must start with the emissary address
    expect(
      isAddressEqual(
        slice(sig, 0, 20) as Address,
        SMART_SESSION_EMISSARY_ADDRESS,
      ),
    ).toBe(true)
  })

  test('omitting targetChainId matches passing session.chain.id explicitly', () => {
    // Backward compat: the legacy single-chain path (no targetChainId)
    // should produce the same sig as explicitly passing session.chain.id.
    const sigDefault = buildMockSignature(baseSession, false, 1)
    const sigExplicitSessionChain = buildMockSignature(
      baseSession,
      false,
      1,
      baseSession.chain.id,
    )
    expect(sigDefault).toBe(sigExplicitSessionChain)
  })

  test('targetChainId different from session.chain.id changes the sig payload', () => {
    // baseSession.chain is Base (8453). Passing a different targetChainId
    // must change the encoded hashesAndChainIds[0].chainId, producing a
    // different compressed sig payload.
    const sigForSessionChain = buildMockSignature(baseSession, false, 1)
    const sigForOtherChain = buildMockSignature(baseSession, false, 1, 42161)
    expect(sigForSessionChain).not.toBe(sigForOtherChain)
  })

  test('different targetChainId values produce different sigs', () => {
    // Two calls with the same session but different target chains must
    // produce distinct sigs — the per-chain mockSignatures path relies on
    // this to give each chain its own correct chainId in the first entry.
    const sigForArb = buildMockSignature(baseSession, false, 2, 42161)
    const sigForOpt = buildMockSignature(baseSession, false, 2, 10)
    expect(sigForArb).not.toBe(sigForOpt)
  })

  test('non-finite chainCount normalizes to 1 (guards against undefined callsite)', () => {
    // Regression guard: `sourceChains?.length` can be undefined at call sites
    // and would previously make `Math.max(1, undefined) === NaN`, producing
    // an empty hashesAndChainIds array and silently dropping the ChainId
    // check. The internal normalization must clamp to at least 1.
    const sigDefault = buildMockSignature(baseSession, false)
    const sigUndefined = buildMockSignature(
      baseSession,
      false,
      undefined as unknown as number,
    )
    const sigNaN = buildMockSignature(baseSession, false, NaN)
    const sigZero = buildMockSignature(baseSession, false, 0)
    expect(sigUndefined).toBe(sigDefault)
    expect(sigNaN).toBe(sigDefault)
    expect(sigZero).toBe(sigDefault)
  })
})
