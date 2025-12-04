import { LibZip } from 'solady'
import {
  type Address,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  type Hex,
  isHex,
  keccak256,
  type PublicClient,
  padHex,
  toHex,
  zeroHash,
} from 'viem'
import type {
  Policy,
  RhinestoneAccountConfig,
  Session,
  UniversalActionPolicyParamCondition,
} from '../../types'
import { enableSessionsAbi } from '../abi/smart-sessions'
import { MODULE_TYPE_ID_VALIDATOR, type Module } from '../common'
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
  actions: readonly ActionData[]
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

interface EnableSessionData {
  chainDigestIndex: number
  hashesAndChainIds: ChainDigest[]
  sessionToEnable: SessionData
  signature: Hex
}

const SMART_SESSIONS_VALIDATOR_ADDRESS: Address =
  '0x00000000008bdaba73cd9815d79069c247eb4bda'

const SMART_SESSION_MODE_USE = '0x00'
const SMART_SESSION_MODE_ENABLE = '0x01'
const SMART_SESSION_MODE_UNSAFE_ENABLE = '0x02'
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
const SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG_PERMITTED_TO_CALL_SMARTSESSION: Hex =
  '0x00000002'

const ACTION_CONDITION_EQUAL = 0
const ACTION_CONDITION_GREATER_THAN = 1
const ACTION_CONDITION_LESS_THAN = 2
const ACTION_CONDITION_GREATER_THAN_OR_EQUAL = 3
const ACTION_CONDITION_LESS_THAN_OR_EQUAL = 4
const ACTION_CONDITION_NOT_EQUAL = 5
const ACTION_CONDITION_IN_RANGE = 6

async function getEnableSessionCall(session: Session) {
  const sessionData = getSmartSessionData(session)
  return {
    to: SMART_SESSIONS_VALIDATOR_ADDRESS,
    data: encodeFunctionData({
      abi: enableSessionsAbi,
      functionName: 'enableSessions',
      args: [[sessionData]],
    }),
  }
}

function getSmartSessionData(session: Session) {
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
    // Using the fallback action by default (any transaction will pass)
    actions: (
      session.actions || [
        {
          target: SMART_SESSIONS_FALLBACK_TARGET_FLAG,
          selector: SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG,
        },
      ]
    ).map((action) => {
      const actionPolicies: readonly PolicyData[] = (
        action.policies || [
          {
            type: 'sudo',
          },
        ]
      ).map((policy) => getPolicyData(policy))
      return {
        actionTargetSelector: action.selector,
        actionTarget: action.target,
        actionPolicies,
      }
    }),
    erc7739Policies: session.signing
      ? {
          allowedERC7739Content: session.signing.allowedContent.map(
            (content) => ({
              appDomainSeparator: content.domainSeparator,
              contentName: content.contentName,
            }),
          ),
          erc1271Policies: (
            session.signing.policies || [
              {
                type: 'sudo',
              },
            ]
          ).map((policy) => getPolicyData(policy)),
        }
      : {
          allowedERC7739Content: [],
          erc1271Policies: [],
        },
    permitERC4337Paymaster: true,
  } as SessionData
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
    address: module ?? SMART_SESSIONS_VALIDATOR_ADDRESS,
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
  SMART_SESSIONS_FALLBACK_TARGET_FLAG,
  SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG,
  SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG_PERMITTED_TO_CALL_SMARTSESSION,
  getSmartSessionData,
  getSmartSessionValidator,
  getEnableSessionCall,
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
