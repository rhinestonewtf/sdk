import {
  type Address,
  bytesToHex,
  type Chain,
  encodeAbiParameters,
  type Hex,
  hexToBytes,
} from 'viem'
import {
  arbitrum,
  arbitrumSepolia,
  base,
  baseSepolia,
  optimism,
  optimismSepolia,
  polygon,
  polygonAmoy,
} from 'viem/chains'

import type { RhinestoneAccountConfig } from '../types'

import {
  MODULE_TYPE_ID_EXECUTOR,
  MODULE_TYPE_ID_FALLBACK,
  type Module,
} from './common'
import {
  HOOK_ADDRESS,
  OMNI_ACCOUNT_MOCK_ATTESTER_ADDRESS,
  RHINESTONE_ATTESTER_ADDRESS,
  RHINESTONE_MODULE_REGISTRY_ADDRESS,
  SAME_CHAIN_MODULE_ADDRESS,
  TARGET_MODULE_ADDRESS,
} from './omni-account'
import { getTrustAttesterCall, getTrustedAttesters } from './registry'
import { getOwnerValidator, getSmartSessionValidator } from './validators'
import { getSocialRecoveryValidator } from './validators/core'

const SMART_SESSION_COMPATIBILITY_FALLBACK_ADDRESS: Address =
  '0x12cae64c42f362e7d5a847c2d33388373f629177'

interface WebAuthnData {
  authenticatorData: Hex
  clientDataJSON: string
  typeIndex: number | bigint
}

interface WebauthnValidatorSignature {
  webauthn: WebAuthnData
  signature: WebauthnSignature | Hex | Uint8Array
  usePrecompiled?: boolean
}

interface WebauthnSignature {
  r: bigint
  s: bigint
}

interface ModeleSetup {
  validators: Module[]
  executors: Module[]
  fallbacks: Module[]
  hooks: Module[]
  registry: Address
  attesters: Address[]
  threshold: number
}

function getSetup(config: RhinestoneAccountConfig): ModeleSetup {
  const ownerValidator = getOwnerValidator(config)
  const smartSessionValidator = getSmartSessionValidator(config)

  const validators: Module[] = [ownerValidator]
  if (smartSessionValidator) {
    validators.push(smartSessionValidator)
  }
  if (config.recovery) {
    const socialRecoveryValidator = getSocialRecoveryValidator(
      config.recovery.guardians,
      config.recovery.threshold,
    )
    validators.push(socialRecoveryValidator)
  }

  const executors: Module[] = [
    {
      address: SAME_CHAIN_MODULE_ADDRESS,
      initData: '0x',
      deInitData: '0x',
      additionalContext: '0x',
      type: MODULE_TYPE_ID_EXECUTOR,
    },
    {
      address: TARGET_MODULE_ADDRESS,
      initData: '0x',
      deInitData: '0x',
      additionalContext: '0x',
      type: MODULE_TYPE_ID_EXECUTOR,
    },
    {
      address: HOOK_ADDRESS,
      initData: '0x',
      deInitData: '0x',
      additionalContext: '0x',
      type: MODULE_TYPE_ID_EXECUTOR,
    },
  ]

  const fallbacks: Module[] = [
    {
      address: TARGET_MODULE_ADDRESS,
      initData: encodeAbiParameters(
        [
          { name: 'selector', type: 'bytes4' },
          { name: 'flags', type: 'bytes1' },
          { name: 'data', type: 'bytes' },
        ],
        ['0x3a5be8cb', '0x00', '0x'],
      ),
      deInitData: '0x',
      additionalContext: '0x',
      type: MODULE_TYPE_ID_FALLBACK,
    },
  ]

  // Some accounts (e.g. Safe) need a fallback method to support smart sessions
  if (config.sessions) {
    if (config.account && config.account.type === 'safe') {
      fallbacks.push({
        address: SMART_SESSION_COMPATIBILITY_FALLBACK_ADDRESS,
        initData: encodeAbiParameters(
          [
            { name: 'selector', type: 'bytes4' },
            { name: 'flags', type: 'bytes1' },
            { name: 'data', type: 'bytes' },
          ],
          ['0x84b0196e', '0xfe', '0x'],
        ),
        deInitData: '0x',
        additionalContext: '0x',
        type: MODULE_TYPE_ID_FALLBACK,
      })
    }
  }

  const hooks: Module[] = []

  return {
    validators,
    executors,
    fallbacks,
    hooks,
    registry: RHINESTONE_MODULE_REGISTRY_ADDRESS,
    attesters: [
      RHINESTONE_ATTESTER_ADDRESS,
      OMNI_ACCOUNT_MOCK_ATTESTER_ADDRESS,
    ],
    threshold: 1,
  }
}

function getWebauthnValidatorSignature({
  webauthn,
  signature,
  usePrecompiled = false,
}: WebauthnValidatorSignature) {
  const { authenticatorData, clientDataJSON, typeIndex } = webauthn
  let r: bigint
  let s: bigint
  if (typeof signature === 'string' || signature instanceof Uint8Array) {
    const parsedSignature = parseSignature(signature)
    r = parsedSignature.r
    s = parsedSignature.s
  } else {
    r = signature.r
    s = signature.s
  }
  return encodeAbiParameters(
    [
      { type: 'bytes', name: 'authenticatorData' },
      {
        type: 'string',
        name: 'clientDataJSON',
      },
      {
        type: 'uint256',
        name: 'responseTypeLocation',
      },
      {
        type: 'uint256',
        name: 'r',
      },
      {
        type: 'uint256',
        name: 's',
      },
      {
        type: 'bool',
        name: 'usePrecompiled',
      },
    ],
    [
      authenticatorData,
      clientDataJSON,
      typeof typeIndex === 'bigint' ? typeIndex : BigInt(typeIndex),
      r,
      s,
      usePrecompiled,
    ],
  )
}

function isRip7212SupportedNetwork(chain: Chain) {
  const supportedChains: Chain[] = [
    optimism,
    optimismSepolia,
    polygon,
    polygonAmoy,
    base,
    baseSepolia,
    arbitrum,
    arbitrumSepolia,
  ]

  return supportedChains.includes(chain)
}

function parseSignature(signature: Hex | Uint8Array): WebauthnSignature {
  const bytes =
    typeof signature === 'string' ? hexToBytes(signature) : signature
  const r = bytes.slice(0, 32)
  const s = bytes.slice(32, 64)
  return {
    r: BigInt(bytesToHex(r)),
    s: BigInt(bytesToHex(s)),
  }
}

export {
  HOOK_ADDRESS,
  getSetup,
  getTrustAttesterCall,
  getTrustedAttesters,
  getOwnerValidator,
  getWebauthnValidatorSignature,
  isRip7212SupportedNetwork,
}
