import {
  Address,
  Chain,
  bytesToHex,
  concat,
  createPublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  Hex,
  hexToBytes,
  http,
  keccak256,
  parseAbi,
  PublicClient,
  toHex,
  zeroHash,
  isHex,
  padHex,
} from 'viem'

import {
  OwnerSet,
  Policy,
  RhinestoneAccountConfig,
  Session,
  UniversalActionPolicyParamCondition,
} from '../types'
import { RHINESTONE_SPOKE_POOL_ADDRESS, getWethAddress } from '../orchestrator'

import { Module, MODULE_TYPE_ID_VALIDATOR } from './common'
import { enableSessionsAbi } from './abi/smart-sessions'
import { HOOK_ADDRESS } from './omni-account'

type FixedLengthArray<
  T,
  N extends number,
  A extends T[] = [],
> = A['length'] extends N ? A : FixedLengthArray<T, N, [...A, T]>

interface PublicKey {
  prefix?: number | undefined
  x: bigint
  y: bigint
}

interface WebauthnCredential {
  pubKey: PublicKey | Hex | Uint8Array
  authenticatorId: string
  hook?: Address
}

interface SessionData {
  sessionValidator: Address
  sessionValidatorInitData: Hex
  salt: Hex
  userOpPolicies: UserOpPolicy[]
  erc7739Policies: {
    allowedERC7739Content: AllowedERC7739Content[]
    erc1271Policies: ERC1271Policy[]
  }
  actions: ActionData[]
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
  contentName: string[]
}

