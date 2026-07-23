import { LibZip } from 'solady'
import {
  type Abi,
  type Address,
  concat,
  createPublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  type Hex,
  hashStruct,
  isAddressEqual,
  isHex,
  keccak256,
  maxUint256,
  padHex,
  size,
  type TypedDataDefinition,
  toFunctionSelector,
  toHex,
  zeroAddress,
  zeroHash,
} from 'viem'
import { mainnet } from 'viem/chains'
import { getAccountProvider } from '../../accounts'
import { K1_DEFAULT_VALIDATOR_ADDRESS } from '../../accounts/startale'
import { createTransport } from '../../accounts/utils'
import {
  RESET_PERIOD_ONE_WEEK,
  SCOPE_MULTICHAIN,
} from '../../execution/compact'
import { signTypedData } from '../../execution/utils'
import { getChainById } from '../../orchestrator/registry'
import type {
  Action,
  ArgPolicyExpression,
  CrossChainPermissionInput,
  Permit2ClaimPolicy,
  Policy,
  ProviderConfig,
  ResolvedAction,
  ResolvedERC7739Policies,
  ResolvedPolicy,
  RhinestoneAccountConfig,
  RhinestoneConfig,
  Session,
  SessionDefinition,
  SessionEnableData,
  SessionPolicyAddresses,
  UniversalActionPolicyParamCondition,
} from '../../types'
import smartSessionEmissaryAbi from '../abi/smart-session-emissary'
import { MODULE_TYPE_ID_VALIDATOR, type Module } from '../common'
import {
  getOwnerValidator,
  getValidator,
  ownerSetUsesEns,
  SMART_SESSION_EMISSARY_ADDRESS,
  SMART_SESSION_EMISSARY_ADDRESS_DEV,
} from './core'
import { resolveCrossChainPermission } from './cross-chain-permits'
import { FAR_FUTURE_MS, resolvePermissions } from './permissions'
import { getArbitersForSettlementLayers } from './policies/claim/arbiters'
import {
  encodePermit2ClaimPolicyInitData,
  type InternalPermit2ClaimPolicy,
  PERMIT2_CLAIM_POLICY_ADDRESS,
  type Permit2ClaimMessage,
} from './policies/claim/permit2'

type FixedLengthArray<
  T,
  N extends number,
  A extends T[] = [],
> = A['length'] extends N ? A : FixedLengthArray<T, N, [...A, T]>

interface SessionData {
  sessionValidator: Address
  sessionValidatorInitData: Hex
  salt: Hex
  erc7739Policies: ResolvedERC7739Policies
  actions: readonly ResolvedAction[]
  claimPolicies: readonly ResolvedPolicy[]
}

type ActionData = ResolvedAction
type PolicyData = ResolvedPolicy

interface ActionParamRule {
  condition: number
  offset: bigint
  isLimited: boolean
  ref: Hex
  usage: {
    limit: bigint
    used: bigint
  }
}

type SmartSessionModeType =
  | typeof SMART_SESSION_MODE_USE
  | typeof SMART_SESSION_MODE_ENABLE

interface ChainDigest {
  chainId: bigint
  sessionDigest: Hex
}

interface SignedPermissions {
  permitGenericPolicy: boolean
  permitAdminAccess: boolean
  ignoreSecurityAttestations: boolean
  permitERC4337Paymaster: boolean
  userOpPolicies: readonly PolicyData[]
  erc7739Policies: ERC7739Data
  actions: readonly ActionData[]
}

interface SignedSession {
  account: Address
  permissions: SignedPermissions
  sessionValidator: Address
  sessionValidatorInitData: Hex
  salt: Hex
  smartSession: Address
  nonce: bigint
}

interface ChainSession {
  chainId: bigint
  session: SignedSession
}

interface ERC7739Data {
  allowedERC7739Content: readonly ERC7739Context[]
  erc1271Policies: readonly PolicyData[]
}

interface ERC7739Context {
  appDomainSeparator: Hex
  contentName: readonly string[]
}

interface SessionDetails {
  nonces: bigint[]
  hashesAndChainIds: ChainDigest[]
  data: TypedDataDefinition<typeof types, 'MultiChainSession'>
}

const types = {
  PolicyData: [
    { name: 'policy', type: 'address' },
    { name: 'initData', type: 'bytes' },
  ],
  ActionData: [
    { name: 'actionTargetSelector', type: 'bytes4' },
    { name: 'actionTarget', type: 'address' },
    { name: 'actionPolicies', type: 'PolicyData[]' },
  ],
  ERC7739Context: [
    { name: 'appDomainSeparator', type: 'bytes32' },
    { name: 'contentName', type: 'string[]' },
  ],
  ERC7739Data: [
    { name: 'allowedERC7739Content', type: 'ERC7739Context[]' },
    { name: 'erc1271Policies', type: 'PolicyData[]' },
  ],
  LockTagData: [
    { name: 'lockTag', type: 'bytes12' },
    { name: 'claimPolicies', type: 'PolicyData[]' },
  ],
  SignedPermissions: [
    { name: 'actions', type: 'ActionData[]' },
    { name: 'erc7739Policies', type: 'ERC7739Data' },
    { name: 'lockTagPolicies', type: 'LockTagData' },
    { name: 'permitGenericPolicy', type: 'bool' },
  ],
  SignedSession: [
    { name: 'account', type: 'address' },
    { name: 'expires', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'permissions', type: 'SignedPermissions' },
    { name: 'salt', type: 'bytes32' },
    { name: 'sessionValidator', type: 'address' },
    { name: 'sessionValidatorInitData', type: 'bytes' },
    { name: 'smartSessionEmissary', type: 'address' },
  ],
  ChainSession: [
    { name: 'chainId', type: 'uint64' },
    { name: 'session', type: 'SignedSession' },
  ],
  MultiChainSession: [{ name: 'sessionsAndChainIds', type: 'ChainSession[]' }],
} as const

const SMART_SESSION_MODE_USE = '0x00'
const SMART_SESSION_MODE_ENABLE = '0x01'

const SMART_SESSIONS_FALLBACK_TARGET_FLAG: Address =
  '0x0000000000000000000000000000000000000001'
const SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG: Hex = '0x00000001'
const SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG_PERMITTED_TO_CALL_SMARTSESSION: Hex =
  '0x00000002'

// Dummy preclaimop action injected into every session so that the filler can trigger
// verifyExecution (ENABLE mode) using an injected dummy preclaimop when there are no
// real preclaimops. Target 0x...0420 is the ecRecover precompile; calls to it fail
// silently because preclaimops are failure-tolerant. Selector 0x69123456 is
// intentionally uncommon.
const DUMMY_PRECLAIMOP_TARGET: Address =
  '0x0000000000000000000000000000000000000420'
const DUMMY_PRECLAIMOP_SELECTOR: Hex = '0x69123456'

const SPENDING_LIMITS_POLICY_ADDRESS: Address =
  '0x000000000033212E272655D8a22402Db819477A6'
const TIME_FRAME_POLICY_ADDRESS: Address =
  '0x0000000000D30f611fA3bf652ac6879428586930'
