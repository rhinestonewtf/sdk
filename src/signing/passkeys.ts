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
): Hex {
  return generateWebauthnCredentialId(pubKeyX, pubKeyY, account)
}

export function packSignature(
  credentialIds: Hex[],
  usePrecompile: boolean,
  signatures: WebAuthnSignature[],
): Hex {
  return encodeWebauthnSignatures(credentialIds, usePrecompile, signatures)
}

export function packSignatureV0(
  signature: {
    authenticatorData: Hex
    clientDataJSON: string
    typeIndex: number | bigint
    r: bigint
    s: bigint
  },
  usePrecompiled: boolean,
): Hex {
  return encodeWebauthnSignatureV0(
    { ...signature, typeIndex: BigInt(signature.typeIndex) },
    usePrecompiled,
  )
}

export type { WebAuthnSignature }
