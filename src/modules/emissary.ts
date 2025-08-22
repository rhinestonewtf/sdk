import {
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  keccak256,
  padHex,
  toHex,
  parseAbi,
  type Address,
  type Hex,
} from 'viem'
import { SMART_SESSION_EMISSARY_ADDRESS } from './validators/smart-sessions'
import type { EnableSessionData } from './validators/smart-sessions'

// CONFIG_TYPEHASH for EmissaryBase.hashConfig (from contracts)
const EMISSARY_BASE_CONFIG_TYPEHASH: Hex =
  '0x759a5fad79c46388b685ecbde4a995628d8ce7988bf4f85bbcac3dec1ed19ba2'

// Separate ABIs (avoid overloading issues)
const emissaryBaseAbi = parseAbi([
  'function setConfig(address account,(uint8,address,uint8,uint8,address,bytes),(bytes,bytes,uint256,uint256[],uint256))',
])

const smartSessionEmissaryAbi = [
  {
    type: 'function',
    name: 'setConfig',
    inputs: [
      { type: 'address', name: 'account' },
      {
        type: 'tuple',
        name: 'config',
        components: [
          { type: 'address', name: 'sender' },
          { type: 'uint8', name: 'scope' },
          { type: 'uint8', name: 'resetPeriod' },
          { type: 'address', name: 'allocator' },
          { type: 'bytes32', name: 'permissionId' },
        ],
      },
      {
        type: 'tuple',
        name: 'enableData',
        components: [
          { type: 'bytes', name: 'allocatorSig' },
          { type: 'bytes', name: 'userSig' },
          { type: 'uint256', name: 'expires' },
          {
            type: 'tuple',
            name: 'session',
            components: [
              { type: 'uint8', name: 'chainDigestIndex' },
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
                name: 'sessionToEnable',
                components: [
                  { type: 'address', name: 'sessionValidator' },
                  { type: 'bytes', name: 'sessionValidatorInitData' },
                  { type: 'bytes32', name: 'salt' },
                  {
                    type: 'tuple[]',
                    name: 'userOpPolicies',
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
                          { type: 'bytes32', name: 'appDomainSeparator' },
                          { type: 'string[]', name: 'contentName' },
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
                  { type: 'bool', name: 'permitERC4337Paymaster' },
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

// ----------------------
// Types
// ----------------------

interface EmissaryBaseConfigInput {
  configId: number
  allocator: Address
  scope: number // Scope enum (uint8)
  resetPeriod: number // ResetPeriod enum (uint8)
  validator: Address // IStatelessValidator
  validatorConfig: Hex
}

interface EmissaryBaseEnableInput {
  allocatorSig: Hex
  userSig: Hex
  expires: bigint
  allChainIds: bigint[]
  chainIndex: bigint
}

// ECDSA validator config helper
interface EcdsaOwnersConfig {
  threshold: bigint
  owners: Address[]
}

// Passkey validator config helper
interface WebAuthnCredentialInput {
  pubKeyX: bigint
  pubKeyY: bigint
  requireUV: boolean
  credentialId: Hex // bytes32
}

interface PasskeyConfigInput {
  usePrecompile: boolean
  threshold: bigint
  credentials: WebAuthnCredentialInput[]
}

// ----------------------
// Helpers
// ----------------------

function encodeEcdsaValidatorConfig(config: EcdsaOwnersConfig): Hex {
  return encodeAbiParameters(
    [
      { type: 'uint256', name: 'threshold' },
      { type: 'address[]', name: 'owners' },
    ],
    [config.threshold, config.owners],
  )
}

function encodePasskeyValidatorConfig(config: PasskeyConfigInput): Hex {
  const credentialIds = config.credentials.map((c) => c.credentialId)
  const credentialData = config.credentials.map((c) => ({
    pubKeyX: c.pubKeyX,
    pubKeyY: c.pubKeyY,
    requireUV: c.requireUV,
  }))
  return encodeAbiParameters(
    [
      // WebAuthVerificationContext
      {
        type: 'tuple',
        components: [
          { type: 'bool', name: 'usePrecompile' },
          { type: 'uint256', name: 'threshold' },
          { type: 'bytes32[]', name: 'credentialIds' },
          {
            type: 'tuple[]',
            name: 'credentialData',
            components: [
              { type: 'uint256', name: 'pubKeyX' },
              { type: 'uint256', name: 'pubKeyY' },
              { type: 'bool', name: 'requireUV' },
            ],
          },
        ],
      },
    ],
    [
      {
        usePrecompile: config.usePrecompile,
        threshold: config.threshold,
        credentialIds,
        credentialData,
      },
    ],
  )
}

// chainIds keccak256(abi.encodePacked(chainIds)) helper
function hashChainIdsPacked(chainIds: bigint[]): Hex {
  const packed = ('0x' + chainIds.map((id) => padHex(toHex(id), { size: 32 }).slice(2)).join('')) as Hex
  return keccak256(packed)
}

// Matches HashLibV2.hashConfig in contracts
function computeEmissaryBaseConfigDigest(params: {
  sponsor: Address
  validator: Address
  configId: number
  lockTag: Hex // bytes12
  expires: bigint
  nonce: bigint
  validatorConfig: Hex
  chainIds: bigint[]
}): Hex {
  const structHash = keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' }, // CONFIG_TYPEHASH
        { type: 'address' }, // sponsor
        { type: 'address' }, // validator
        { type: 'uint8' }, // configId
        { type: 'bytes12' }, // lockTag
        { type: 'uint256' }, // expires
        { type: 'bytes32' }, // keccak256(validatorConfig)
        { type: 'uint256' }, // nonce
        { type: 'bytes32' }, // keccak256(abi.encodePacked(chainIds))
      ],
      [
        EMISSARY_BASE_CONFIG_TYPEHASH,
        params.sponsor,
        params.validator,
        params.configId,
        params.lockTag,
        params.expires,
        keccak256(params.validatorConfig),
        params.nonce,
        hashChainIdsPacked(params.chainIds),
      ],
    ),
  )
  return structHash
}

function getEmissaryBaseSetConfigCall(
  account: Address,
  config: EmissaryBaseConfigInput,
  enable: EmissaryBaseEnableInput,
  emissary: Address = SMART_SESSION_EMISSARY_ADDRESS,
) {
  const data = encodeFunctionData({
    abi: emissaryBaseAbi,
    functionName: 'setConfig',
    args: [
      account,
      [
        config.configId,
        config.allocator,
        config.scope,
        config.resetPeriod,
        config.validator,
        config.validatorConfig,
      ],
      [
        enable.allocatorSig,
        enable.userSig,
        enable.expires,
        enable.allChainIds,
        enable.chainIndex,
      ],
    ],
  })
  return { to: emissary as Address, data }
}

export {
  EMISSARY_BASE_CONFIG_TYPEHASH,
  computeEmissaryBaseConfigDigest,
  encodeEcdsaValidatorConfig,
  encodePasskeyValidatorConfig,
  getEmissaryBaseSetConfigCall,
}
export type {
  EmissaryBaseConfigInput,
  EmissaryBaseEnableInput,
  EcdsaOwnersConfig,
  PasskeyConfigInput,
  WebAuthnCredentialInput,
}

// ----------------------
// SmartSessionEmissary.setConfig
// ----------------------

interface SmartSessionEmissaryConfigInput {
  sender: Address
  scope: number // uint8
  resetPeriod: number // uint8
  allocator: Address
  permissionId: Hex
}

interface SmartSessionEmissaryEnableInput {
  allocatorSig: Hex
  userSig: Hex
  expires: bigint
  session: EnableSessionData
}

function getSmartSessionEmissarySetConfigCall(
  account: Address,
  config: SmartSessionEmissaryConfigInput,
  enable: SmartSessionEmissaryEnableInput,
  emissary: Address = SMART_SESSION_EMISSARY_ADDRESS,
) {
  const data = encodeFunctionData({
    abi: smartSessionEmissaryAbi,
    functionName: 'setConfig',
    args: [
      account,
      {
        sender: config.sender,
        scope: config.scope,
        resetPeriod: config.resetPeriod,
        allocator: config.allocator,
        permissionId: config.permissionId,
      },
      {
        allocatorSig: enable.allocatorSig,
        userSig: enable.userSig,
        expires: enable.expires,
        session: {
          chainDigestIndex: enable.session.chainDigestIndex,
          hashesAndChainIds: enable.session.hashesAndChainIds.map((d) => ({
            chainId: d.chainId,
            sessionDigest: d.sessionDigest,
          })),
          sessionToEnable: {
            sessionValidator: enable.session.sessionToEnable.sessionValidator,
            sessionValidatorInitData:
              enable.session.sessionToEnable.sessionValidatorInitData,
            salt: enable.session.sessionToEnable.salt,
            userOpPolicies: enable.session.sessionToEnable.userOpPolicies.map(
              (p) => ({ policy: p.policy, initData: p.initData }),
            ),
            erc7739Policies: {
              allowedERC7739Content:
                enable.session.sessionToEnable.erc7739Policies.allowedERC7739Content.map(
                  (c) => ({
                    appDomainSeparator: c.appDomainSeparator,
                    contentName: c.contentName,
                  }),
                ),
              erc1271Policies:
                enable.session.sessionToEnable.erc7739Policies.erc1271Policies.map(
                  (p) => ({ policy: p.policy, initData: p.initData }),
                ),
            },
            actions: enable.session.sessionToEnable.actions.map((a) => ({
              actionTargetSelector: a.actionTargetSelector,
              actionTarget: a.actionTarget,
              actionPolicies: a.actionPolicies.map((p) => ({
                policy: p.policy,
                initData: p.initData,
              })),
            })),
            permitERC4337Paymaster:
              enable.session.sessionToEnable.permitERC4337Paymaster,
          },
        },
      },
    ],
  })
  return { to: emissary as Address, data }
}

export type {
  SmartSessionEmissaryConfigInput,
  SmartSessionEmissaryEnableInput,
}

export { getSmartSessionEmissarySetConfigCall }
