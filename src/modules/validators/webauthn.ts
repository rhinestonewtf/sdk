import {
  type Address,
  bytesToHex,
  encodeAbiParameters,
  type Hex,
  hexToBytes,
  keccak256,
} from 'viem'
import type { ResolvedModule } from '../types'
import type { AtomicValidatorDefinition } from './types'

export const WEBAUTHN_VALIDATOR_ADDRESS: Address =
  '0x0000000000578c4cb0e472a5462da43c495c3f33'
export const WEBAUTHN_V0_VALIDATOR_ADDRESS = WEBAUTHN_VALIDATOR_ADDRESS

export const WEBAUTHN_MOCK_SIGNATURE =
  '0x0000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000001b9b86eb98fda3ed4d797d9e690588dfadf17b329a76a47cec935bebf92d7ddc80000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000120000000000000000000000000000000000000000000000000000000000000001700000000000000000000000000000000000000000000000000000000000000019b2e9410bb6850f9f660a03d609d5a844fb96bcdc87a15139b03ee22c70f469100d2b865a215c3bf786387064effa8fcedcb1d625b5148f8a1236d5e3ff11acf000000000000000000000000000000000000000000000000000000000000002549960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d9763050000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000867b2274797065223a22776562617574686e2e676574222c226368616c6c656e6765223a22396a4546696a75684557724d34534f572d7443684a625545484550343456636a634a2d42716f3166544d38222c226f726967696e223a22687474703a2f2f6c6f63616c686f73743a38303830222c2263726f73734f726967696e223a66616c73657d0000000000000000000000000000000000000000000000000000' as const

export interface PublicKey {
  prefix?: number | undefined
  x: bigint
  y: bigint
}

export interface WebauthnCredential {
  pubKey: PublicKey | Hex | Uint8Array
  authenticatorId: string
}

export interface WebAuthnSignature {
  authenticatorData: Hex
  clientDataJSON: string
  challengeIndex: bigint
  typeIndex: bigint
  r: bigint
  s: bigint
}

export function parseWebauthnPublicKey(publicKey: Hex | Uint8Array): PublicKey {
  const bytes =
    typeof publicKey === 'string' ? hexToBytes(publicKey) : publicKey
  const offset = bytes.length === 65 ? 1 : 0
  const prefix = offset === 1 ? bytes[0] : undefined
  return {
    ...(prefix === undefined ? {} : { prefix }),
    x: BigInt(bytesToHex(bytes.slice(offset, 32 + offset))),
    y: BigInt(bytesToHex(bytes.slice(32 + offset, 64 + offset))),
  }
}

export function parseWebauthnSignature(signature: Hex | Uint8Array): {
  readonly r: bigint
  readonly s: bigint
} {
  const bytes =
    typeof signature === 'string' ? hexToBytes(signature) : signature
  return {
    r: BigInt(bytesToHex(bytes.slice(0, 32))),
    s: BigInt(bytesToHex(bytes.slice(32, 64))),
  }
}

export function generateWebauthnCredentialId(
  pubKeyX: bigint,
  pubKeyY: bigint,
  account: Address,
): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'uint256' }, { type: 'address' }],
      [pubKeyX, pubKeyY, account],
    ),
  )
}

export function encodeWebauthnSignatures(
  credentialIds: readonly Hex[],
  usePrecompile: boolean,
  signatures: readonly WebAuthnSignature[],
): Hex {
  const ordered = credentialIds
    .map((credentialId, index) => ({
      credentialId,
      signature: signatures[index],
    }))
    .sort((left, right) => left.credentialId.localeCompare(right.credentialId))
  return encodeAbiParameters(
    [
      { type: 'bytes32[]', name: 'credIds' },
      { type: 'bool', name: 'usePrecompile' },
      {
        type: 'tuple[]',
        name: 'webAuthns',
        components: [
          { type: 'bytes', name: 'authenticatorData' },
          { type: 'string', name: 'clientDataJSON' },
          { type: 'uint256', name: 'challengeIndex' },
          { type: 'uint256', name: 'typeIndex' },
          { type: 'uint256', name: 'r' },
          { type: 'uint256', name: 's' },
        ],
      },
    ],
    [
      ordered.map(({ credentialId }) => credentialId),
      usePrecompile,
      ordered.map(({ signature }) => signature),
    ],
  )
}