const SUDO_POLICY_ADDRESS: Address =
  '0x0000000000FEEc8D74e3143fBaBbca515358d869'
const UNIVERSAL_ACTION_POLICY_ADDRESS: Address =
  '0x0000000000714Cf48FcF88A0bFBa70d313415032'
const ARG_POLICY_ADDRESS: Address = '0x0000000000167edE64D8751daACDdC0312565a73'
const USAGE_LIMIT_POLICY_ADDRESS: Address =
  '0x00000000001d4479FA2A947026204d0283ceDe4B'
const VALUE_LIMIT_POLICY_ADDRESS: Address =
  '0x000000000021dC45451291BCDfc9f0B46d6f0278'
const INTENT_EXECUTION_POLICY_ADDRESS: Address =
  '0xe9eA54d063975cDee9e06b7636d5563d95a7A23C'
const INTENT_EXECUTION_POLICY_ADDRESS_DEV: Address =
  '0xa09b47de6e510cbdc18b97e9239bedcb44fb4901'

const ACTION_CONDITION_EQUAL = 0
const ACTION_CONDITION_GREATER_THAN = 1
const ACTION_CONDITION_LESS_THAN = 2
const ACTION_CONDITION_GREATER_THAN_OR_EQUAL = 3
const ACTION_CONDITION_LESS_THAN_OR_EQUAL = 4
const ACTION_CONDITION_NOT_EQUAL = 5
const ACTION_CONDITION_IN_RANGE = 6

// ArgPolicy expression-tree node packing — must match ArgPolicyTreeLib.sol:
//   bits  0..1  : node type (0=rule, 1=NOT, 2=AND, 3=OR)
//   bits  2..9  : rule index (rule nodes only)
//   bits 10..17 : left/only child index
//   bits 18..25 : right child index (AND/OR only)
const ARG_NODE_TYPE_RULE = 0n
const ARG_NODE_TYPE_NOT = 1n
const ARG_NODE_TYPE_AND = 2n
const ARG_NODE_TYPE_OR = 3n
const ARG_RULE_INDEX_SHIFT = 2n
const ARG_LEFT_CHILD_SHIFT = 10n
const ARG_RIGHT_CHILD_SHIFT = 18n
// On-chain caps from ArgPolicyTreeLib.sol; fail early instead of letting
// the deployment revert with `TooManyRules` / `TooManyNodes`.
const ARG_MAX_RULES = 128
const ARG_MAX_NODES = 256

// Defaults resolved at construction time; users override via
// `SessionDefinition.policyAddresses`.
interface ResolvedPolicyAddresses {
  sudo: Address
  universalAction: Address
  argPolicy: Address
  spendingLimits: Address
  timeFrame: Address
  usageLimit: Address
  valueLimit: Address
}

const DEFAULT_POLICY_ADDRESSES: ResolvedPolicyAddresses = {
  sudo: SUDO_POLICY_ADDRESS,
  universalAction: UNIVERSAL_ACTION_POLICY_ADDRESS,
  argPolicy: ARG_POLICY_ADDRESS,
  spendingLimits: SPENDING_LIMITS_POLICY_ADDRESS,
  timeFrame: TIME_FRAME_POLICY_ADDRESS,
  usageLimit: USAGE_LIMIT_POLICY_ADDRESS,
  valueLimit: VALUE_LIMIT_POLICY_ADDRESS,
}

function resolvePolicyAddresses(
  overrides?: SessionPolicyAddresses,
): ResolvedPolicyAddresses {
  if (!overrides) return DEFAULT_POLICY_ADDRESSES
  return {
    sudo: overrides.sudo ?? DEFAULT_POLICY_ADDRESSES.sudo,
    universalAction:
      overrides.universalAction ?? DEFAULT_POLICY_ADDRESSES.universalAction,
    argPolicy: overrides.argPolicy ?? DEFAULT_POLICY_ADDRESSES.argPolicy,
    spendingLimits:
      overrides.spendingLimits ?? DEFAULT_POLICY_ADDRESSES.spendingLimits,
    timeFrame: overrides.timeFrame ?? DEFAULT_POLICY_ADDRESSES.timeFrame,
    usageLimit: overrides.usageLimit ?? DEFAULT_POLICY_ADDRESSES.usageLimit,
    valueLimit: overrides.valueLimit ?? DEFAULT_POLICY_ADDRESSES.valueLimit,
  }
}

interface ResolvedSessionSignerSet {
  type: 'experimental_session'
  session: Session
  enableData?: SessionEnableData
  verifyExecutions: boolean
  claimPolicyData?: Hex
}

