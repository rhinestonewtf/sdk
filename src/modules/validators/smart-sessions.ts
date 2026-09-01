import { LibZip } from 'solady'
import {
  type Address,
  concat,
  createPublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  type Hex,
  hashStruct,
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
import { getAccountProvider } from '../../accounts'
import { K1_DEFAULT_VALIDATOR_ADDRESS } from '../../accounts/startale'
import { createTransport } from '../../accounts/utils'
import {
  RESET_PERIOD_ONE_WEEK,
  SCOPE_MULTICHAIN,
} from '../../execution/compact'
import { signTypedData } from '../../execution/utils'
import {
  getChainById,
  getWrappedTokenAddress,
} from '../../orchestrator/registry'
import type {
  Action,
  ArgPolicyExpression,
  FyndVenue,
  Policy,
  ProviderConfig,
  RhinestoneAccountConfig,
  RhinestoneConfig,
  RhinestoneSwapVenue,
  Session,
  SessionEnableData,
  SwapScope,
  SwapVenue,
  UniversalActionPolicyParamCondition,
  ZeroExVenue,
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
import {
  encodePermit2ClaimPolicyInitData,
  PERMIT2_CLAIM_POLICY_ADDRESS,
} from './policies/claim/permit2'
import { fynd } from './smart-sessions/swap/fynd'
import { rhinestoneSwap } from './smart-sessions/swap/rhinestone'
import {
  resolveSwapScope,
  type SwapScopeFor,
  type SwapVenueFor,
  toSession,
} from './smart-sessions/swap/scope'
import {
  resolveZeroExSettler,
  type ZeroExAnySettlerOptions,
  type ZeroExPinnedOptions,
  zeroEx,
} from './smart-sessions/swap/zero-ex'

type FixedLengthArray<
  T,
  N extends number,
  A extends T[] = [],
> = A['length'] extends N ? A : FixedLengthArray<T, N, [...A, T]>

interface SessionData {
  sessionValidator: Address
  sessionValidatorInitData: Hex
  salt: Hex
  erc7739Policies: {
    allowedERC7739Content: readonly AllowedERC7739Content[]
    erc1271Policies: readonly ERC1271Policy[]
  }
  actions: readonly ActionData[]
  claimPolicies: readonly PolicyData[]
}

interface ERC1271Policy {
  policy: Address
  initData: Hex
}

interface AllowedERC7739Content {
  appDomainSeparator: Hex
  contentNames: readonly string[]
}

interface ActionData {
  actionTargetSelector: Hex
  actionTarget: Address
  actionPolicies: readonly PolicyData[]
}

interface PolicyData {
  policy: Address
  initData: Hex
}

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
  '0x00000088d48cf102a8cdb0137a9b173f957c6343'
const TIME_FRAME_POLICY_ADDRESS: Address =
  '0x8177451511de0577b911c254e9551d981c26dc72'
const SUDO_POLICY_ADDRESS: Address =
  '0x0000003111cd8e92337c100f22b7a9dbf8dee301'
const UNIVERSAL_ACTION_POLICY_ADDRESS: Address =
  '0x0000006dda6c463511c4e9b05cfc34c1247fcf1f'
const ARG_POLICY_ADDRESS: Address = '0x0000000000167edE64D8751daACDdC0312565a73'
const USAGE_LIMIT_POLICY_ADDRESS: Address =
  '0x1f34ef8311345a3a4a4566af321b313052f51493'
const VALUE_LIMIT_POLICY_ADDRESS: Address =
  '0x730da93267e7e513e932301b47f2ac7d062abc83'
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

interface ResolvedSessionSignerSet {
  type: 'experimental_session'
  session: Session
  enableData?: SessionEnableData
  verifyExecutions: boolean
  claimPolicyData?: Hex
  useDevContracts?: boolean
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
    const sessionData = getSessionData(signers.session, signers.useDevContracts)

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
  const sessionDatas = sessions.map((session) =>
    getSessionData(session, useDevContracts),
  )
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

  const chain = getChainById(Number(details.hashesAndChainIds[0].chainId))
  return signTypedData(config, details.data, chain, undefined, {
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
  const sessionData = getSessionData(session, useDevContracts)
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

function getSessionData(
  session: Session,
  useDevContracts?: boolean,
): SessionData {
  if (ownerSetUsesEns(session.owners)) {
    throw new Error('ENS owners are not supported for smart sessions')
  }

  const validator = getValidator(session.owners)
  const swap = session.swap
    ? resolveSwapScope(
        session.swap,
        session.chain.id,
        useDevContracts ? 'development' : 'production',
      )
    : undefined
  const restricted = session.restrictToActions === true || swap !== undefined
  const explicitActions = [...(session.actions ?? []), ...(swap?.actions ?? [])]

  if (restricted) {
    if (session.claimPolicies?.length) {
      throw new Error(
        'Restricted sessions cannot use claimPolicies because their guardrails rely on the fallback action',
      )
    }
    if (explicitActions.length === 0) {
      throw new Error(
        'Restricted sessions require at least one explicit action or swap scope',
      )
    }
    const seen = new Set<string>()
    for (const action of explicitActions) {
      if (!('target' in action) || !('selector' in action)) {
        throw new Error('Restricted sessions do not allow fallback actions')
      }
      if (action.target.toLowerCase() === SMART_SESSIONS_FALLBACK_TARGET_FLAG) {
        throw new Error(
          'Restricted sessions cannot target the smart-session fallback sentinel',
        )
      }
      const key = `${action.target.toLowerCase()}|${action.selector.toLowerCase()}`
      if (seen.has(key)) {
        throw new Error(
          `Duplicate scoped action for ${action.target} ${action.selector}`,
        )
      }
      seen.add(key)
    }
  }

  const erc7739Data = {
    allowedERC7739Content: restricted
      ? []
      : [
          {
            contentNames: [''],
            appDomainSeparator: zeroHash,
          },
        ],
    erc1271Policies: restricted
      ? []
      : [
          {
            policy: SUDO_POLICY_ADDRESS,
            initData: '0x' as Hex,
          },
        ],
  }
  const sudoAction = {
    actionTargetSelector: SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG,
    actionTarget: SMART_SESSIONS_FALLBACK_TARGET_FLAG,
    actionPolicies: [
      {
        policy: SUDO_POLICY_ADDRESS,
        initData: '0x' as Hex,
      },
    ],
  }
  const userHasFallbackAction = explicitActions.some(
    (action) => !('target' in action) && !('selector' in action),
  )
  const injectedActions: Action[] = [
    ...(!restricted
      ? [
          {
            target: getWrappedTokenAddress(session.chain),
            selector: toFunctionSelector({
              type: 'function',
              name: 'deposit',
              inputs: [],
              outputs: [],
              stateMutability: 'payable',
            }),
          } satisfies Action,
        ]
      : []),
    ...(!restricted && !userHasFallbackAction
      ? [{ policies: [{ type: 'intent-execution' as const }] }]
      : []),
    {
      target: DUMMY_PRECLAIMOP_TARGET,
      selector: DUMMY_PRECLAIMOP_SELECTOR,
      policies: restricted
        ? [{ type: 'value-limit' as const, limit: 1n }]
        : [{ type: 'sudo' as const }],
    },
  ]
  const sessionActions =
    restricted || explicitActions.length > 0
      ? [...explicitActions, ...injectedActions]
      : []
  const actions = sessionActions.length
    ? sessionActions.map((action) => resolveActionData(action, useDevContracts))
    : [sudoAction]
  const saltActions =
    restricted && useDevContracts && session.swap
      ? [
          ...(session.actions ?? []),
          ...resolveSwapScope(session.swap, session.chain.id, 'production')
            .actions,
          ...injectedActions,
        ].map((action) => resolveActionData(action, false))
      : actions

  return {
    sessionValidator: validator.address,
    salt: restricted ? getRestrictedSessionSalt(saltActions) : zeroHash,
    sessionValidatorInitData: validator.initData,
    erc7739Policies: erc7739Data,
    actions,
    claimPolicies:
      session.claimPolicies?.map((policy) => ({
        policy: PERMIT2_CLAIM_POLICY_ADDRESS,
        initData: encodePermit2ClaimPolicyInitData(policy),
      })) ?? [],
  }
}

function resolveActionData(
  action: Action,
  useDevContracts?: boolean,
): ActionData {
  return {
    actionTargetSelector:
      'selector' in action
        ? action.selector
        : SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG,
    actionTarget:
      'target' in action ? action.target : SMART_SESSIONS_FALLBACK_TARGET_FLAG,
    actionPolicies: action.policies?.map((policy) =>
      getPolicyData(policy, useDevContracts),
    ) ?? [
      {
        policy: SUDO_POLICY_ADDRESS,
        initData: '0x' as Hex,
      },
    ],
  }
}

function getRestrictedSessionSalt(actions: readonly ActionData[]): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        {
          name: 'actions',
          type: 'tuple[]',
          components: [
            { name: 'actionTargetSelector', type: 'bytes4' },
            { name: 'actionTarget', type: 'address' },
            {
              name: 'actionPolicies',
              type: 'tuple[]',
              components: [
                { name: 'policy', type: 'address' },
                { name: 'initData', type: 'bytes' },
              ],
            },
          ],
        },
      ],
      [actions],
    ),
  )
}

function getPermissionId(session: Session) {
  const sessionData = getSessionData(session)
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

function encodeActionRule(
  rule: Extract<Policy, { type: 'universal-action' }>['rules'][number],
): ActionParamRule {
  const conditions: Record<UniversalActionPolicyParamCondition, number> = {
    equal: ACTION_CONDITION_EQUAL,
    greaterThan: ACTION_CONDITION_GREATER_THAN,
    lessThan: ACTION_CONDITION_LESS_THAN,
    greaterThanOrEqual: ACTION_CONDITION_GREATER_THAN_OR_EQUAL,
    lessThanOrEqual: ACTION_CONDITION_LESS_THAN_OR_EQUAL,
    notEqual: ACTION_CONDITION_NOT_EQUAL,
    inRange: ACTION_CONDITION_IN_RANGE,
  }
  return {
    condition: conditions[rule.condition],
    offset: rule.calldataOffset,
    isLimited: rule.usageLimit !== undefined,
    ref: isHex(rule.referenceValue)
      ? padHex(rule.referenceValue)
      : toHex(rule.referenceValue, { size: 32 }),
    usage: { limit: rule.usageLimit ?? 0n, used: 0n },
  }
}

function compileArgPolicyExpression(expression: ArgPolicyExpression) {
  const rules: ActionParamRule[] = []
  const packedNodes: bigint[] = []
  const walk = (node: ArgPolicyExpression): number => {
    if (node.type === 'rule') {
      const ruleIndex = rules.push(encodeActionRule(node.rule)) - 1
      const nodeIndex = packedNodes.length
      packedNodes.push(BigInt(ruleIndex) << 2n)
      return nodeIndex
    }
    if (node.type === 'not') {
      const child = walk(node.child)
      const nodeIndex = packedNodes.length
      packedNodes.push(1n | (BigInt(child) << 10n))
      return nodeIndex
    }
    const left = walk(node.left)
    const right = walk(node.right)
    const nodeIndex = packedNodes.length
    packedNodes.push(
      (node.type === 'and' ? 2n : 3n) |
        (BigInt(left) << 10n) |
        (BigInt(right) << 18n),
    )
    return nodeIndex
  }
  const rootNodeIndex = walk(expression)
  if (rules.length > 128) {
    throw new Error(
      `ArgPolicy expression has ${rules.length} rules, max is 128`,
    )
  }
  if (packedNodes.length > 256) {
    throw new Error(
      `ArgPolicy expression has ${packedNodes.length} nodes, max is 256`,
    )
  }
  return { rules, packedNodes, rootNodeIndex }
}

function getPolicyData(policy: Policy, useDevContracts?: boolean): PolicyData {
  switch (policy.type) {
    case 'sudo':
      return {
        policy: SUDO_POLICY_ADDRESS,
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
      if (policy.rules.length > MAX_RULES) {
        throw new Error('Universal action policy supports at most 16 rules')
      }
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
        rules[i] = encodeActionRule(policy.rules[i])
      }
      return {
        policy: UNIVERSAL_ACTION_POLICY_ADDRESS,
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
      const compiled = compileArgPolicyExpression(policy.expression)
      return {
        policy: ARG_POLICY_ADDRESS,
        initData: encodeAbiParameters(
          [
            {
              name: 'ActionConfig',
              type: 'tuple',
              components: [
                { name: 'valueLimitPerUse', type: 'uint256' },
                {
                  name: 'paramRules',
                  type: 'tuple',
                  components: [
                    { name: 'rootNodeIndex', type: 'uint8' },
                    {
                      name: 'rules',
                      type: 'tuple[]',
                      components: [
                        { name: 'condition', type: 'uint8' },
                        { name: 'offset', type: 'uint64' },
                        { name: 'isLimited', type: 'bool' },
                        { name: 'ref', type: 'bytes32' },
                        {
                          name: 'usage',
                          type: 'tuple',
                          components: [
                            { name: 'limit', type: 'uint256' },
                            { name: 'used', type: 'uint256' },
                          ],
                        },
                      ],
                    },
                    { name: 'packedNodes', type: 'uint256[]' },
                  ],
                },
              ],
            },
          ],
          [
            {
              valueLimitPerUse: policy.valueLimitPerUse ?? 0n,
              paramRules: compiled,
            },
          ],
        ),
      }
    }
    case 'spending-limits': {
      const tokens = policy.limits.map(({ token }) => token)
      const limits = policy.limits.map(({ amount }) => amount)
      return {
        policy: SPENDING_LIMITS_POLICY_ADDRESS,
        initData: encodeAbiParameters(
          [{ type: 'address[]' }, { type: 'uint256[]' }],
          [tokens, limits],
        ),
      }
    }
    case 'time-frame': {
      // Deployed TimeFramePolicy reads `bytes16 validUntil || bytes16 validAfter` (32 bytes).
      return {
        policy: TIME_FRAME_POLICY_ADDRESS,
        initData: encodePacked(
          ['uint128', 'uint128'],
          [
            BigInt(Math.floor(policy.validUntil / 1000)),
            BigInt(Math.floor(policy.validAfter / 1000)),
          ],
        ),
      }
    }
    case 'usage-limit': {
      return {
        policy: USAGE_LIMIT_POLICY_ADDRESS,
        initData: encodePacked(['uint128'], [policy.limit]),
      }
    }
    case 'value-limit': {
      return {
        policy: VALUE_LIMIT_POLICY_ADDRESS,
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
 * Format: emissaryAddress (20 bytes) + enable-mode sigData.
 * Uses real session data (policies/actions from the user's session config) with dummy
 * sigs and hashes — the mock emissary skips sig verification and only writes storage.
 * The orchestrator slices off the first 20 bytes to identify the validator, then
 * simulates verifyExecution with the mock emissary to estimate gas before the user signs.
 */
function buildMockSignature(
  session: Session,
  useDevContracts?: boolean,
  chainCount: number = 1,
  targetChainId?: number,
): Hex {
  const emissaryAddress = getSmartSessionEmissaryAddress(useDevContracts)
  // Use targetChainId when provided (per-chain mockSignatures path) so the
  // mock emissary's chainId check passes on the correct chain. Falls back to
  // session.chain.id for the global mockSignature (single-chain path).
  const primaryChainId = targetChainId ?? session.chain.id
  // Normalize chainCount to a finite positive integer. Guards against
  // accidental NaN/undefined from caller (e.g. `sourceChains?.length` when
  // sourceChains is undefined) which would otherwise make Array.from produce
  // an empty array and silently drop the ChainId check.
  const safeChainCount =
    Number.isFinite(chainCount) && chainCount > 0 ? Math.floor(chainCount) : 1
  // Build one entry per chain — first entry is the real chain ID (for the ChainId check),
  // remaining entries use chainId 0 as placeholders. Hash mismatch is skipped by the
  // mock emissary, so sessionDigest can be zeroHash throughout.
  const hashesAndChainIds = Array.from({ length: safeChainCount }, (_, i) => ({
    chainId: i === 0 ? BigInt(primaryChainId) : 0n,
    sessionDigest: zeroHash,
  }))
  const dummySigners: ResolvedSessionSignerSet = {
    type: 'experimental_session',
    session,
    verifyExecutions: true,
    useDevContracts,
    enableData: {
      userSignature: `0x${'00'.repeat(65)}` as Hex,
      hashesAndChainIds,
      sessionToEnableIndex: 0,
    },
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
  getSessionData,
  getPolicyData,
  getEnableSessionCall,
  getPermissionId,
  getSmartSessionValidator,
  getSessionDetails,
  isSessionEnabled,
  signEnableSession,
  buildMockSignature,
  fynd,
  resolveZeroExSettler,
  rhinestoneSwap,
  toSession,
  zeroEx,
}

export type {
  ChainSession,
  ChainDigest,
  FyndVenue,
  ResolvedSessionSignerSet,
  RhinestoneSwapVenue,
  SessionData,
  SmartSessionModeType,
  SessionDetails,
  SwapScope,
  SwapScopeFor,
  SwapVenue,
  SwapVenueFor,
  ZeroExAnySettlerOptions,
  ZeroExPinnedOptions,
  ZeroExVenue,
}
