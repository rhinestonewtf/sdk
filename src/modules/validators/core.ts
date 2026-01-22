import {
  type Account,
  type Address,
  bytesToHex,
  concat,
  encodeAbiParameters,
  encodePacked,
  type Hex,
  hexToBytes,
  maxUint48,
  pad,
  toHex,
} from 'viem'

import { OwnersFieldRequiredError } from '../../accounts/error'
import type {
  ENSValidatorConfig,
  OwnableValidatorConfig,
  OwnerSet,
  RhinestoneAccountConfig,
  WebauthnValidatorConfig,
} from '../../types'

import { MODULE_TYPE_ID_VALIDATOR, type Module } from '../common'

const SMART_SESSION_EMISSARY_ADDRESS: Address =
  '0xad568b3f825a8d5ffc06dd3253526b64d810ae89'

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
  '0x000000000013fdb5234e4e3162a810f54d9f7e98'
const ENS_VALIDATOR_ADDRESS: Address =
  '0xdc38f07b060374b6480c4bf06231e7d10955bca4'
const WEBAUTHN_VALIDATOR_ADDRESS: Address =
  '0x0000000000578c4cb0e472a5462da43c495c3f33'
const SOCIAL_RECOVERY_VALIDATOR_ADDRESS: Address =
  '0xa04d053b3c8021e8d5bf641816c42daa75d8b597'
const MULTI_FACTOR_VALIDATOR_ADDRESS: Address =
  '0xf6bdf42c9be18ceca5c06c42a43daf7fbbe7896b'

// Legacy
const OWNABLE_V0_VALIDATOR_ADDRESS: Address =
  '0x2483da3a338895199e5e538530213157e931bf06'
const OWNABLE_BETA_VALIDATOR_ADDRESS: Address =
  '0x0000000000e9e6e96bcaa3c113187cdb7e38aed9'
const WEBAUTHN_V0_VALIDATOR_ADDRESS: Address =
  '0x0000000000578c4cb0e472a5462da43c495c3f33'

const ECDSA_MOCK_SIGNATURE =
  '0x81d4b4981670cb18f99f0b4a66446df1bf5b204d24cfcb659bf38ba27a4359b5711649ec2423c5e1247245eba2964679b6a1dbb85c992ae40b9b00c6935b02ff1b'
const WEBAUTHN_MOCK_SIGNATURE =
  '0x0000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000001b9b86eb98fda3ed4d797d9e690588dfadf17b329a76a47cec935bebf92d7ddc80000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000120000000000000000000000000000000000000000000000000000000000000001700000000000000000000000000000000000000000000000000000000000000019b2e9410bb6850f9f660a03d609d5a844fb96bcdc87a15139b03ee22c70f469100d2b865a215c3bf786387064effa8fcedcb1d625b5148f8a1236d5e3ff11acf000000000000000000000000000000000000000000000000000000000000002549960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d9763050000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000867b2274797065223a22776562617574686e2e676574222c226368616c6c656e6765223a22396a4546696a75684557724d34534f572d7443684a625545484550343456636a634a2d42716f3166544d38222c226f726967696e223a22687474703a2f2f6c6f63616c686f73743a38303830222c2263726f73734f726967696e223a66616c73657d0000000000000000000000000000000000000000000000000000'

function getOwnerValidator(config: RhinestoneAccountConfig) {
  if (!config.owners) {
    throw new OwnersFieldRequiredError()
  }
  return getValidator(config.owners)
}

function getMockSignature(ownerSet: OwnerSet): Hex {
  switch (ownerSet.type) {
    case 'ecdsa':
    case 'ens': {
      // ENS validator uses same mock signature format as ECDSA for UserOps
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
        owners.module,
      )
    case 'ens':
      return getENSValidator(
        owners.threshold ?? 1,
        owners.accounts.map((account) => account.address),
        owners.ownerExpirations,
        owners.module,
      )
    case 'passkey':
      return getWebAuthnValidator(
        owners.threshold ?? 1,
        owners.accounts.map((account) => ({
          pubKey: account.publicKey,
          authenticatorId: account.id,
        })),
      )
    case 'multi-factor': {
      return getMultiFactorValidator(owners.threshold ?? 1, owners.validators)
    }
  }
}

