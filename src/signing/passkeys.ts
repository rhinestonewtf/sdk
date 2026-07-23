import type { Address, Hex } from 'viem'
import {
  encodeWebauthnSignatures,
  encodeWebauthnSignatureV0,
  generateWebauthnCredentialId,
  parseWebauthnPublicKey,
  parseWebauthnSignature,
  type WebAuthnSignature,
} from '../modules/validators/webauthn'

export function parsePublicKey(publicKey: Hex | Uint8Array): {
  x: bigint
  y: bigint
} {
  const { x, y } = parseWebauthnPublicKey(publicKey)
  return { x, y }
}

export function parseSignature(signature: Hex | Uint8Array): {
  r: bigint
  s: bigint
} {
  return parseWebauthnSignature(signature)
}

export function generateCredentialId(
  pubKeyX: bigint,
  pubKeyY: bigint,
  account: Address,
): `0x${string}` {
  return generateWebauthnCredentialId(pubKeyX, pubKeyY, account)
}

export function packSignature(
  credIds: Hex[],
  usePrecompile: boolean,
  webAuthns: {
    authenticatorData: Hex
    clientDataJSON: string
    challengeIndex: bigint
    typeIndex: bigint
    r: bigint
    s: bigint
  }[],
): Hex {
  return encodeWebauthnSignatures(credIds, usePrecompile, webAuthns)
}

export function packSignatureV0(
  webauthn: {
    authenticatorData: Hex
    clientDataJSON: string
    typeIndex: number | bigint
    r: bigint
    s: bigint
  },
  usePrecompiled: boolean,
): `0x${string}` {
  return encodeWebauthnSignatureV0(
    { ...webauthn, typeIndex: BigInt(webauthn.typeIndex) },
    usePrecompiled,
  )
}

export type { WebAuthnSignature }
