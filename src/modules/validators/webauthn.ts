import { bytesToHex, encodeAbiParameters, type Hex, hexToBytes } from 'viem'
import type { ResolvedModule } from '../types'
import type { AtomicValidatorDefinition } from './types'

export const WEBAUTHN_VALIDATOR_ADDRESS =
  '0x0000000000578c4cb0e472a5462da43c495c3f33' as const
export const WEBAUTHN_V0_VALIDATOR_ADDRESS = WEBAUTHN_VALIDATOR_ADDRESS

export const WEBAUTHN_MOCK_SIGNATURE =
  '0x0000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000001b9b86eb98fda3ed4d797d9e690588dfadf17b329a76a47cec935bebf92d7ddc80000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000120000000000000000000000000000000000000000000000000000000000000001700000000000000000000000000000000000000000000000000000000000000019b2e9410bb6850f9f660a03d609d5a844fb96bcdc87a15139b03ee22c70f469100d2b865a215c3bf786387064effa8fcedcb1d625b5148f8a1236d5e3ff11acf000000000000000000000000000000000000000000000000000000000000002549960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d9763050000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000867b2274797065223a22776562617574686e2e676574222c226368616c6c656e6765223a22396a4546696a75684557724d34534f572d7443684a625545484550343456636a634a2d42716f3166544d38222c226f726967696e223a22687474703a2f2f6c6f63616c686f73743a38303830222c2263726f73734f726967696e223a66616c73657d0000000000000000000000000000000000000000000000000000' as const

export interface WebauthnPublicKey {
  readonly prefix?: number
  readonly x: bigint
  readonly y: bigint
}

export interface WebauthnCredential {
  readonly pubKey: WebauthnPublicKey | Hex | Uint8Array
  readonly authenticatorId: string
}

export function parseWebauthnPublicKey(
  publicKey: Hex | Uint8Array,
): WebauthnPublicKey {
  const bytes =
    typeof publicKey === 'string' ? hexToBytes(publicKey) : publicKey
  const offset = bytes.length === 65 ? 1 : 0
  const prefix = offset === 1 ? bytes[0] : undefined
  if (bytes.length !== 64 && bytes.length !== 65) {
    throw new Error('WebAuthn public key must contain 64 or 65 bytes')
  }
  if (prefix !== undefined && prefix !== 4) {
    throw new Error('Only uncompressed public keys are supported')
  }
  return {
    ...(prefix === undefined ? {} : { prefix }),
    x: BigInt(bytesToHex(bytes.slice(offset, 32 + offset))),
    y: BigInt(bytesToHex(bytes.slice(32 + offset, 64 + offset))),
  }
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
