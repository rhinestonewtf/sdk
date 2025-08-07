import {
  type Account,
  type Address,
  bytesToHex,
  concat,
  encodeAbiParameters,
  encodePacked,
  type Hex,
  hexToBytes,
  keccak256,
  pad,
  toHex,
} from 'viem'

import type {
  OwnableValidatorConfig,
  OwnerSet,
  RhinestoneAccountConfig,
  WebauthnValidatorConfig,
} from '../../types'

import { MODULE_TYPE_ID_VALIDATOR, type Module } from '../common'

interface PublicKey {
  prefix?: number | undefined
  x: bigint
  y: bigint
}

interface WebauthnCredential {
  pubKey: PublicKey | Hex | Uint8Array
  authenticatorId: string
}

const OWNABLE_VALIDATOR_ADDRESS: Address =
  '0x0000000000E9E6E96Bcaa3c113187CdB7E38AED9'
const WEBAUTHN_VALIDATOR_ADDRESS: Address =
  '0x0000000000578c4cB0e472a5462da43C495C3F33'
const SOCIAL_RECOVERY_VALIDATOR_ADDRESS: Address =
  '0xA04D053b3C8021e8D5bF641816c42dAA75D8b597'
const MULTI_FACTOR_VALIDATOR_ADDRESS: Address =
  '0xf6bDf42c9BE18cEcA5C06c42A43DAf7FBbe7896b'

const OWNABLE_V0_VALIDATOR_ADDRESS: Address =
  '0x2483DA3A338895199E5e538530213157e931Bf06'

const ECDSA_MOCK_SIGNATURE =
  '0x81d4b4981670cb18f99f0b4a66446df1bf5b204d24cfcb659bf38ba27a4359b5711649ec2423c5e1247245eba2964679b6a1dbb85c992ae40b9b00c6935b02ff1b'
const WEBAUTHN_MOCK_SIGNATURE =
  '0x00000000000000000000000000000000000000000000000000000000000000c000000000000000000000000000000000000000000000000000000000000001200000000000000000000000000000000000000000000000000000000000000001635bc6d0f68ff895cae8a288ecf7542a6a9cd555df784b73e1e2ea7e9104b1db15e9015d280cb19527881c625fee43fd3a405d5b0d199a8c8e6589a7381209e40000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002549960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d97631d0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f47b2274797065223a22776562617574686e2e676574222c226368616c6c656e6765223a22746278584e465339585f3442797231634d77714b724947422d5f3330613051685a36793775634d30424f45222c226f726967696e223a22687474703a2f2f6c6f63616c686f73743a33303030222c2263726f73734f726967696e223a66616c73652c20226f746865725f6b6579735f63616e5f62655f61646465645f68657265223a22646f206e6f7420636f6d7061726520636c69656e74446174614a534f4e20616761696e737420612074656d706c6174652e205365652068747470733a2f2f676f6f2e676c2f796162506578227d000000000000000000000000'

function getOwnerValidator(config: RhinestoneAccountConfig) {
  return getValidator(config.owners)
}

function getMockSignature(ownerSet: OwnerSet): Hex {
  switch (ownerSet.type) {
    case 'ecdsa':
    case 'ecdsa-v0': {
      const owners = ownerSet.accounts.map((account) => account.address)
      const signatures = owners.map(() => ECDSA_MOCK_SIGNATURE as Hex)
      return concat(signatures)
    }
    case 'passkey':
      return WEBAUTHN_MOCK_SIGNATURE
    case 'multi-factor': {
      const mockValidators: {
        packedValidatorAndId: Hex
        data: Hex
      }[] = ownerSet.validators.map((validator, index) => {
        const validatorModule = getValidator(validator)
        const signature = getMockSignature(validator)
        return {
          packedValidatorAndId: encodePacked(
            ['bytes12', 'address'],
            [
              pad(toHex(index), {
                size: 12,
              }),
              validatorModule.address,
            ],
          ),
          data: signature,
        }
      })

      return encodeAbiParameters(
        [
          {
            components: [
              {
                internalType: 'bytes32',
                name: 'packedValidatorAndId',
                type: 'bytes32',
              },
              { internalType: 'bytes', name: 'data', type: 'bytes' },
            ],
            name: 'validators',
            type: 'tuple[]',
          },
        ],
        [mockValidators],
      )
    }
  }
}

function getValidator(owners: OwnerSet) {
  switch (owners.type) {
    case 'ecdsa':
      return getOwnableValidator(
        owners.threshold ?? 1,
        owners.accounts.map((account) => account.address),
      )
    case 'ecdsa-v0':
      return getOwnableValidator(
        owners.threshold ?? 1,
        owners.accounts.map((account) => account.address),
        OWNABLE_V0_VALIDATOR_ADDRESS,
      )
    case 'passkey':
      return getWebAuthnValidator({
        pubKey: owners.account.publicKey,
        authenticatorId: owners.account.id,
      })
    case 'multi-factor': {
      return getMultiFactorValidator(owners.threshold ?? 1, owners.validators)
    }
  }
}

function getOwnableValidator(threshold: number, owners: Address[], address?: Address): Module {
  return {
    address: address ?? OWNABLE_VALIDATOR_ADDRESS,
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

function getMultiFactorValidator(
  threshold: number,
  validators: (OwnableValidatorConfig | WebauthnValidatorConfig | null)[],
): Module {
  return {
    address: MULTI_FACTOR_VALIDATOR_ADDRESS,
    initData: encodePacked(
      ['uint8', 'bytes'],
      [
        threshold,
        encodeAbiParameters(
          [
            {
              components: [
                {
                  internalType: 'bytes32',
                  name: 'packedValidatorAndId',
                  type: 'bytes32',
                },
                { internalType: 'bytes', name: 'data', type: 'bytes' },
              ],
              name: 'validators',
              type: 'tuple[]',
            },
          ],
          [
            validators
              .map((validator, index) => {
                if (validator === null) {
                  return null
                }
                const validatorModule = getValidator(validator)
                return {
                  packedValidatorAndId: concat([
                    pad(toHex(index), {
                      size: 12,
                    }),
                    validatorModule.address,
                  ]),
                  data: validatorModule.initData,
                }
              })
              .filter((validator) => validator !== null),
          ],
        ),
      ],
    ),
    deInitData: '0x',
    additionalContext: '0x',
    type: MODULE_TYPE_ID_VALIDATOR,
  }
}

function getSocialRecoveryValidator(
  guardians: Account[],
  threshold = 1,
): Module {
  const guardianAddresses = guardians.map((guardian) => guardian.address)
  guardianAddresses.sort()
  return {
    type: MODULE_TYPE_ID_VALIDATOR,
    address: SOCIAL_RECOVERY_VALIDATOR_ADDRESS,
    initData: encodeAbiParameters(
      [
        {
          type: 'uint256',
          name: 'threshold',
        },
        {
          type: 'address[]',
          name: 'guardians',
        },
      ],
      [BigInt(threshold), guardianAddresses],
    ),
    deInitData: '0x',
    additionalContext: '0x',
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
  OWNABLE_VALIDATOR_ADDRESS,
  WEBAUTHN_VALIDATOR_ADDRESS,
  MULTI_FACTOR_VALIDATOR_ADDRESS,
  OWNABLE_V0_VALIDATOR_ADDRESS,
  getOwnerValidator,
  getOwnableValidator,
  getWebAuthnValidator,
  getMultiFactorValidator,
  getSocialRecoveryValidator,
  getValidator,
  getMockSignature,
}
export type { WebauthnCredential }
