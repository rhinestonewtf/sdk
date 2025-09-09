import { LibZip } from 'solady'
import {
  type Address,
  type Chain,
  createPublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  type Hex,
  isHex,
  keccak256,
  type PublicClient,
  padHex,
  parseAbi,
  toHex,
  zeroHash,
} from 'viem'
import { createTransport } from '../../accounts/utils'
import {
  getWethAddress,
  RHINESTONE_SPOKE_POOL_ADDRESS,
} from '../../orchestrator'
import type {
  AccountType,
  Policy,
  ProviderConfig,
  RhinestoneAccountConfig,
  Session,
  SmartSessionEmissaryConfig,
  SmartSessionEmissaryEnable,
  EnableSession,
  SessionStruct,
  PolicyData as PolicyDataType,
  ActionData as ActionDataType,
  UniversalActionPolicyParamCondition,
} from '../../types'
import { enableSessionsAbi } from '../abi/smart-sessions'
import { MODULE_TYPE_ID_VALIDATOR, type Module } from '../common'
import { HOOK_ADDRESS } from '../omni-account'
import { getValidator } from './core'

type FixedLengthArray<
  T,
  N extends number,
  A extends T[] = [],
> = A['length'] extends N ? A : FixedLengthArray<T, N, [...A, T]>

interface SessionData {
  sessionValidator: Address
  sessionValidatorInitData: Hex
  salt: Hex
  userOpPolicies: readonly UserOpPolicy[]
  erc7739Policies: {
    allowedERC7739Content: readonly AllowedERC7739Content[]
    erc1271Policies: readonly ERC1271Policy[]
  }
  actions: readonly LocalActionData[]
  permitERC4337Paymaster: boolean
}

interface UserOpPolicy {
  policy: Address
  initData: Hex
}

interface ERC1271Policy {
  policy: Address
  initData: Hex
}

interface AllowedERC7739Content {
  appDomainSeparator: Hex
  contentName: readonly string[]
}