function packSignature(
  signers: ResolvedSessionSignerSet,
  validatorSignature: Hex,
): Hex {
  const session = signers.session
  const permissionId = getPermissionId(session)
  if (signers.verifyExecutions) {
    const smartSessionMode = signers.enableData
      ? SMART_SESSION_MODE_ENABLE
      : SMART_SESSION_MODE_USE
    const sessionData = getSessionData(signers.session)

    const packedSignature = signers.enableData
      ? (LibZip.flzCompress(
          encodeAbiParameters(
            [
              {
                type: 'tuple',
                name: 'enableData',
                components: [
                  { type: 'bytes', name: 'allocatorSig' },
                  { type: 'bytes', name: 'userSig' },
                  { type: 'uint256', name: 'expires' },
                  {
                    type: 'tuple',
                    name: 'enableSession',
                    components: [
                      {
                        type: 'uint8',
                        name: 'chainDigestIndex',
                      },
                      {
                        type: 'tuple[]',
                        name: 'hashesAndChainIds',
                        components: [
                          { type: 'uint64', name: 'chainId' },
                          { type: 'bytes32', name: 'sessionDigest' },
                        ],
                      },
                      {
                        type: 'tuple',
                        name: 'session',
                        components: [
                          { type: 'address', name: 'sessionValidator' },
                          { type: 'bytes', name: 'sessionValidatorInitData' },
                          { type: 'bytes32', name: 'salt' },
                          {
                            type: 'tuple[]',
                            name: 'actions',
                            components: [
                              { type: 'bytes4', name: 'actionTargetSelector' },
                              { type: 'address', name: 'actionTarget' },
                              {
                                type: 'tuple[]',
                                name: 'actionPolicies',
                                components: [
                                  { type: 'address', name: 'policy' },
                                  { type: 'bytes', name: 'initData' },
                                ],
                              },
                            ],
                          },
                          {
                            type: 'tuple[]',
                            name: 'claimPolicies',
                            components: [
                              { type: 'address', name: 'policy' },
                              { type: 'bytes', name: 'initData' },
                            ],
                          },
                          {
                            type: 'tuple',
                            name: 'erc7739Policies',
                            components: [
                              {
                                type: 'tuple[]',
                                name: 'allowedERC7739Content',
                                components: [
                                  {
                                    type: 'bytes32',
                                    name: 'appDomainSeparator',
                                  },
                                  { type: 'string[]', name: 'contentNames' },
                                ],
                              },
                              {
                                type: 'tuple[]',
                                name: 'erc1271Policies',
                                components: [
                                  { type: 'address', name: 'policy' },
                                  { type: 'bytes', name: 'initData' },
                                ],
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
              {
                type: 'tuple',
                name: 'config',
                components: [
                  { type: 'uint8', name: 'scope' },
                  { type: 'uint8', name: 'resetPeriod' },
                  { type: 'address', name: 'allocator' },
                  { type: 'bytes32', name: 'permissionId' },
                ],
              },
              { type: 'bytes' },
            ],
            [
              {
                allocatorSig: zeroHash,
                userSig: signers.enableData.userSignature,
                expires: maxUint256,
                enableSession: {
                  chainDigestIndex: signers.enableData.sessionToEnableIndex,
                  hashesAndChainIds: signers.enableData.hashesAndChainIds,
                  session: sessionData,
                },
              },
              {
                scope: SCOPE_MULTICHAIN,
                resetPeriod: RESET_PERIOD_ONE_WEEK,
                allocator: zeroAddress,
                permissionId: getPermissionId(signers.session),
              },
              validatorSignature,
            ],
          ),
        ) as Hex)
      : validatorSignature
    return signers.enableData
      ? encodePacked(['bytes1', 'bytes'], [smartSessionMode, packedSignature])
      : encodePacked(
          ['bytes1', 'bytes32', 'bytes'],
          [smartSessionMode, permissionId, packedSignature],
        )
  } else {
    const SIGNATURE_IS_VALID_SIG_1271 = '0x00'
    const policyDataOffset = BigInt(64 + size(validatorSignature))
    const mode = SIGNATURE_IS_VALID_SIG_1271
    const policySpecificData = signers.claimPolicyData ?? '0x'
    const signature = encodePacked(
      ['bytes1', 'bytes32', 'uint256', 'bytes', 'bytes'],
      [
        mode,
        permissionId,
        policyDataOffset,
        validatorSignature,
        policySpecificData,
      ],
    )

    return signature
  }
}

async function getSessionDetails(
  account: Address,
  sessions: Session[],
  provider: ProviderConfig | undefined,
  useDevContracts?: boolean,
): Promise<SessionDetails> {
  const lockTag = '0x000000000000000000000000'
  const sessionNonces = await Promise.all(
    sessions.map((session) =>
      getSessionNonce(account, session, lockTag, provider, useDevContracts),
    ),
  )
  const sessionDatas = sessions.map((session) => getSessionData(session))
  const signedSessions = sessionDatas.map((session, index) =>
    getSignedSession(
      account,
      lockTag,
      session,
      sessionNonces[index],
      useDevContracts,
    ),
  )
  const chains = sessions.map((session) => session.chain)
  const hashesAndChainIds = signedSessions.map((session, index) => ({
    chainId: BigInt(chains[index].id),
    sessionDigest: hashStruct({
      types,
      primaryType: 'SignedSession',
      data: session,
    }),
  }))

  const data: TypedDataDefinition<typeof types, 'MultiChainSession'> = {
    domain: {
      name: 'SmartSessionEmissary',
      version: '1',
    },
    types: types,
    primaryType: 'MultiChainSession',
    message: {
      sessionsAndChainIds: signedSessions.map((session, index) => ({
        chainId: BigInt(chains[index].id),
        session,
      })),
    },
  }

  return {
    nonces: sessionNonces,
    hashesAndChainIds,
    data,
  }
}

async function isSessionEnabled(
  account: Address,
  provider: ProviderConfig | undefined,
  session: Session,
  useDevContracts?: boolean,
): Promise<boolean> {
  const publicClient = createPublicClient({
    chain: session.chain,
    transport: createTransport(session.chain, provider),
  })
  const isEnabled = await publicClient.readContract({
    address: getSmartSessionEmissaryAddress(useDevContracts),
    abi: [
      {
        type: 'function',
        name: 'isPermissionEnabled',
        inputs: [
          { name: 'account', type: 'address' },
          { name: 'permissionId', type: 'bytes32' },
        ],
        outputs: [{ name: 'isEnabled', type: 'bool' }],
        stateMutability: 'view',
      },
    ],
    functionName: 'isPermissionEnabled',
    args: [account, getPermissionId(session)],
  })
  return isEnabled
}

async function signEnableSession(
  config: RhinestoneAccountConfig,
  details: SessionDetails,
): Promise<Hex> {
  const account = getAccountProvider(config)
  const validator = getOwnerValidator(config)
  const isStartaleK1 =
    account.type === 'startale' &&
    validator.address.toLowerCase() ===
      K1_DEFAULT_VALIDATOR_ADDRESS.toLowerCase()

  if (isStartaleK1) {
    const chainIds = details.hashesAndChainIds.map((h) => h.chainId)
    const uniqueChainIds = [...new Set(chainIds.map((c) => c.toString()))]
    if (uniqueChainIds.length > 1) {
      throw new Error(
        'Startale accounts with K1 validator do not support multi-chain session enable',
      )
    }
    const chain = getChainById(Number(chainIds[0]))
    return signTypedData(config, details.data, chain, undefined, {
      skipErc6492: true,
    })
  }

  return signTypedData(config, details.data, mainnet, undefined, {
    skipErc6492: true,
  })
}

async function getSessionNonce(
  account: Address,
  session: Session,
  lockTag: Hex,
  provider: ProviderConfig | undefined,
  useDevContracts?: boolean,
): Promise<bigint> {
  const publicClient = createPublicClient({
    chain: session.chain,
    transport: createTransport(session.chain, provider),
  })
  const nonce = await publicClient.readContract({
    address: getSmartSessionEmissaryAddress(useDevContracts),
    abi: [
      {
        type: 'function',
        name: 'getNonce',
        inputs: [
          { name: 'sponsor', type: 'address', internalType: 'address' },
          { name: 'lockTag', type: 'bytes12', internalType: 'bytes12' },
        ],
        outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
        stateMutability: 'view',
      },
    ],
    functionName: 'getNonce',
    args: [account, lockTag],
  })
  return nonce
}

function getSignedSession(
  account: Address,
  lockTag: Hex,
  session: SessionData,
  nonce: bigint,
  useDevContracts?: boolean,
) {
  return {
    account,
    permissions: {
      permitGenericPolicy: session.actions.some(
        (action) =>
          action.actionTarget === SMART_SESSIONS_FALLBACK_TARGET_FLAG &&
          action.actionTargetSelector ===
            SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG,
      ),
      lockTagPolicies: {
        lockTag,
        claimPolicies: session.claimPolicies,
      },
      erc7739Policies: {
        allowedERC7739Content:
          session.erc7739Policies.allowedERC7739Content.map((content) => ({
            contentName: content.contentNames,
            appDomainSeparator: content.appDomainSeparator,
          })),
        erc1271Policies: session.erc7739Policies.erc1271Policies,
      },
      actions: session.actions,
    },
    sessionValidator: session.sessionValidator,
    sessionValidatorInitData: session.sessionValidatorInitData,
    salt: session.salt,
    smartSessionEmissary: getSmartSessionEmissaryAddress(useDevContracts),
    expires: maxUint256,
    nonce,
  }
}

async function getEnableSessionCall(
  account: Address,
  session: Session,
  enableSessionSignature: Hex,
  hashesAndChainIds: {
    chainId: bigint
    sessionDigest: Hex
  }[],
  sessionToEnableIndex: number,
  useDevContracts?: boolean,
) {
  const sessionData = getSessionData(session)
  const permissionId = getPermissionId(session)
  return {
    to: getSmartSessionEmissaryAddress(useDevContracts),
    data: encodeFunctionData({
      abi: smartSessionEmissaryAbi,
      functionName: 'setConfig',
      args: [
        account,
        {
          scope: SCOPE_MULTICHAIN,
          resetPeriod: RESET_PERIOD_ONE_WEEK,
          allocator: zeroAddress,
          permissionId,
        },
        {
          allocatorSig: zeroHash,
          userSig: enableSessionSignature,
          expires: maxUint256,
          session: {
            chainDigestIndex: sessionToEnableIndex,
            hashesAndChainIds,
            sessionToEnable: sessionData,
          },
        },
      ],
    }),
  }
}

// SignedPermissionDisable(address account,bytes32 permissionId,bytes12 lockTag,uint256 expires,uint256 nonce)
// Vendored from contracts/smart-sessions-v2/src/lib/HashLibV2.sol.
const SIGNED_PERMISSION_DISABLE_TYPEHASH: Hex =
  '0x098b3120e60a8adc9d970dec9c1f8796974a3ab6154f995ad56ee7b9a38d8836'

// Builds a `removeConfig` call that disables a single smart session.
//
// The disable user-signature (`disableData.userSig`) is left empty: the
// emissary only verifies it when `msg.sender != account`
// (SignatureLib.verifySignatures), and here the account itself executes the
// call, so the disable is authorized by the outer transaction the user signs
// normally. The `disableDigest` leaf still has to match on-chain, so we build
// it from the current emissary nonce + `expires`. No-allocator flow only
// (`allocator == zeroAddress`), matching how enable is used today.
async function getDisableSessionCall(
  account: Address,
  session: Session,
  expires: bigint,
  provider: ProviderConfig | undefined,
  useDevContracts?: boolean,
) {
  const lockTag: Hex = '0x000000000000000000000000'
  const permissionId = getPermissionId(session)
  const nonce = await getSessionNonce(
    account,
    session,
    lockTag,
    provider,
    useDevContracts,
  )
  // SmartSessionLens reuses the session multichain wrapper for the disable
  // digest, plugging this leaf in as `sessionDigest` (HashLibV2.disableDigest).
  const disableDigest = keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'address' },
        { type: 'bytes32' },
        { type: 'bytes12' },
        { type: 'uint256' },
        { type: 'uint256' },
      ],
      [
        SIGNED_PERMISSION_DISABLE_TYPEHASH,
        account,
        permissionId,
        lockTag,
        expires,
        nonce,
      ],
    ),
  )
  const hashesAndChainIds = [
    { chainId: BigInt(session.chain.id), sessionDigest: disableDigest },
  ]
  return {
    to: getSmartSessionEmissaryAddress(useDevContracts),
    data: encodeFunctionData({
      abi: smartSessionEmissaryAbi,
      functionName: 'removeConfig',
      args: [
        account,
        {
          scope: SCOPE_MULTICHAIN,
          resetPeriod: RESET_PERIOD_ONE_WEEK,
          allocator: zeroAddress,
          permissionId,
        },
        {
          allocatorSig: '0x',
          userSig: '0x',
          expires,
          session: {
            chainDigestIndex: 0,
            hashesAndChainIds,
          },
        },
      ],
    }),
  }
}

function toSession<const TAbis extends readonly Abi[]>(
  definition: SessionDefinition<TAbis>,
  options: { useDevContracts?: boolean; wrappedNativeToken?: Address } = {},
): Session {
  const addresses = resolvePolicyAddresses(definition.policyAddresses)
  const sessionData = resolveSessionData(
    definition,
    options.useDevContracts,
    addresses,
    options.wrappedNativeToken,
  )
  // Cross-chain permits add synthesized claim policies that must appear
  // on the returned `Session` too — `getSessionData(session)` re-encodes
  // from `session.claimPolicies` at signing time, so missing entries
  // here would diverge from what `resolveSessionData` already baked
  // into `sessionData.claimPolicies` for the permission-ID hash.
  const expandedCrossChainClaims = (definition.crossChainPermits ?? []).map(
    (p) => expandCrossChainPermit(p, options.useDevContracts).claim,
  )
  return {
    chain: definition.chain,
    owners: definition.owners,
    hasExplicitPermissions: !!definition.permissions?.length,
    permissionId: getPermissionIdFromData(sessionData),
    sessionValidator: sessionData.sessionValidator,
    sessionValidatorInitData: sessionData.sessionValidatorInitData,
    salt: sessionData.salt,
    erc7739Policies: sessionData.erc7739Policies,
    actions: sessionData.actions,
    claimPolicies: [
      ...(definition.claimPolicies ?? []),
      ...expandedCrossChainClaims,
    ],
  }
}

/**
 * Expands one {@link CrossChainPermit} into:
 *
 * - a {@link Permit2ClaimPolicy} for `SessionDefinition.claimPolicies`
 *   (gates Permit2 arbiter settlement) — settlement layers are resolved
 *   to canonical arbiter addresses via
 *   {@link getArbitersForSettlementLayers}.
 * - optional {@link SpendingLimitsPolicy} / {@link TimeFramePolicy}
 *   entries for the session's fallback action — the claim policy itself
 *   doesn't enforce amounts or expiry on-chain, so we lift those
 *   guarantees into action-level policies that do.
 *
 * An Intent Executor policy is intentionally NOT synthesized: the
 * params-bearing on-chain contract is still being designed in
 * smart-sessions-v2 (PR #46). Once it lands, this helper grows a second
 * branch that emits matching constraints there.
 */
function expandCrossChainPermit(
  input: CrossChainPermissionInput,
  useDevContracts?: boolean,
): {
  claim: Permit2ClaimPolicy
  fallbackPolicies: Policy[]
} {
  const permit = resolveCrossChainPermission(input)
  // `from`/`to` are optional: an absent leg list means "no token/chain
  // restriction on that side" — we emit `undefined` so the underlying
  // Permit2 policy skips the check entirely (matching how every other
  // policy field treats undefined as unrestricted).
  const sourceTokens = permit.from?.length
    ? permit.from.map(({ chain, token }) => ({ chain, address: token }))
    : undefined
  const destinationTokens = permit.to?.length
    ? permit.to.map(({ chain, token }) => ({ chain, address: token }))
    : undefined
  // Only emit a `recipients` whitelist when at least one destination
  // leg pins a concrete recipient (or the explicit `'any'` sentinel).
  // Leaving the field undefined disables the on-chain recipient check
  // entirely; emitting `['any', ...]` would force the contract into
  // recipient-check mode without actually restricting anything.
  const recipientsList = (permit.to ?? [])
    .filter((t) => t.recipient !== undefined)
    .map((t) => ({
      chain: t.chain,
      address: t.recipient as Address | 'any',
    }))
  const recipients = recipientsList.length ? recipientsList : undefined

  const permitDeadline =
    permit.validAfter !== undefined || permit.validUntil !== undefined
      ? { min: permit.validAfter, max: permit.validUntil }
      : undefined

  // Resolve the dev-friendly settlement-layer selectors into the actual
  // Permit2 arbiter addresses the on-chain policy enforces. Empty or
  // undefined ⇒ union of all supported layers (never an empty
  // whitelist that disables the on-chain check).
  const spenders = getArbitersForSettlementLayers(
    permit.settlementLayers,
    useDevContracts,
  )

  const claim: Permit2ClaimPolicy = {
    type: 'permit2',
    spenders,
    sourceTokens,
    destinationTokens,
    recipients,
    recipientIsAccount: permit.recipientIsAccount,
    permitDeadline,
    fillDeadline: permit.fillDeadline,
  }

  const fallbackPolicies: Policy[] = []

  // Per-origin amount caps: the Permit2 claim policy doesn't enforce
  // amounts on-chain, so we lift those caps into a separate
  // `SpendingLimitsPolicy` on the fallback action. This keeps the
  // user-facing promise ("at most X of token Y") honest.
  const limits = (permit.from ?? [])
    .filter((f) => f.maxAmount !== undefined)
    .map((f) => ({ token: f.token, amount: f.maxAmount as bigint }))
  if (limits.length) {
    fallbackPolicies.push({ type: 'spending-limits', limits })
  }

  // Time-frame: the on-chain TimeFramePolicy expects millisecond inputs
  // (see `case 'time-frame'` in getPolicyData), while CrossChainPermit
  // uses unix-seconds bigints — matching the Permit2 deadline
  // convention. We convert at the boundary so both encoders see their
  // preferred unit.
  //
  // One-sided bounds get always-passing defaults, mirroring the
  // permission resolver: an unset `validUntil` defaults to the year-2100
  // sentinel (NOT 0 — that would make the policy expired the moment
  // `validAfter` is reached), and an unset `validAfter` defaults to 0.
  if (permitDeadline) {
    const validUntilMs =
      permit.validUntil !== undefined
        ? Number(permit.validUntil * 1000n)
        : FAR_FUTURE_MS
    const validAfterMs =
      permit.validAfter !== undefined ? Number(permit.validAfter * 1000n) : 0
    fallbackPolicies.push({
      type: 'time-frame',
      validUntil: validUntilMs,
      validAfter: validAfterMs,
    })
  }

  return { claim, fallbackPolicies }
}

/**
 * True when `message` satisfies every dimension `policy` constrains. Used to
 * pick the correct claim policy at Permit2-signing time when a session holds
 * more than one (e.g. a user claim policy plus one or more cross-chain
 * permits).
 *
 * The on-chain emissary validates a Permit2 claim against the matching claim
 * policy, and `buildPermit2ClaimPolicyCalldata` expands the message
 * differently per policy (the calldata layout depends on which mode bits a
 * policy enables). Signing calldata for the wrong policy decodes incorrectly
 * on-chain and fails ERC-1271 validation — hence we must match.
 *
 * Only constrained dimensions are checked; an unset policy field imposes no
 * requirement (mirrors the contract's "skip the check" semantics). Source
 * tokens are matched by address alone because the Permit2 message carries no
 * origin chain id; destination tokens / recipients are scoped to the
 * mandate's `targetChain`.
 */
function permit2ClaimPolicyMatchesMessage(
  policy: Permit2ClaimPolicy,
  message: Permit2ClaimMessage,
): boolean {
  // Spender (arbiter) — the primary discriminator between settlement layers.
  if (policy.spenders?.length) {
    if (!policy.spenders.some((s) => isAddressEqual(s, message.spender))) {
      return false
    }
  }

  // Source tokens: every permitted token must be allow-listed (by address).
  if (policy.sourceTokens?.length) {
    const allowed = new Set(
      policy.sourceTokens.map((t) => t.address.toLowerCase()),
    )
    if (!message.permitted.every((p) => allowed.has(p.token.toLowerCase()))) {
      return false
    }
  }

  const targetChain = message.mandate.target.targetChain

  // Destination tokens: every mandate output token must be allow-listed for
  // the destination chain.
  if (policy.destinationTokens?.length) {
    const allowed = new Set(
      policy.destinationTokens
        .filter((t) => BigInt(t.chain.id) === targetChain)
        .map((t) => t.address.toLowerCase()),
    )
    if (
      !message.mandate.target.tokenOut.every((o) =>
        allowed.has(o.token.toLowerCase()),
      )
    ) {
      return false
    }
  }

  // Recipient: scoped to the destination chain. An `'any'` entry for that
  // chain accepts any recipient.
  if (policy.recipients?.length) {
    const entries = policy.recipients.filter(
      (r) => BigInt(r.chain.id) === targetChain,
    )
    if (entries.length) {
      const recipient = message.mandate.target.recipient
      const matches = entries.some(
        (r) => r.address === 'any' || isAddressEqual(r.address, recipient),
      )
      if (!matches) return false
    }
  }

  return true
}

/**
 * Selects the claim policy whose constraints the given Permit2 message
 * satisfies. With 0–1 policies the choice is trivial; with several, returns
 * the first match in list order (aligns with the contract iterating its
 * stored claim policies). Falls back to the first policy when nothing matches
 * so behaviour is never worse than the previous always-`[0]` logic — the
 * resulting on-chain failure is then identical to before.
 */
function selectPermit2ClaimPolicyForMessage(
  claimPolicies: readonly Permit2ClaimPolicy[],
  message: Permit2ClaimMessage,
): Permit2ClaimPolicy | undefined {
  if (claimPolicies.length <= 1) return claimPolicies[0]
  return (
    claimPolicies.find((p) => permit2ClaimPolicyMatchesMessage(p, message)) ??
    claimPolicies[0]
  )
}

function resolvePermit2ClaimPolicy(
  policy: Permit2ClaimPolicy,
): InternalPermit2ClaimPolicy {
  return {
    type: 'permit2-claim',
    arbiters: policy.spenders,
    tokensIn: policy.sourceTokens?.map(({ chain, address }) => ({
      chainId: chain.id,
      token: address,
    })),
    tokensOut: policy.destinationTokens?.map(({ chain, address }) => ({
      chainId: chain.id,
      token: address,
    })),
    recipients: policy.recipients?.map(({ chain, address }) => ({
      chainId: chain.id,
      recipient: address,
    })),
    recipientIsSponsor: policy.recipientIsAccount,
    expiryBounds: policy.permitDeadline,
    fillExpiryBounds: policy.fillDeadline?.map(({ chain, min, max }) => ({
      chainId: chain.id,
      min,
      max,
    })),
  }
}

function resolveSessionData(
  session: SessionDefinition,
  useDevContracts?: boolean,
  addresses: ResolvedPolicyAddresses = DEFAULT_POLICY_ADDRESSES,
  wrappedNativeToken?: Address,
): SessionData {
  // ENS validation is HCA-only, and HCA accounts cannot install the smart
  // session validator, so an ENS session owner would silently resolve to the
  // HCA module and sign/enable against a validator the account does not have.
  if (ownerSetUsesEns(session.owners)) {
    throw new Error('ENS owners are not supported for smart sessions')
  }
  const validator = getValidator(session.owners)
  const allowedContent = [
    {
      contentNames: [''],
      appDomainSeparator: zeroHash,
    },
  ]
  const erc7739Data = {
    allowedERC7739Content: allowedContent,
    erc1271Policies: [
      {
        policy: addresses.sudo,
        initData: '0x' as Hex,
      },
    ],
  }
  const sudoAction = {
    actionTargetSelector: SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG,
    actionTarget: SMART_SESSIONS_FALLBACK_TARGET_FLAG,
    actionPolicies: [
      {
        policy: addresses.sudo,
        initData: '0x' as Hex,
      },
    ],
  }

  const userActions = session.permissions?.length
    ? resolvePermissions(session.permissions)
    : []

  // Expand every cross-chain permit into a (claim, fallbackPolicies)
  // pair. The claim policies go onto `session.claimPolicies` (Permit2
  // settlement); the fallback policies (SpendingLimits / TimeFrame
  // derived from maxAmount / validUntil) are appended to the injected
  // fallback action below.
  const expandedPermits = (session.crossChainPermits ?? []).map((p) =>
    expandCrossChainPermit(p, useDevContracts),
  )
  const extraClaimPolicies = expandedPermits.map((e) => e.claim)
  const permitFallbackPolicies = expandedPermits.flatMap(
    (e) => e.fallbackPolicies,
  )

  // Native-token wrapping: permit `deposit()` on the chain's wrapped-native
  // token. Only injected when the wrapped-native address is known — supplied by
  // `account.createSession` (resolved from `/chains`). Direct `toSession`
  // callers pass `wrappedNativeToken` to opt in.
  const nativeWrapActions: Action[] = wrappedNativeToken
    ? [
        {
          target: wrappedNativeToken,
          selector: toFunctionSelector({
            type: 'function',
            name: 'deposit',
            inputs: [],
            outputs: [],
            stateMutability: 'payable',
          }),
        },
      ]
    : []

  const injectedActions: Action[] = [
    ...nativeWrapActions,
    // Intent-execution fallback for any non-scoped call. Cross-chain
    // permits attach their synthesized SpendingLimits / TimeFrame
    // guardrails to this same fallback so the on-chain emissary applies
    // them when the orchestrator drives a bridge through the fallback
    // action path.
    {
      policies: [
        { type: 'intent-execution' as const },
        ...permitFallbackPolicies,
      ],
    },
    // Dummy action: allows the filler to call verifyExecution in ENABLE mode using
    // an injected dummy preclaimop so any session can be enabled on-chain without
    // a separate UserOp, regardless of whether it has claim or action policies.
    {
      target: DUMMY_PRECLAIMOP_TARGET,
      selector: DUMMY_PRECLAIMOP_SELECTOR,
      policies: [{ type: 'sudo' as const }],
    },
  ]

  const allActions: Action[] = [...userActions, ...injectedActions]
  // When there are cross-chain permits but no explicit user actions, we
  // still want the injected fallback (with its synthesized guardrails)
  // to land on-chain — otherwise the legacy `[sudoAction]` path drops
  // the SpendingLimits / TimeFrame the user explicitly asked for.
  const needsInjection = userActions.length || permitFallbackPolicies.length
  const actions = needsInjection
    ? allActions.map((action) => ({
        actionTargetSelector:
          'selector' in action
            ? action.selector
            : SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG,
        actionTarget:
          'target' in action
            ? action.target
            : SMART_SESSIONS_FALLBACK_TARGET_FLAG,
        actionPolicies: action.policies?.map((policy) =>
          getPolicyData(policy, useDevContracts, addresses),
        ) ?? [
          {
            policy: addresses.sudo,
            initData: '0x' as Hex,
          },
        ],
      }))
    : [sudoAction]
  // Concatenate user-supplied claim policies with the ones synthesized
  // from cross-chain permits. Order is not security-sensitive — the
  // on-chain contract iterates the full list — but we keep user
  // policies first for deterministic permission IDs across SDK
  // releases that add permit expansion.
  const allClaimPolicies: Permit2ClaimPolicy[] = [
    ...(session.claimPolicies ?? []),
    ...extraClaimPolicies,
  ]
  return {
    sessionValidator: validator.address,
    salt: zeroHash,
    sessionValidatorInitData: validator.initData,
    erc7739Policies: erc7739Data,
    actions,
    claimPolicies: allClaimPolicies.map((policy) => ({
      policy: PERMIT2_CLAIM_POLICY_ADDRESS,
      initData: encodePermit2ClaimPolicyInitData(
        resolvePermit2ClaimPolicy(policy),
      ),
    })),
  }
}

function getSessionData(session: Session): SessionData {
  return {
    sessionValidator: session.sessionValidator,
    salt: session.salt,
    sessionValidatorInitData: session.sessionValidatorInitData,
    erc7739Policies: session.erc7739Policies,
    actions: session.actions,
    claimPolicies: session.claimPolicies.map((policy) => ({
      policy: PERMIT2_CLAIM_POLICY_ADDRESS,
      initData: encodePermit2ClaimPolicyInitData(
        resolvePermit2ClaimPolicy(policy),
      ),
    })),
  }
}

function getPermissionId(session: Session) {
  return session.permissionId
}

function getPermissionIdFromData(sessionData: SessionData) {
  return keccak256(
    encodeAbiParameters(
      [
        {
          type: 'address',
          name: 'sessionValidator',
        },
        {
          type: 'bytes',
          name: 'sessionValidatorInitData',
        },
        {
          type: 'bytes32',
          name: 'salt',
        },
      ],
      [
        sessionData.sessionValidator,
        sessionData.sessionValidatorInitData,
        sessionData.salt,
      ],
    ),
  )
}

function getActionConditionId(
  condition: UniversalActionPolicyParamCondition,
): number {
  switch (condition) {
    case 'equal':
      return ACTION_CONDITION_EQUAL
    case 'greaterThan':
      return ACTION_CONDITION_GREATER_THAN
    case 'lessThan':
      return ACTION_CONDITION_LESS_THAN
    case 'greaterThanOrEqual':
      return ACTION_CONDITION_GREATER_THAN_OR_EQUAL
    case 'lessThanOrEqual':
      return ACTION_CONDITION_LESS_THAN_OR_EQUAL
    case 'notEqual':
      return ACTION_CONDITION_NOT_EQUAL
    case 'inRange':
      return ACTION_CONDITION_IN_RANGE
  }
}

function encodeActionParamRule(rule: {
  condition: UniversalActionPolicyParamCondition
  calldataOffset: bigint
  usageLimit?: bigint
  referenceValue: Hex | bigint
}): ActionParamRule {
  const ref = isHex(rule.referenceValue)
    ? padHex(rule.referenceValue)
    : toHex(rule.referenceValue, { size: 32 })
  return {
    condition: getActionConditionId(rule.condition),
    offset: rule.calldataOffset,
    isLimited: rule.usageLimit !== undefined,
    ref,
    usage: {
      limit: rule.usageLimit ?? 0n,
      used: 0n,
    },
  }
}

// Compile an ArgPolicyExpression AST into the on-chain wire format
// (flat rules[] + bit-packed nodes[] + rootNodeIndex). Post-order walk:
// children get appended before their parent so a parent's child indices
// always reference earlier slots.
function compileArgPolicyExpression(expr: ArgPolicyExpression): {
  rules: ActionParamRule[]
  packedNodes: bigint[]
  rootNodeIndex: number
} {
  const rules: ActionParamRule[] = []
  const nodes: bigint[] = []

  function walk(e: ArgPolicyExpression): number {
    switch (e.type) {
      case 'rule': {
        const ruleIdx = rules.length
        rules.push(encodeActionParamRule(e.rule))
        const nodeIdx = nodes.length
        nodes.push(
          ARG_NODE_TYPE_RULE | (BigInt(ruleIdx) << ARG_RULE_INDEX_SHIFT),
        )
        return nodeIdx
      }
      case 'not': {
        const childIdx = walk(e.child)
        const nodeIdx = nodes.length
        nodes.push(
          ARG_NODE_TYPE_NOT | (BigInt(childIdx) << ARG_LEFT_CHILD_SHIFT),
        )
        return nodeIdx
      }
      case 'and':
      case 'or': {
        const leftIdx = walk(e.left)
        const rightIdx = walk(e.right)
        const nodeIdx = nodes.length
        const nodeType = e.type === 'and' ? ARG_NODE_TYPE_AND : ARG_NODE_TYPE_OR
        nodes.push(
          nodeType |
            (BigInt(leftIdx) << ARG_LEFT_CHILD_SHIFT) |
            (BigInt(rightIdx) << ARG_RIGHT_CHILD_SHIFT),
        )
        return nodeIdx
      }
    }
  }

  const rootNodeIndex = walk(expr)

  if (rules.length > ARG_MAX_RULES) {
    throw new Error(
      `ArgPolicy expression has ${rules.length} rules, max is ${ARG_MAX_RULES}`,
    )
  }
  if (nodes.length > ARG_MAX_NODES) {
    throw new Error(
      `ArgPolicy expression has ${nodes.length} nodes, max is ${ARG_MAX_NODES}`,
    )
  }
  return { rules, packedNodes: nodes, rootNodeIndex }
}

function getPolicyData(
  policy: Policy,
  useDevContracts?: boolean,
  addresses: ResolvedPolicyAddresses = DEFAULT_POLICY_ADDRESSES,
): PolicyData {
  switch (policy.type) {
    case 'sudo':
      return {
        policy: addresses.sudo,
        initData: '0x',
      }
    case 'intent-execution':
      return {
        policy: useDevContracts
          ? INTENT_EXECUTION_POLICY_ADDRESS_DEV
          : INTENT_EXECUTION_POLICY_ADDRESS,
        initData: '0x',
      }
    case 'universal-action': {
      const MAX_RULES = 16
      const rules = createFixedArray<ActionParamRule, typeof MAX_RULES>(
        MAX_RULES,
        () => ({
          condition: ACTION_CONDITION_EQUAL,
          offset: 0n,
          isLimited: false,
          ref: zeroHash,
          usage: { limit: 0n, used: 0n },
        }),
      )
      for (let i = 0; i < policy.rules.length; i++) {
        rules[i] = encodeActionParamRule(policy.rules[i])
      }
      return {
        policy: addresses.universalAction,
        initData: encodeAbiParameters(
          [
            {
              components: [
                {
                  name: 'valueLimitPerUse',
                  type: 'uint256',
                },
                {
                  components: [
                    {
                      name: 'length',
                      type: 'uint256',
                    },
                    {
                      components: [
                        {
                          name: 'condition',
                          type: 'uint8',
                        },
                        {
                          name: 'offset',
                          type: 'uint64',
                        },
                        {
                          name: 'isLimited',
                          type: 'bool',
                        },
                        {
                          name: 'ref',
                          type: 'bytes32',
                        },
                        {
                          components: [
                            {
                              name: 'limit',
                              type: 'uint256',
                            },
                            {
                              name: 'used',
                              type: 'uint256',
                            },
                          ],
                          name: 'usage',
                          type: 'tuple',
                        },
                      ],
                      name: 'rules',
                      type: 'tuple[16]',
                    },
                  ],
                  name: 'paramRules',
                  type: 'tuple',
                },
              ],
              name: 'ActionConfig',
              type: 'tuple',
            },
          ],
          [
            {
              valueLimitPerUse: policy.valueLimitPerUse ?? 0n,
              paramRules: {
                length: BigInt(policy.rules.length),
                rules: rules,
              },
            },
          ],
        ),
      }
    }
    case 'arg-policy': {
      const { rules, packedNodes, rootNodeIndex } = compileArgPolicyExpression(
        policy.expression,
      )
      return {
        policy: addresses.argPolicy,
        initData: encodeAbiParameters(
          [
            {
              components: [
                { name: 'valueLimitPerUse', type: 'uint256' },
                {
                  components: [
                    { name: 'rootNodeIndex', type: 'uint8' },
                    {
                      components: [
                        { name: 'condition', type: 'uint8' },
                        { name: 'offset', type: 'uint64' },
                        { name: 'isLimited', type: 'bool' },
                        { name: 'ref', type: 'bytes32' },
                        {
                          components: [
                            { name: 'limit', type: 'uint256' },
                            { name: 'used', type: 'uint256' },
                          ],
                          name: 'usage',
                          type: 'tuple',
                        },
                      ],
                      name: 'rules',
                      type: 'tuple[]',
                    },
                    { name: 'packedNodes', type: 'uint256[]' },
                  ],
                  name: 'paramRules',
                  type: 'tuple',
                },
              ],
              name: 'ActionConfig',
              type: 'tuple',
            },
          ],
          [
            {
              valueLimitPerUse: policy.valueLimitPerUse ?? 0n,
              paramRules: {
                rootNodeIndex,
                rules,
                packedNodes,
              },
            },
          ],
        ),
      }
    }
    case 'spending-limits': {
      const tokens = policy.limits.map(({ token }) => token)
      const limits = policy.limits.map(({ amount }) => amount)
      return {
        policy: addresses.spendingLimits,
        initData: encodeAbiParameters(
          [{ type: 'address[]' }, { type: 'uint256[]' }],
          [tokens, limits],
        ),
      }
    }
    case 'time-frame': {
      // Deployed TimeFramePolicy slices initData[0:12] and unpacks as
      // uint48 validUntil || uint48 validAfter (high 48 bits || low 48 bits).
      return {
        policy: addresses.timeFrame,
        initData: encodePacked(
          ['uint48', 'uint48'],
          [
            Math.floor(policy.validUntil / 1000),
            Math.floor(policy.validAfter / 1000),
          ],
        ),
      }
    }
    case 'usage-limit': {
      return {
        policy: addresses.usageLimit,
        initData: encodePacked(['uint128'], [policy.limit]),
      }
    }
    case 'value-limit': {
      return {
        policy: addresses.valueLimit,
        initData: encodeAbiParameters([{ type: 'uint256' }], [policy.limit]),
      }
    }
  }
}

function getSmartSessionValidator(config: RhinestoneConfig): Module | null {
  if (!config.experimental_sessions) {
    return null
  }
  const { enabled, module } = config.experimental_sessions
  if (!enabled) {
    return null
  }
  return {
    address: module ?? getSmartSessionEmissaryAddress(config.useDevContracts),
    initData: '0x',
    deInitData: '0x',
    additionalContext: '0x',
    type: MODULE_TYPE_ID_VALIDATOR,
  }
}

function getSmartSessionEmissaryAddress(useDevContracts?: boolean): Address {
  return useDevContracts === true
    ? SMART_SESSION_EMISSARY_ADDRESS_DEV
    : SMART_SESSION_EMISSARY_ADDRESS
}

/**
 * Builds a mockSignature for SSX validation gas estimation.
 * Format: emissaryAddress (20 bytes) + packed sigData. Uses real session data
 * (policies/actions from the user's session config) with dummy sigs and hashes —
 * the mock emissary skips sig verification and only reads/writes storage. The
 * orchestrator slices off the first 20 bytes to identify the validator, then
 * picks the gas-simulation path from the bundle's declared `signatureMode`:
 * `verifyExecution` for execution-emissary modes (ENABLE/USE), or
 * `isValidSignatureWithSender` via `simulate_verify1271` for plain ERC-1271.
 * The mode byte alone can't disambiguate USE from ERC-1271 (both are `0x00`),
 * but `shape` is derived from the same resolved `verifyExecutions` that drives
 * `signatureMode`, so the mock payload always matches the path that mode selects.
 */
// The shape a mock signature should take, mirroring the real signature the
// bundle will validate with on-chain:
//   'enable'  → ENABLE   (0x01): first use; installs the session (verifyExecution
//               + setConfig). The mock carries dummy enableData.
//   'use'     → USE      (0x00): already enabled WITH explicit permissions;
//               verifyExecution, no install. No enableData.
//   'erc1271' → ERC-1271 (0x00): already enabled, no explicit permissions;
//               validated via isValidSignatureWithSender.
// Named so call sites are self-documenting (no order-sensitive boolean pair).
type SmartSessionMockShape = 'enable' | 'use' | 'erc1271'

function buildMockSignature(
  session: Session,
  useDevContracts?: boolean,
  chainCount: number = 1,
  targetChainId?: number,
  // Defaults to the historical first-use ENABLE shape.
  shape: SmartSessionMockShape = 'enable',
): Hex {
  // packSignature keys ENABLE vs USE on enableData *presence* within the
  // verifyExecutions branch, and takes the ERC-1271 branch when verifyExecutions
  // is false — so derive both from the requested shape.
  const verifyExecutions = shape !== 'erc1271'
  const includeEnableData = shape === 'enable'
  const emissaryAddress = getSmartSessionEmissaryAddress(useDevContracts)

  // Include enableData only when the session is actually being enabled (ENABLE
  // shape) — its presence is what makes packSignature emit 0x01 vs 0x00, and it's
  // ignored entirely by the USE / ERC-1271 shapes. Built lazily so steady-state
  // shapes skip the chainId-entry allocation.
  let enableData: SessionEnableData | undefined
  if (includeEnableData) {
    // Use targetChainId when provided (per-chain mockSignatures path) so the mock
    // emissary's chainId check passes on the correct chain. Falls back to
    // session.chain.id for the global mockSignature (single-chain path).
    const primaryChainId = targetChainId ?? session.chain.id
    // Normalize chainCount to a finite positive integer — guards against NaN/
    // undefined from callers (e.g. `sourceChains?.length`) that would otherwise
    // produce an empty array and silently drop the ChainId check.
    const safeChainCount =
      Number.isFinite(chainCount) && chainCount > 0 ? Math.floor(chainCount) : 1
    // First entry is the real chain ID (for the ChainId check), the rest are
    // chainId 0 placeholders. Hash mismatch is skipped by the mock emissary, so
    // sessionDigest can be zeroHash throughout.
    const hashesAndChainIds = Array.from(
      { length: safeChainCount },
      (_, i) => ({
        chainId: i === 0 ? BigInt(primaryChainId) : 0n,
        sessionDigest: zeroHash,
      }),
    )
    enableData = {
      userSignature: `0x${'00'.repeat(65)}` as Hex,
      hashesAndChainIds,
      sessionToEnableIndex: 0,
    }
  }

  const dummySigners: ResolvedSessionSignerSet = {
    type: 'experimental_session',
    session,
    verifyExecutions,
    ...(enableData && { enableData }),
  }
  const dummyValidatorSignature = `0x${'00'.repeat(65)}` as Hex
  const sigData = packSignature(dummySigners, dummyValidatorSignature)
  return concat([emissaryAddress, sigData])
}

function createFixedArray<T, N extends number>(
  length: N,
  getValue: (index: number) => T,
): FixedLengthArray<T, N> {
  return Array.from({ length }, (_, i) => getValue(i)) as FixedLengthArray<T, N>
}

export {
  SMART_SESSION_EMISSARY_ADDRESS,
  SMART_SESSION_EMISSARY_ADDRESS_DEV,
  SMART_SESSIONS_FALLBACK_TARGET_FLAG,
  SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG,
  SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG_PERMITTED_TO_CALL_SMARTSESSION,
  DUMMY_PRECLAIMOP_TARGET,
  DUMMY_PRECLAIMOP_SELECTOR,
  SPENDING_LIMITS_POLICY_ADDRESS,
  TIME_FRAME_POLICY_ADDRESS,
  SUDO_POLICY_ADDRESS,
  UNIVERSAL_ACTION_POLICY_ADDRESS,
  ARG_POLICY_ADDRESS,
  USAGE_LIMIT_POLICY_ADDRESS,
  VALUE_LIMIT_POLICY_ADDRESS,
  INTENT_EXECUTION_POLICY_ADDRESS,
  packSignature,
  toSession,
  resolvePermit2ClaimPolicy,
  selectPermit2ClaimPolicyForMessage,
  getSessionData,
  getPolicyData,
  getEnableSessionCall,
  getDisableSessionCall,
  getPermissionId,
  getSmartSessionValidator,
  getSessionDetails,
  isSessionEnabled,
  signEnableSession,
  buildMockSignature,
}
export type {
  ChainSession,
  ChainDigest,
  ResolvedSessionSignerSet,
  SessionData,
  SmartSessionModeType,
  SessionDetails,
}
