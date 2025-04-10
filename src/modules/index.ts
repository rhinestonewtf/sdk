import {
  Address,
  bytesToHex,
  Chain,
  encodeAbiParameters,
  Hex,
  hexToBytes,
  keccak256,
  toHex,
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

type ModuleType =
  | typeof MODULE_TYPE_ID_VALIDATOR
  | typeof MODULE_TYPE_ID_EXECUTOR
  | typeof MODULE_TYPE_ID_FALLBACK
  | typeof MODULE_TYPE_ID_HOOK

interface Module {
  address: Address
  initData: Hex
  deInitData: Hex
  additionalContext: Hex
  type: ModuleType
}

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

const MODULE_TYPE_ID_VALIDATOR = 1n
const MODULE_TYPE_ID_EXECUTOR = 2n
const MODULE_TYPE_ID_FALLBACK = 3n
const MODULE_TYPE_ID_HOOK = 4n

const OMNI_ACCOUNT_MOCK_ATTESTER_ADDRESS: Address =
  '0x6D0515e8E499468DCe9583626f0cA15b887f9d03'

const RHINESTONE_MODULE_REGISTRY_ADDRESS: Address =
  '0x000000000069e2a187aeffb852bf3ccdc95151b2'
const RHINESTONE_ATTESTER_ADDRESS: Address =
  '0x000000333034E9f539ce08819E12c1b8Cb29084d'
const OWNABLE_VALIDATOR_ADDRESS: Address =
  '0x2483DA3A338895199E5e538530213157e931Bf06'
const WEBAUTHN_VALIDATOR_ADDRESS: Address =
  '0x2f167e55d42584f65e2e30a748f41ee75a311414'

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
  const validator = getValidator(config)

  const validators: Module[] = [
    {
      address: validator.address,
      initData: validator.initData,
      deInitData: '0x',
      additionalContext: '0x',
      type: MODULE_TYPE_ID_VALIDATOR,
    },
  ]

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

function getValidator(config: RhinestoneAccountConfig) {
  const ownerSet = config.owners
  switch (ownerSet.type) {
    case 'ecdsa':
      return getOwnableValidator({
        threshold: ownerSet.threshold ?? 1,
        owners: ownerSet.accounts.map((account) => account.address),
      })
    case 'passkey':
      return getWebAuthnValidator({
        pubKey: ownerSet.account.publicKey,
        authenticatorId: ownerSet.account.id,
      })
  }
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

export { HOOK_ADDRESS, getSetup, getValidator }