interface ActionData {
  actionTarget: Address
  actionTargetSelector: Hex
  actionPolicies: PolicyData[]
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

const OWNABLE_VALIDATOR_ADDRESS: Address =
  '0x2483DA3A338895199E5e538530213157e931Bf06'
const WEBAUTHN_VALIDATOR_ADDRESS: Address =
  '0x2f167e55d42584f65e2e30a748f41ee75a311414'
const SMART_SESSIONS_VALIDATOR_ADDRESS: Address =
  '0x00000000002b0ecfbd0496ee71e01257da0e37de'

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

const ACTION_CONDITION_EQUAL = 0
const ACTION_CONDITION_GREATER_THAN = 1
const ACTION_CONDITION_LESS_THAN = 2
const ACTION_CONDITION_GREATER_THAN_OR_EQUAL = 3
const ACTION_CONDITION_LESS_THAN_OR_EQUAL = 4
const ACTION_CONDITION_NOT_EQUAL = 5
const ACTION_CONDITION_IN_RANGE = 6

const ECDSA_MOCK_SIGNATURE =
  '0x81d4b4981670cb18f99f0b4a66446df1bf5b204d24cfcb659bf38ba27a4359b5711649ec2423c5e1247245eba2964679b6a1dbb85c992ae40b9b00c6935b02ff1b'
const WEBAUTHN_MOCK_SIGNATURE =
  '0x00000000000000000000000000000000000000000000000000000000000000c000000000000000000000000000000000000000000000000000000000000001200000000000000000000000000000000000000000000000000000000000000001635bc6d0f68ff895cae8a288ecf7542a6a9cd555df784b73e1e2ea7e9104b1db15e9015d280cb19527881c625fee43fd3a405d5b0d199a8c8e6589a7381209e40000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002549960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d97631d0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f47b2274797065223a22776562617574686e2e676574222c226368616c6c656e6765223a22746278584e465339585f3442797231634d77714b724947422d5f3330613051685a36793775634d30424f45222c226f726967696e223a22687474703a2f2f6c6f63616c686f73743a33303030222c2263726f73734f726967696e223a66616c73652c20226f746865725f6b6579735f63616e5f62655f61646465645f68657265223a22646f206e6f7420636f6d7061726520636c69656e74446174614a534f4e20616761696e737420612074656d706c6174652e205365652068747470733a2f2f676f6f2e676c2f796162506578227d000000000000000000000000'

function getOwnerValidator(config: RhinestoneAccountConfig) {
  return getValidator(config.owners)
}

async function getEnableSessionCall(chain: Chain, session: Session) {
  const { appDomainSeparator, contentsType } =
    await getSessionAllowedERC7739Content(chain)
  const allowedERC7739Content = [
    {
      appDomainSeparator,
      contentName: [contentsType],
    },
  ]
  const sessionData = await getSmartSessionData(
    chain,
    session,
    allowedERC7739Content,
  )
  return {
    to: SMART_SESSIONS_VALIDATOR_ADDRESS,
    data: encodeFunctionData({
      abi: enableSessionsAbi,
      functionName: 'enableSessions',
      args: [[sessionData]],
    }),
  }
}

function getOmniAccountActions(chain: Chain): ActionData[] {
  const wethAddress = getWethAddress(chain)
  const omniActions: ActionData[] = [
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

async function getSessionAllowedERC7739Content(chain: Chain) {
  const publicClient = createPublicClient({
    chain,
    transport: http(),
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

async function getSmartSessionData(
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
        const actionPolicies = (
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

function getValidator(owners: OwnerSet) {
  switch (owners.type) {
    case 'ecdsa':
      return getOwnableValidator({
        threshold: owners.threshold ?? 1,
        owners: owners.accounts.map((account) => account.address),
      })
    case 'passkey':
      return getWebAuthnValidator({
        pubKey: owners.account.publicKey,
        authenticatorId: owners.account.id,
      })
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
          ['uint128', 'uint128'],
          [
            BigInt(policy.validUntil) / 1000n,
            BigInt(policy.validAfter) / 1000n,
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
  return Array.from({ length }, (_, i) => getValue(i)) as any
}

function getOwnableValidator({
  threshold,
  owners,
}: {
  threshold: number
  owners: Address[]
}): Module {
  return {
    address: OWNABLE_VALIDATOR_ADDRESS,
    initData: encodeAbiParameters(
      [
        { name: 'threshold', type: 'uint256' },
        { name: 'owners', type: 'address[]' },
      ],
      [
        BigInt(threshold),
        owners.map((owner) => owner.toLowerCase() as Address).sort(),
      ],
    ),
    deInitData: '0x',
    additionalContext: '0x',
    type: MODULE_TYPE_ID_VALIDATOR,
  }
}

function getWebAuthnValidator(webAuthnCredential: WebauthnCredential): Module {
  let pubKeyX: bigint
  let pubKeyY: bigint

  // Distinguish between PublicKey and Hex / byte encoded public key
  if (
    typeof webAuthnCredential.pubKey === 'string' ||
    webAuthnCredential.pubKey instanceof Uint8Array
  ) {
    // It's a P256Credential
    const { x, y, prefix } = parsePublicKey(webAuthnCredential.pubKey)
    pubKeyX = x
    pubKeyY = y
    if (prefix && prefix !== 4) {
      throw new Error('Only uncompressed public keys are supported')
    }
  } else {
    // It's already a PublicKey
    pubKeyX = webAuthnCredential.pubKey.x
    pubKeyY = webAuthnCredential.pubKey.y
  }

  return {
    address: WEBAUTHN_VALIDATOR_ADDRESS,
    initData: encodeAbiParameters(
      [
        {
          components: [
            {
              name: 'pubKeyX',
              type: 'uint256',
            },
            {
              name: 'pubKeyY',
              type: 'uint256',
            },
          ],
          type: 'tuple',
        },
        {
          type: 'bytes32',
          name: 'authenticatorIdHash',
        },
      ],
      [
        {
          pubKeyX,
          pubKeyY,
        },
        keccak256(toHex(webAuthnCredential.authenticatorId)),
      ],
    ),
    deInitData: '0x',
    additionalContext: '0x',
    type: MODULE_TYPE_ID_VALIDATOR,
  }
}

function parsePublicKey(publicKey: Hex | Uint8Array): PublicKey {
  const bytes =
    typeof publicKey === 'string' ? hexToBytes(publicKey) : publicKey
  const offset = bytes.length === 65 ? 1 : 0
  const x = bytes.slice(offset, 32 + offset)
  const y = bytes.slice(32 + offset, 64 + offset)
  return {
    prefix: bytes.length === 65 ? bytes[0] : undefined,
    x: BigInt(bytesToHex(x)),
    y: BigInt(bytesToHex(y)),
  }
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
) {
  switch (mode) {
    case SMART_SESSION_MODE_USE:
      return encodePacked(
        ['bytes1', 'bytes32', 'bytes'],
        [mode, permissionId, signature],
      )
    case SMART_SESSION_MODE_ENABLE:
    case SMART_SESSION_MODE_UNSAFE_ENABLE:
      throw new Error('Enable mode not implemented')
    default:
      throw new Error(`Unknown mode ${mode}`)
  }
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

function getMockSinature(ownerSet: OwnerSet): Hex {
  switch (ownerSet.type) {
    case 'ecdsa': {
      const owners = ownerSet.accounts.map((account) => account.address)
      const signatures = owners.map(() => ECDSA_MOCK_SIGNATURE as Hex)
      return concat(signatures)
    }
    case 'passkey':
      return WEBAUTHN_MOCK_SIGNATURE
  }
}

async function getAccountEIP712Domain(client: PublicClient, account: Address) {
  const data = await client.readContract({
    address: account,
    abi: [
      {
        type: 'function',
        name: 'eip712Domain',
        inputs: [],
        outputs: [
          {
            type: 'bytes1',
            name: 'fields,',
          },
          {
            type: 'string',
            name: 'name',
          },
          {
            type: 'string',
            name: 'version',
          },
          {
            type: 'uint256',
            name: 'chainId',
          },
          {
            type: 'address',
            name: 'verifyingContract',
          },
          {
            type: 'bytes32',
            name: 'salt',
          },
          {
            type: 'uint256[]',
            name: 'extensions',
          },
        ],
        stateMutability: 'view',
        constant: true,
      },
    ],
    functionName: 'eip712Domain',
    args: [],
  })
  return {
    name: data[1],
    version: data[2],
    chainId: data[3],
    verifyingContract: data[4],
    salt: data[5],
  }
}

export {
  SMART_SESSION_MODE_USE,
  SMART_SESSION_MODE_ENABLE,
  SMART_SESSIONS_VALIDATOR_ADDRESS,
  getOwnerValidator,
  getSmartSessionValidator,
  getEnableSessionCall,
  encodeSmartSessionSignature,
  getPermissionId,
  getMockSinature,
  getAccountEIP712Domain,
  isSessionEnabled,
  getSessionAllowedERC7739Content,
}