export function encodeWebauthnSignatureV0(
  signature: Omit<WebAuthnSignature, 'challengeIndex'>,
  usePrecompile: boolean,
): Hex {
  return encodeAbiParameters(
    [
      { type: 'bytes', name: 'authenticatorData' },
      { type: 'string', name: 'clientDataJSON' },
      { type: 'uint256', name: 'responseTypeLocation' },
      { type: 'uint256', name: 'r' },
      { type: 'uint256', name: 's' },
      { type: 'bool', name: 'usePrecompiled' },
    ],
    [
      signature.authenticatorData,
      signature.clientDataJSON,
      signature.typeIndex,
      signature.r,
      signature.s,
      usePrecompile,
    ],
  )
}

export function encodeWebauthnValidatorContribution(input: {
  readonly ownerOrder: readonly string[]
  readonly threshold: number
  readonly account: Address
  readonly usePrecompile: boolean
  readonly format: 'current' | 'v0'
  readonly contributions: readonly {
    readonly ownerId: string
    readonly publicKey: Hex
    readonly signature: Hex
    readonly authenticatorData: Hex
    readonly clientDataJSON: string
    readonly challengeIndex: number
    readonly typeIndex: number
  }[]
}): Hex {
  if (input.threshold < 1 || input.threshold > input.ownerOrder.length) {
    throw new Error('Validator threshold is outside the configured owner set')
  }
  const configured = new Set(input.ownerOrder)
  const contributions = new Map<string, (typeof input.contributions)[number]>()
  for (const contribution of input.contributions) {
    if (!configured.has(contribution.ownerId)) {
      throw new Error(`Unknown validator owner ${contribution.ownerId}`)
    }
    if (contributions.has(contribution.ownerId)) {
      throw new Error(`Duplicate validator owner ${contribution.ownerId}`)
    }
    contributions.set(contribution.ownerId, contribution)
  }
  const ordered = input.ownerOrder.flatMap((ownerId) => {
    const contribution = contributions.get(ownerId)
    return contribution ? [contribution] : []
  })
  if (ordered.length < input.threshold) {
    throw new Error(
      `Insufficient validator contributions: required ${input.threshold}, received ${ordered.length}`,
    )
  }
  const signatures = ordered.map(
    (contribution): WebAuthnSignature => ({
      authenticatorData: contribution.authenticatorData,
      clientDataJSON: contribution.clientDataJSON,
      challengeIndex: BigInt(contribution.challengeIndex),
      typeIndex: BigInt(contribution.typeIndex),
      ...parseWebauthnSignature(contribution.signature),
    }),
  )
  if (input.format === 'v0') {
    if (signatures.length !== 1) {
      throw new Error('WebAuthn V0 accepts exactly one contribution')
    }
    return encodeWebauthnSignatureV0(signatures[0], input.usePrecompile)
  }
  const credentialIds = ordered.map((contribution) => {
    const publicKey = parseWebauthnPublicKey(contribution.publicKey)
    return generateWebauthnCredentialId(publicKey.x, publicKey.y, input.account)
  })
  return encodeWebauthnSignatures(
    credentialIds,
    input.usePrecompile,
    signatures,
  )
}

export function resolveWebauthnCredentials(input: {
  readonly credentials: readonly WebauthnCredential[]
  readonly threshold: number
  readonly address?: `0x${string}`
}): ResolvedModule {
  const credentials = input.credentials.map((credential) => {
    const publicKey =
      typeof credential.pubKey === 'object' &&
      !(credential.pubKey instanceof Uint8Array)
        ? credential.pubKey
        : parseWebauthnPublicKey(credential.pubKey)
    return {
      pubKeyX: publicKey.x,
      pubKeyY: publicKey.y,
      requireUV: false,
    }
  })
  return {
    kind: 'validator',
    address: input.address ?? WEBAUTHN_VALIDATOR_ADDRESS,
    initData: encodeAbiParameters(
      [
        { name: 'threshold', type: 'uint256' },
        {
          name: 'credentials',
          type: 'tuple[]',
          components: [
            { name: 'pubKeyX', type: 'uint256' },
            { name: 'pubKeyY', type: 'uint256' },
            { name: 'requireUV', type: 'bool' },
          ],
        },
      ],
      [BigInt(input.threshold), credentials],
    ),
    deInitData: '0x',
    additionalContext: '0x',
  }
}

export function resolveWebauthnValidator(
  definition: AtomicValidatorDefinition,
): ResolvedModule {
  const credentials = definition.owners.map((owner) => {
    if (owner.kind !== 'webauthn') {
      throw new Error('WebAuthn validator contains a non-WebAuthn owner')
    }
    return {
      pubKey: owner.account.publicKey,
      authenticatorId: owner.account.id,
    }
  })
  return resolveWebauthnCredentials({
    credentials,
    threshold: definition.threshold,
    address:
      definition.module.source === 'explicit'
        ? definition.module.address
        : WEBAUTHN_VALIDATOR_ADDRESS,
  })
}
