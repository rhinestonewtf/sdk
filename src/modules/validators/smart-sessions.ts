import { LibZip } from 'solady'
import {
  type Address,
  createPublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  type Hex,
  hashStruct,
  http,
  isHex,
  keccak256,
  maxUint256,
  padHex,
  size,
  type TypedDataDefinition,
  toHex,
  zeroAddress,
  zeroHash,
} from 'viem'
import { mainnet } from 'viem/chains'
import {
  RESET_PERIOD_ONE_WEEK,
  SCOPE_MULTICHAIN,
} from '../../execution/compact'
import { signTypedData } from '../../execution/utils'
import type {
  Policy,
  RhinestoneAccountConfig,
  Session,
  SignerSet,
  UniversalActionPolicyParamCondition,
} from '../../types'
import smartSessionEmissaryAbi from '../abi/smart-session-emissary'
import { MODULE_TYPE_ID_VALIDATOR, type Module } from '../common'
import { getValidator, SMART_SESSION_EMISSARY_ADDRESS } from './core'

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

const SPENDING_LIMITS_POLICY_ADDRESS: Address =
  '0x00000088d48cf102a8cdb0137a9b173f957c6343'
const TIME_FRAME_POLICY_ADDRESS: Address =
  '0x8177451511de0577b911c254e9551d981c26dc72'
const SUDO_POLICY_ADDRESS: Address =
  '0x0000003111cd8e92337c100f22b7a9dbf8dee301'
const UNIVERSAL_ACTION_POLICY_ADDRESS: Address =
  '0x0000006dda6c463511c4e9b05cfc34c1247fcf1f'
const USAGE_LIMIT_POLICY_ADDRESS: Address =
  '0x1f34ef8311345a3a4a4566af321b313052f51493'
const VALUE_LIMIT_POLICY_ADDRESS: Address =
  '0x730da93267e7e513e932301b47f2ac7d062abc83'

const ACTION_CONDITION_EQUAL = 0
const ACTION_CONDITION_GREATER_THAN = 1
const ACTION_CONDITION_LESS_THAN = 2
const ACTION_CONDITION_GREATER_THAN_OR_EQUAL = 3
const ACTION_CONDITION_LESS_THAN_OR_EQUAL = 4
const ACTION_CONDITION_NOT_EQUAL = 5
const ACTION_CONDITION_IN_RANGE = 6

function packSignature(
  signers: SignerSet & { type: 'experimental_session' },
  validatorSignature: Hex,
): Hex {
  const permissionId = getPermissionId(signers.session)
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
    const policySpecificData = '0x'
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
): Promise<SessionDetails> {
  const lockTag = '0x000000000000000000000000'
  const sessionNonces = await Promise.all(
    sessions.map((session) => getSessionNonce(account, session, lockTag)),
  )
  const sessionDatas = sessions.map((session) => getSessionData(session))
  const signedSessions = sessionDatas.map((session, index) =>
    getSignedSession(account, lockTag, session, sessionNonces[index]),
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

async function signEnableSession(
  config: RhinestoneAccountConfig,
  details: SessionDetails,
): Promise<Hex> {
  return signTypedData(config, details.data, mainnet, undefined, {
    skipErc6492: true,
  })
}

async function getSessionNonce(
  account: Address,
  session: Session,
  lockTag: Hex,
): Promise<bigint> {
  const publicClient = createPublicClient({
    chain: session.chain,
    transport: http(),
  })
  const nonce = await publicClient.readContract({
    address: SMART_SESSION_EMISSARY_ADDRESS,
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
    smartSessionEmissary: SMART_SESSION_EMISSARY_ADDRESS,
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
) {
  const sessionData = getSessionData(session)
  const permissionId = getPermissionId(session)
  return {
    to: SMART_SESSION_EMISSARY_ADDRESS,
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

function getSessionData(session: Session): SessionData {
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
  const actions = session.actions
    ? session.actions.map((action) => ({
        actionTargetSelector:
          action.selector ?? SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG,
        actionTarget: action.target ?? SMART_SESSIONS_FALLBACK_TARGET_FLAG,
        actionPolicies: action.policies?.map((policy) =>
          getPolicyData(policy),
        ) ?? [
          {
            policy: SUDO_POLICY_ADDRESS,
            initData: '0x' as Hex,
          },
        ],
      }))
    : [sudoAction]
  return {
    sessionValidator: validator.address,
    salt: zeroHash,
    sessionValidatorInitData: validator.initData,
    erc7739Policies: erc7739Data,
    actions,
    claimPolicies: [],
  }
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

function getPolicyData(policy: Policy): PolicyData {
  switch (policy.type) {
    case 'sudo':
      return {
        policy: SUDO_POLICY_ADDRESS,
        initData: '0x',
      }
    case 'universal-action': {
      function getCondition(condition: UniversalActionPolicyParamCondition) {
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
        const rule = policy.rules[i]
        const ref = isHex(rule.referenceValue)
          ? padHex(rule.referenceValue)
          : toHex(rule.referenceValue, { size: 32 })
        rules[i] = {
          condition: getCondition(rule.condition),
          offset: rule.calldataOffset,
          isLimited: rule.usageLimit !== undefined,
          ref,
          usage: {
            limit: rule.usageLimit ? rule.usageLimit : 0n,
            used: 0n,
          },
        }
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
      return {
        policy: TIME_FRAME_POLICY_ADDRESS,
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

function getSmartSessionValidator(
  config: RhinestoneAccountConfig,
): Module | null {
  if (!config.experimental_sessions) {
    return null
  }
  const { enabled, module } = config.experimental_sessions
  if (!enabled) {
    return null
  }
  return {
    address: module ?? SMART_SESSION_EMISSARY_ADDRESS,
    initData: '0x',
    deInitData: '0x',
    additionalContext: '0x',
    type: MODULE_TYPE_ID_VALIDATOR,
  }
}

function createFixedArray<T, N extends number>(
  length: N,
  getValue: (index: number) => T,
): FixedLengthArray<T, N> {
  return Array.from({ length }, (_, i) => getValue(i)) as FixedLengthArray<T, N>
}

export {
  SMART_SESSION_EMISSARY_ADDRESS,
  SMART_SESSIONS_FALLBACK_TARGET_FLAG,
  SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG,
  SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG_PERMITTED_TO_CALL_SMARTSESSION,
  packSignature,
  getSessionData,
  getEnableSessionCall,
  getPermissionId,
  getSmartSessionValidator,
  getSessionDetails,
  signEnableSession,
}
export type {
  ChainSession,
  ChainDigest,
  SessionData,
  SmartSessionModeType,
  SessionDetails,
}