function getOwnableValidator(
  threshold: number,
  owners: Address[],
  address?: Address,
): Module {
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

function getENSValidator(
  threshold: number,
  owners: Address[],
  ownerExpirations: number[],
  address?: Address,
): Module {
  // format: (uint256 threshold, Owner[] owners)
  // where Owner is a tuple of (address addr, uint48 expiration)

  const ownerPairs = owners.map((owner, index) => ({
    addr: owner.toLowerCase() as Address,
    expiration: ownerExpirations[index] ?? maxUint48,
  }))

  // Sort by address to match ENS validator's expectations
  const sortedPairs = ownerPairs.sort((a, b) => a.addr.localeCompare(b.addr))

  const ownersWithExpiration = sortedPairs

  const initData = encodeAbiParameters(
    [
      { name: 'threshold', type: 'uint256' },
      {
        name: 'owners',
        type: 'tuple[]',
        components: [
          { name: 'addr', type: 'address' },
          { name: 'expiration', type: 'uint48' },
        ],
      },
    ],
    [BigInt(threshold), ownersWithExpiration],
  )

  const moduleAddress = address ?? ENS_VALIDATOR_ADDRESS

  return {
    address: moduleAddress,
    initData,
    deInitData: '0x',
    additionalContext: '0x',
    type: MODULE_TYPE_ID_VALIDATOR,
  }
}

function getWebAuthnValidator(
  threshold: number,
  webAuthnCredentials: WebauthnCredential[],
  address?: Address,
): Module {
  function getPublicKey(webAuthnCredential: WebauthnCredential): PublicKey {
    if (
      typeof webAuthnCredential.pubKey === 'string' ||
      webAuthnCredential.pubKey instanceof Uint8Array
    ) {
      // It's a P256Credential
      const { x, y, prefix } = parsePublicKey(webAuthnCredential.pubKey)
      if (prefix && prefix !== 4) {
        throw new Error('Only uncompressed public keys are supported')
      }
      return {
        x,
        y,
      }
    } else {
      // It's already a PublicKey
      return webAuthnCredential.pubKey
    }
  }

  const publicKeys = webAuthnCredentials.map(getPublicKey)

  return {
    address: address ?? WEBAUTHN_VALIDATOR_ADDRESS,
    initData: encodeAbiParameters(
      [
        { name: 'threshold', type: 'uint256' },
        {
          name: 'credentials',
          type: 'tuple[]',
          components: [
            {
              name: 'pubKeyX',
              type: 'uint256',
            },
            {
              name: 'pubKeyY',
              type: 'uint256',
            },
            {
              name: 'requireUV',
              type: 'bool',
            },
          ],
        },
      ],
      [
        BigInt(threshold),
        publicKeys.map((publicKey) => ({
          pubKeyX: publicKey.x,
          pubKeyY: publicKey.y,
          requireUV: false,
        })),
      ],
    ),
    deInitData: '0x',
    additionalContext: '0x',
    type: MODULE_TYPE_ID_VALIDATOR,
  }
}

function getSmartSessionValidator(): Module {
  return {
    address: SMART_SESSION_EMISSARY_ADDRESS,
    initData: '0x',
    deInitData: '0x',
    additionalContext: '0x',
    type: MODULE_TYPE_ID_VALIDATOR,
  }
}

function getMultiFactorValidator(
  threshold: number,
  validators: (
    | OwnableValidatorConfig
    | ENSValidatorConfig
    | WebauthnValidatorConfig
    | null
  )[],
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

function supportsEip712(validator: Module) {
  switch (validator.address.toLowerCase()) {
    case OWNABLE_BETA_VALIDATOR_ADDRESS: // Ownable Validator V1-beta
    case OWNABLE_V0_VALIDATOR_ADDRESS: // Ownable Validator V0
    case SMART_SESSION_EMISSARY_ADDRESS: // Smart Sessions (not yet supported)
      return false
    default:
      return true
  }
}

export {
  OWNABLE_VALIDATOR_ADDRESS,
  ENS_VALIDATOR_ADDRESS,
  WEBAUTHN_VALIDATOR_ADDRESS,
  MULTI_FACTOR_VALIDATOR_ADDRESS,
  WEBAUTHN_V0_VALIDATOR_ADDRESS,
  SMART_SESSION_EMISSARY_ADDRESS,
  getOwnerValidator,
  getOwnableValidator,
  getENSValidator,
  getWebAuthnValidator,
  getSmartSessionValidator,
  getMultiFactorValidator,
  getSocialRecoveryValidator,
  getValidator,
  getMockSignature,
  supportsEip712,
}
export type { WebauthnCredential }
