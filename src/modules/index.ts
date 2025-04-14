import {
  Address,
  bytesToHex,
  Chain,
  encodeAbiParameters,
  Hex,
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

import { RhinestoneAccountConfig } from '../types'
import {
  Module,
  MODULE_TYPE_ID_EXECUTOR,
  MODULE_TYPE_ID_FALLBACK,
} from './common'
import { getOwnerValidator } from './validators'

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

const OMNI_ACCOUNT_MOCK_ATTESTER_ADDRESS: Address =
  '0x6D0515e8E499468DCe9583626f0cA15b887f9d03'

const RHINESTONE_MODULE_REGISTRY_ADDRESS: Address =
  '0x000000000069e2a187aeffb852bf3ccdc95151b2'
const RHINESTONE_ATTESTER_ADDRESS: Address =
  '0x000000333034E9f539ce08819E12c1b8Cb29084d'

const HOOK_ADDRESS: Address = '0x0000000000f6Ed8Be424d673c63eeFF8b9267420'
const TARGET_MODULE_ADDRESS: Address =
  '0x0000000000E5a37279A001301A837a91b5de1D5E'
const SAME_CHAIN_MODULE_ADDRESS: Address =
  '0x000000000043ff16d5776c7F0f65Ec485C17Ca04'

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

  const validators: Module[] = [ownerValidator]

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

export function getWebauthnValidatorSignature({
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

export function isRip7212SupportedNetwork(chain: Chain) {
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

export { HOOK_ADDRESS, getSetup, getOwnerValidator }
