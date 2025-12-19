import {
  type Address,
  createPublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  type Hex,
  hashStruct,
  http,
  keccak256,
  maxUint256,
  padHex,
  type TypedDataDefinition,
  zeroAddress,
  zeroHash,
} from 'viem'
import type { RhinestoneAccountConfig, Session } from '../../types'
import smartSessionEmissaryAbi from '../abi/smart-session-emissary'
import { MODULE_TYPE_ID_VALIDATOR, type Module } from '../common'
import { getValidator } from './core'

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

const SMART_SESSION_EMISSARY_ADDRESS: Address =
  '0x4411abbbede0215626284d0385dd55b4303012b7'

const SMART_SESSION_MODE_USE = '0x00'
const SMART_SESSION_MODE_ENABLE = '0x01'
const SMART_SESSION_MODE_UNSAFE_ENABLE = '0x02'
const SUDO_POLICY_ADDRESS: Address =
  '0x0000003111cD8e92337C100F22B7A9dbf8DEE301'
const SMART_SESSIONS_FALLBACK_TARGET_FLAG: Address =
  '0x0000000000000000000000000000000000000001'
const SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG: Hex = '0x00000001'
const SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG_PERMITTED_TO_CALL_SMARTSESSION: Hex =
  '0x00000002'

const SCOPE_MULTICHAIN = 0
const RESET_PERIOD_ONE_WEEK = 6

async function experimental_getSessionDetails(
  account: Address,
  session: Session,
) {
  const lockTag = padHex('0x', { size: 12 })
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
  const sessionNonces = [nonce]
  const sessionData = getSessionData(session)
  const sessionDatas = [sessionData]
  const signedSessions = sessionDatas.map((session, index) => ({
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
    nonce: sessionNonces[index],
  }))
  const chains = [session.chain]
  const chainDigests = signedSessions.map((session, index) => ({
    chainId: BigInt(chains[index].id),
    sessionDigest: hashStruct({
      types: types,
      primaryType: 'SignedSession',
      data: session,
    }),
  }))
  const hashesAndChainIds = chainDigests.map((chainDigest) => ({
    chainId: BigInt(chainDigest.chainId),
    sessionDigest: chainDigest.sessionDigest,
  }))

  const typedData: TypedDataDefinition<typeof types, 'MultiChainSession'> = {
    domain: {
      name: 'SmartSessionEmissary',
      version: '1.0.0',
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
    typedData,
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
            chainDigestIndex: 0,
            hashesAndChainIds,
            sessionToEnable: sessionData,
          },
        },
      ],
    }),
  }
}

function getSessionData(session: Session) {
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
  return {
    sessionValidator: validator.address,
    salt: zeroHash,
    sessionValidatorInitData: validator.initData,
    erc7739Policies: erc7739Data,
    actions: [] as ActionData[],
    claimPolicies: [] as PolicyData[],
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

export {
  SMART_SESSION_EMISSARY_ADDRESS,
  SMART_SESSIONS_FALLBACK_TARGET_FLAG,
  SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG,
  SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG_PERMITTED_TO_CALL_SMARTSESSION,
  getSessionData,
  getEnableSessionCall,
  getPermissionId,
  getSmartSessionValidator,
  experimental_getSessionDetails,
}
export type {
  EnableSessionData,
  ChainSession,
  ChainDigest,
  SessionData,
  SmartSessionModeType,
}
