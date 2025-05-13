import {
  type Address,
  bytesToHex,
  concat,
  encodeAbiParameters,
  type Hex,
  hexToBytes,
  keccak256,
  toHex,
} from 'viem'

import type { OwnerSet, RhinestoneAccountConfig } from '../../types'

import { MODULE_TYPE_ID_VALIDATOR, type Module } from '../common'

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

const OWNABLE_VALIDATOR_ADDRESS: Address =
  '0x2483DA3A338895199E5e538530213157e931Bf06'
const WEBAUTHN_VALIDATOR_ADDRESS: Address =
  '0x2f167e55d42584f65e2e30a748f41ee75a311414'

const ECDSA_MOCK_SIGNATURE =
  '0x81d4b4981670cb18f99f0b4a66446df1bf5b204d24cfcb659bf38ba27a4359b5711649ec2423c5e1247245eba2964679b6a1dbb85c992ae40b9b00c6935b02ff1b'
const WEBAUTHN_MOCK_SIGNATURE =
  '0x00000000000000000000000000000000000000000000000000000000000000c000000000000000000000000000000000000000000000000000000000000001200000000000000000000000000000000000000000000000000000000000000001635bc6d0f68ff895cae8a288ecf7542a6a9cd555df784b73e1e2ea7e9104b1db15e9015d280cb19527881c625fee43fd3a405d5b0d199a8c8e6589a7381209e40000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002549960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d97631d0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f47b2274797065223a22776562617574686e2e676574222c226368616c6c656e6765223a22746278584e465339585f3442797231634d77714b724947422d5f3330613051685a36793775634d30424f45222c226f726967696e223a22687474703a2f2f6c6f63616c686f73743a33303030222c2263726f73734f726967696e223a66616c73652c20226f746865725f6b6579735f63616e5f62655f61646465645f68657265223a22646f206e6f7420636f6d7061726520636c69656e74446174614a534f4e20616761696e737420612074656d706c6174652e205365652068747470733a2f2f676f6f2e676c2f796162506578227d000000000000000000000000'

function getOwnerValidator(config: RhinestoneAccountConfig) {
  return getValidator(config.owners)
}

function getMockSignature(ownerSet: OwnerSet): Hex {
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

export {
  getOwnerValidator,
  getValidator,
  getOwnableValidator,
  getWebAuthnValidator,
  getMockSignature,
}
