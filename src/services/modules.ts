import {
  Address,
  bytesToHex,
  encodeAbiParameters,
  Hex,
  hexToBytes,
  keccak256,
  toHex,
  zeroAddress,
} from 'viem'

import { RhinestoneAccountConfig } from '../types'

type ModuleType = 'validator' | 'executor' | 'fallback' | 'hook'

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

const RHINESTONE_ATTESTER_ADDRESS: Address =
  '0x000000333034E9f539ce08819E12c1b8Cb29084d'
const OWNABLE_VALIDATOR_ADDRESS: Address =
  '0x2483DA3A338895199E5e538530213157e931Bf06'
const WEBAUTHN_VALIDATOR_ADDRESS: Address =
  '0x2f167e55d42584f65e2e30a748f41ee75a311414'

const NO_SAFE_OWNER_ADDRESS: Address =
  '0xbabe99e62d8bcbd3acf5ccbcfcd4f64fe75e5e72'

function toOwners(config: RhinestoneAccountConfig) {
  const ownerSet = config.owners
  switch (ownerSet.type) {
    case 'ecdsa':
      return ownerSet.accounts.map((account) => account.address)
    case 'passkey':
      return [NO_SAFE_OWNER_ADDRESS]
  }
}

function getValidator(config: RhinestoneAccountConfig) {
  const ownerSet = config.owners
  switch (ownerSet.type) {
    case 'ecdsa':
      return getOwnableValidator({
        threshold: ownerSet.threshold ?? ownerSet.accounts.length,
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
      [BigInt(threshold), owners.sort()],
    ),
    deInitData: '0x',
    additionalContext: '0x',
    type: 'validator',
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
    type: 'validator',
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

export { getValidator, toOwners, RHINESTONE_ATTESTER_ADDRESS }