// Using ActionData from types.ts, renamed local one to avoid conflict
interface LocalActionData {
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
  | typeof SMART_SESSION_MODE_UNSAFE_ENABLE

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
  actions: readonly LocalActionData[]
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

interface EnableSessionData {
  permissionId: Hex
  accountType: AccountType
  chainDigestIndex: number
  hashesAndChainIds: ChainDigest[]
  sessionToEnable: SessionData
  signature: Hex
  validator: Address
}

const SMART_SESSIONS_VALIDATOR_ADDRESS: Address =
  '0x00000000002b0ecfbd0496ee71e01257da0e37de'
const SMART_SESSION_EMISSARY_ADDRESS: Address =
  '0x56A75A49F8663a80e70BFdA8ab0681421B08B754'

const SMART_SESSION_MODE_USE = '0x00'
const SMART_SESSION_MODE_ENABLE = '0x01'
const SMART_SESSION_MODE_UNSAFE_ENABLE = '0x02'

// Default session expiry duration (1 hour in seconds)
const DEFAULT_SESSION_EXPIRY_DURATION = 3600

// ABI for Smart Session Emissary functions
const SMART_SESSION_EMISSARY_ABI = [
  {
    type: 'function',
    name: 'getSessionDigest',
    inputs: [
      {
        name: 'account',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'session',
        type: 'tuple',
        internalType: 'struct Session',
        components: [
          {
            name: 'sessionValidator',
            type: 'address',
            internalType: 'contract ISessionValidator',
          },
          {
            name: 'sessionValidatorInitData',
            type: 'bytes',
            internalType: 'bytes',
          },
          {
            name: 'salt',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'erc1271Policies',
            type: 'tuple[]',
            internalType: 'struct PolicyData[]',
            components: [
              {
                name: 'policy',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'initData',
                type: 'bytes',
                internalType: 'bytes',
              },
            ],
          },
          {
            name: 'actions',
            type: 'tuple[]',
            internalType: 'struct ActionData[]',
            components: [
              {
                name: 'actionTargetSelector',
                type: 'bytes4',
                internalType: 'bytes4',
              },
              {
                name: 'actionTarget',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'actionPolicies',
                type: 'tuple[]',
                internalType: 'struct PolicyData[]',
                components: [
                  {
                    name: 'policy',
                    type: 'address',
                    internalType: 'address',
                  },
                  {
                    name: 'initData',
                    type: 'bytes',
                    internalType: 'bytes',
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        name: 'lockTag',
        type: 'bytes12',
        internalType: 'bytes12',
      },
      {
        name: 'expires',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'sender',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'setConfig',
    inputs: [
      {
        name: 'account',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'config',
        type: 'tuple',
        internalType: 'struct SmartSessionEmissaryConfig',
        components: [
          {
            name: 'sender',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'scope',
            type: 'uint8',
            internalType: 'enum Scope',
          },
          {
            name: 'resetPeriod',
            type: 'uint8',
            internalType: 'enum ResetPeriod',
          },
          {
            name: 'allocator',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'permissionId',
            type: 'bytes32',
            internalType: 'PermissionId',
          },
        ],
      },
      {
        name: 'enableData',
        type: 'tuple',
        internalType: 'struct SmartSessionEmissaryEnable',
        components: [
          {
            name: 'allocatorSig',
            type: 'bytes',
            internalType: 'bytes',
          },
          {
            name: 'userSig',
            type: 'bytes',
            internalType: 'bytes',
          },
          {
            name: 'expires',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'session',
            type: 'tuple',
            internalType: 'struct EnableSession',
            components: [
              {
                name: 'chainDigestIndex',
                type: 'uint8',
                internalType: 'uint8',
              },
              {
                name: 'hashesAndChainIds',
                type: 'tuple[]',
                internalType: 'struct ChainDigest[]',
                components: [
                  {
                    name: 'chainId',
                    type: 'uint64',
                    internalType: 'uint64',
                  },
                  {
                    name: 'sessionDigest',
                    type: 'bytes32',
                    internalType: 'bytes32',
                  },
                ],
              },
              {
                name: 'sessionToEnable',
                type: 'tuple',
                internalType: 'struct Session',
                components: [
                  {
                    name: 'sessionValidator',
                    type: 'address',
                    internalType: 'contract ISessionValidator',
                  },
                  {
                    name: 'sessionValidatorInitData',
                    type: 'bytes',
                    internalType: 'bytes',
                  },
                  {
                    name: 'salt',
                    type: 'bytes32',
                    internalType: 'bytes32',
                  },
                  {
                    name: 'erc1271Policies',
                    type: 'tuple[]',
                    internalType: 'struct PolicyData[]',
                    components: [
                      {
                        name: 'policy',
                        type: 'address',
                        internalType: 'address',
                      },
                      {
                        name: 'initData',
                        type: 'bytes',
                        internalType: 'bytes',
                      },
                    ],
                  },
                  {
                    name: 'actions',
                    type: 'tuple[]',
                    internalType: 'struct ActionData[]',
                    components: [
                      {
                        name: 'actionTargetSelector',
                        type: 'bytes4',
                        internalType: 'bytes4',
                      },
                      {
                        name: 'actionTarget',
                        type: 'address',
                        internalType: 'address',
                      },
                      {
                        name: 'actionPolicies',
                        type: 'tuple[]',
                        internalType: 'struct PolicyData[]',
                        components: [
                          {
                            name: 'policy',
                            type: 'address',
                            internalType: 'address',
                          },
                          {
                            name: 'initData',
                            type: 'bytes',
                            internalType: 'bytes',
                          },
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
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

const SPENDING_LIMITS_POLICY_ADDRESS: Address =
  '0x00000088D48cF102A8Cdb0137A9b173f957c6343'
const TIME_FRAME_POLICY_ADDRESS: Address =
  '0x8177451511dE0577b911C254E9551D981C26dc72'
const SUDO_POLICY_ADDRESS: Address =
  '0x0000003111cD8e92337C100F22B7A9dbf8DEE301'
const UNIVERSAL_ACTION_POLICY_ADDRESS: Address =
  '0x0000006DDA6c463511C4e9B05CFc34C1247fCF1F'
const USAGE_LIMIT_POLICY_ADDRESS: Address =
  '0x1F34eF8311345A3A4a4566aF321b313052F51493'
const VALUE_LIMIT_POLICY_ADDRESS: Address =
  '0x730DA93267E7E513e932301B47F2ac7D062abC83'
const SMART_SESSIONS_FALLBACK_TARGET_FLAG: Address =
  '0x0000000000000000000000000000000000000001'
const SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG: Hex = '0x00000001'

const ACTION_CONDITION_EQUAL = 0
const ACTION_CONDITION_GREATER_THAN = 1
const ACTION_CONDITION_LESS_THAN = 2
const ACTION_CONDITION_GREATER_THAN_OR_EQUAL = 3
const ACTION_CONDITION_LESS_THAN_OR_EQUAL = 4
const ACTION_CONDITION_NOT_EQUAL = 5
const ACTION_CONDITION_IN_RANGE = 6

async function getSessionData(
  chain: Chain,
  session: Session,
  provider?: ProviderConfig,
) {
  const { appDomainSeparator, contentsType } =
    await getSessionAllowedERC7739Content(chain, provider)
  const allowedERC7739Content = [
    {
      appDomainSeparator,
      contentName: [contentsType],
    },
  ]
  return getSmartSessionData(chain, session, allowedERC7739Content)
}

async function getEnableSessionCall(
  chain: Chain,
  session: Session,
  provider?: ProviderConfig,
) {
  const { appDomainSeparator, contentsType } =
    await getSessionAllowedERC7739Content(chain, provider)
  const allowedERC7739Content = [
    {
      appDomainSeparator,
      contentName: [contentsType],
    },
  ]
  const sessionData = getSmartSessionData(chain, session, allowedERC7739Content)
  return {
    to: SMART_SESSIONS_VALIDATOR_ADDRESS,
    data: encodeFunctionData({
      abi: enableSessionsAbi,
      functionName: 'enableSessions',
      args: [[sessionData]],
    }),
  }
}

async function getEnableEmissarySessionCall(
  chain: Chain,
  session: Session,
  accountAddress: Address,
  provider?: ProviderConfig,
  overrideEnable?: Partial<SmartSessionEmissaryEnable>,
  sessionDigest?: Hex,
) {
  const { appDomainSeparator, contentsType } =
    await getSessionAllowedERC7739Content(chain, provider)
  const allowedERC7739Content = [
    {
      appDomainSeparator,
      contentName: [contentsType],
    },
  ]
  const sessionData = getSmartSessionData(
    chain,
    session,
    allowedERC7739Content,
  )

  // Get the permission ID for this session
  const permissionId = getPermissionId(session)

  // Prepare the SmartSessionEmissaryConfig according to contract
  const config: SmartSessionEmissaryConfig = {
    sender: SMART_SESSIONS_VALIDATOR_ADDRESS,
    scope: session.emissary ? Number(session.emissary.scope) : 0,
    resetPeriod: session.emissary ? Number(session.emissary.resetPeriod) : 2,
    allocator:
      session.emissary?.allocator ||
      '0x0000000000000000000000000000000000000000',
    permissionId,
  }

  // Convert sessionData to SessionStruct format
  const sessionStruct: SessionStruct = {
    sessionValidator: sessionData.sessionValidator,
    sessionValidatorInitData: sessionData.sessionValidatorInitData,
    salt: sessionData.salt,
    erc1271Policies: sessionData.erc7739Policies.erc1271Policies.map((policy: PolicyData) => ({
      policy: policy.policy,
      initData: policy.initData,
    })) as PolicyDataType[],
    actions: sessionData.actions.map((action: LocalActionData) => ({
      actionTargetSelector: action.actionTargetSelector,
      actionTarget: action.actionTarget,
      actionPolicies: action.actionPolicies.map((policy: PolicyData) => ({
        policy: policy.policy,
        initData: policy.initData,
      })) as PolicyDataType[],
    })) as ActionDataType[],
  }

  // Prepare the EnableSession structure
  const enableSession: EnableSession = {
    chainDigestIndex: 0,
    hashesAndChainIds: [
      {
        chainId: BigInt(chain.id),
        sessionDigest: sessionDigest || '0x0000000000000000000000000000000000000000000000000000000000000000',
      },
    ],
    sessionToEnable: sessionStruct,
  }

  // Prepare the SmartSessionEmissaryEnable according to contract
  const enableData: SmartSessionEmissaryEnable = {
    allocatorSig: overrideEnable?.allocatorSig || '0x',
    userSig: overrideEnable?.userSig || '0x',
    expires: overrideEnable?.expires || BigInt(Math.floor(Date.now() / 1000) + DEFAULT_SESSION_EXPIRY_DURATION),
    session: enableSession,
  }

  return {
    to: SMART_SESSION_EMISSARY_ADDRESS,
    data: encodeFunctionData({
      abi: SMART_SESSION_EMISSARY_ABI,
      functionName: 'setConfig',
      args: [accountAddress, config, enableData],
    }),
  }
}

function getOmniAccountActions(chain: Chain): LocalActionData[] {
  const wethAddress = getWethAddress(chain)
  const omniActions: LocalActionData[] = [
    {
      actionTarget: RHINESTONE_SPOKE_POOL_ADDRESS,
      actionTargetSelector: '0xa2418864', // injected execution
      actionPolicies: [getPolicyData({ type: 'sudo' })],
    },
    {
      actionTarget: HOOK_ADDRESS,
      actionTargetSelector: '0x27c777a9', // injected execution
      actionPolicies: [getPolicyData({ type: 'sudo' })],
    },
    {
      actionTarget: wethAddress,
      actionTargetSelector: '0xd0e30db0', // deposit
      actionPolicies: [getPolicyData({ type: 'sudo' })],
    },
    {
      actionTarget: wethAddress,
      actionTargetSelector: '0x2e1a7d4d', // widthdraw
      actionPolicies: [getPolicyData({ type: 'sudo' })],
    },
  ]
  return omniActions
}

async function getSessionAllowedERC7739Content(
  chain: Chain,
  provider?: ProviderConfig,
) {
  const publicClient = createPublicClient({
    chain,
    transport: createTransport(chain, provider),
  })
  const appDomainSeparator = await publicClient.readContract({
    address: HOOK_ADDRESS,
    abi: parseAbi(['function DOMAIN_SEPARATOR() view returns (bytes32)']),
    functionName: 'DOMAIN_SEPARATOR',
  })
  const contentsType =
    'MultichainCompact(address sponsor,uint256 nonce,uint256 expires,Segment[] segments)Segment(address arbiter,uint256 chainId,uint256[2][] idsAndAmounts,Witness witness)Witness(address recipient,uint256[2][] tokenOut,uint256 depositId,uint256 targetChain,uint32 fillDeadline,XchainExec[] execs,bytes32 userOpHash,uint32 maxFeeBps)XchainExec(address to,uint256 value,bytes data)'
  return {
    appDomainSeparator,
    contentsType,
  }
}

function getSmartSessionData(
  chain: Chain,
  session: Session,
  allowedERC7739Content: AllowedERC7739Content[],
) {
  const omniActions = getOmniAccountActions(chain)

  const sessionValidator = getValidator(session.owners)
  const userOpPolicies = (
    session.policies || [
      {
        type: 'sudo',
      },
    ]
  ).map((policy) => {
    return getPolicyData(policy)
  })

  return {
    sessionValidator: sessionValidator.address,
    sessionValidatorInitData: sessionValidator.initData,
    salt: session.salt ?? zeroHash,
    userOpPolicies,
    actions: (
      session.actions || [
        {
          target: SMART_SESSIONS_FALLBACK_TARGET_FLAG,
          selector: SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG,
        },
      ]
    )
      .map((action) => {
        const actionPolicies: readonly PolicyData[] = (
          action.policies || [
            {
              type: 'sudo',
            },
          ]
        ).map((policy) => {
          return getPolicyData(policy)
        })
        return {
          actionTargetSelector: action.selector,
          actionTarget: action.target,
          actionPolicies,
        }
      })
      .concat(omniActions),
    erc7739Policies: {
      allowedERC7739Content,
      erc1271Policies: [getPolicyData({ type: 'sudo' })],
    },
    permitERC4337Paymaster: true,
  } as SessionData
}

function getSmartSessionValidator(
  config: RhinestoneAccountConfig,
): Module | null {
  if (!config.sessions) {
    return null
  }
  return {
    address: SMART_SESSIONS_VALIDATOR_ADDRESS,
    initData: '0x',
    deInitData: '0x',
    additionalContext: '0x',
    type: MODULE_TYPE_ID_VALIDATOR,
  }
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

function createFixedArray<T, N extends number>(
  length: N,
  getValue: (index: number) => T,
): FixedLengthArray<T, N> {
  return Array.from({ length }, (_, i) => getValue(i)) as FixedLengthArray<T, N>
}

async function isSessionEnabled(
  client: PublicClient,
  address: Address,
  permissionId: Hex,
) {
  return await client.readContract({
    address: SMART_SESSIONS_VALIDATOR_ADDRESS,
    abi: [
      {
        inputs: [
          {
            internalType: 'PermissionId',
            name: 'permissionId',
            type: 'bytes32',
          },
          {
            internalType: 'address',
            name: 'account',
            type: 'address',
          },
        ],
        name: 'isPermissionEnabled',
        outputs: [
          {
            internalType: 'bool',
            name: '',
            type: 'bool',
          },
        ],
        stateMutability: 'view',
        type: 'function',
      },
    ],
    functionName: 'isPermissionEnabled',
    args: [permissionId, address],
  })
}

function encodeSmartSessionSignature(
  mode: SmartSessionModeType,
  permissionId: Hex,
  signature: Hex,
  enableSessionData?: EnableSessionData,
) {
  switch (mode) {
    case SMART_SESSION_MODE_USE:
      return encodePacked(
        ['bytes1', 'bytes32', 'bytes'],
        [mode, permissionId, signature],
      )
    case SMART_SESSION_MODE_ENABLE:
    case SMART_SESSION_MODE_UNSAFE_ENABLE:
      if (!enableSessionData) {
        throw new Error('enableSession is required for ENABLE mode')
      }
      return encodePacked(
        ['bytes1', 'bytes'],
        [
          mode,
          LibZip.flzCompress(
            encodeEnableSessionSignature(enableSessionData, signature),
          ) as Hex,
        ],
      )
    default:
      throw new Error(`Unknown mode ${mode}`)
  }
}

function encodeEnableSessionSignature(
  enableSessionData: EnableSessionData,
  signature: Hex,
) {
  return encodeAbiParameters(
    [
      {
        components: [
          {
            type: 'uint8',
            name: 'chainDigestIndex',
          },
          {
            type: 'tuple[]',
            components: [
              {
                internalType: 'uint64',
                name: 'chainId',
                type: 'uint64',
              },
              {
                internalType: 'bytes32',
                name: 'sessionDigest',
                type: 'bytes32',
              },
            ],
            name: 'hashesAndChainIds',
          },
          {
            components: [
              {
                internalType: 'contract ISessionValidator',
                name: 'sessionValidator',
                type: 'address',
              },
              {
                internalType: 'bytes',
                name: 'sessionValidatorInitData',
                type: 'bytes',
              },
              { internalType: 'bytes32', name: 'salt', type: 'bytes32' },
              {
                components: [
                  { internalType: 'address', name: 'policy', type: 'address' },
                  { internalType: 'bytes', name: 'initData', type: 'bytes' },
                ],
                internalType: 'struct PolicyData[]',
                name: 'userOpPolicies',
                type: 'tuple[]',
              },
              {
                components: [
                  {
                    components: [
                      {
                        internalType: 'bytes32',
                        name: 'appDomainSeparator',
                        type: 'bytes32',
                      },
                      {
                        internalType: 'string[]',
                        name: 'contentName',
                        type: 'string[]',
                      },
                    ],
                    internalType: 'struct ERC7739Context[]',
                    name: 'allowedERC7739Content',
                    type: 'tuple[]',
                  },

                  {
                    components: [
                      {
                        internalType: 'address',
                        name: 'policy',
                        type: 'address',
                      },
                      {
                        internalType: 'bytes',
                        name: 'initData',
                        type: 'bytes',
                      },
                    ],
                    internalType: 'struct PolicyData[]',
                    name: 'erc1271Policies',
                    type: 'tuple[]',
                  },
                ],
                internalType: 'struct ERC7739Data',
                name: 'erc7739Policies',
                type: 'tuple',
              },
              {
                components: [
                  {
                    internalType: 'bytes4',
                    name: 'actionTargetSelector',
                    type: 'bytes4',
                  },
                  {
                    internalType: 'address',
                    name: 'actionTarget',
                    type: 'address',
                  },
                  {
                    components: [
                      {
                        internalType: 'address',
                        name: 'policy',
                        type: 'address',
                      },
                      {
                        internalType: 'bytes',
                        name: 'initData',
                        type: 'bytes',
                      },
                    ],
                    internalType: 'struct PolicyData[]',
                    name: 'actionPolicies',
                    type: 'tuple[]',
                  },
                ],
                internalType: 'struct ActionData[]',
                name: 'actions',
                type: 'tuple[]',
              },
              {
                internalType: 'bool',
                name: 'permitERC4337Paymaster',
                type: 'bool',
              },
            ],
            internalType: 'struct Session',
            name: 'sessionToEnable',
            type: 'tuple',
          },
          {
            type: 'bytes',
            name: 'permissionEnableSig',
          },
        ],
        internalType: 'struct EnableSession',
        name: 'enableSession',
        type: 'tuple',
      },
      {
        type: 'bytes',
        name: 'signature',
      },
    ],
    [
      {
        chainDigestIndex: enableSessionData.chainDigestIndex,
        hashesAndChainIds: enableSessionData.hashesAndChainIds,
        sessionToEnable: enableSessionData.sessionToEnable,
        permissionEnableSig: enableSessionData.signature,
      },
      signature,
    ],
  )
}

function getPermissionId(session: Session) {
  const sessionValidator = getValidator(session.owners)
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
        sessionValidator.address,
        sessionValidator.initData,
        session.salt ?? zeroHash,
      ],
    ),
  )
}

export {
  SMART_SESSION_MODE_USE,
  SMART_SESSION_MODE_ENABLE,
  SMART_SESSIONS_VALIDATOR_ADDRESS,
  SMART_SESSION_EMISSARY_ADDRESS,
  SMART_SESSION_EMISSARY_ABI,
  DEFAULT_SESSION_EXPIRY_DURATION,
  getSessionData,
  getSmartSessionValidator,
  getEnableSessionCall,
  getEnableEmissarySessionCall,
  encodeSmartSessionSignature,
  getPermissionId,
  isSessionEnabled,
}
export type {
  EnableSessionData,
  ChainSession,
  ChainDigest,
  SessionData,
  SmartSessionModeType,
}
