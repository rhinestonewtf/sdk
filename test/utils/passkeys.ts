import { p256 } from '@noble/curves/nist'
import { base64urlnopad } from '@scure/base'
import {
  bytesToHex,
  concat,
  type Hex,
  hexToBytes,
  keccak256,
  sha256,
  stringToBytes,
  toHex,
} from 'viem'
import {
  toWebAuthnAccount,
  type WebAuthnAccount,
} from 'viem/account-abstraction'

// Deterministic passkey credentials: the same tag always yields the same public
// key, so derived addresses stay stable across runs and machines.
function passkey(tag: string): WebAuthnAccount {
  return toWebAuthnAccount({
    credential: {
      id: tag,
      publicKey: `0x${keccak256(toHex(`x:${tag}`)).slice(2)}${keccak256(toHex(`y:${tag}`)).slice(2)}`,
    },
  })
}

/**
 * A viem WebAuthn account backed by a real P-256 key and an in-process
 * authenticator that answers `navigator.credentials.get` as a browser does:
 * DER signature, raw client data bytes. `signs` lets a test make the
 * authenticator commit to a different challenge than the one requested.
 */
function signingPasskey(
  options: {
    readonly privateKey?: Hex
    readonly signs?: (requested: Uint8Array) => Uint8Array
  } = {},
): { readonly account: WebAuthnAccount; readonly compressedPublicKey: Hex } {
  const privateKey = hexToBytes(options.privateKey ?? `0x${'21'.repeat(32)}`)
  const credentialId = 'AQIDBA'
  const account = toWebAuthnAccount({
    credential: {
      id: credentialId,
      publicKey: bytesToHex(p256.getPublicKey(privateKey, false).slice(1)),
    },
    rpId: 'app.example',
    getFn: async (request) => {
      const requested = new Uint8Array(
        request?.publicKey?.challenge as Uint8Array,
      )
      const challenge = options.signs?.(requested) ?? requested
      const clientDataJSON = stringToBytes(
        JSON.stringify({
          type: 'webauthn.get',
          challenge: base64urlnopad.encode(challenge),
          origin: 'https://app.example',
          crossOrigin: false,
        }),
      )
      const authenticatorData = concat([
        sha256(stringToBytes('app.example'), 'bytes'),
        new Uint8Array([0x05, 0, 0, 0, 1]),
      ])
      const digest = sha256(
        concat([authenticatorData, sha256(clientDataJSON, 'bytes')]),
        'bytes',
      )
      return {
        id: credentialId,
        type: 'public-key',
        response: {
          clientDataJSON,
          authenticatorData,
          signature: p256.sign(digest, privateKey).toDERRawBytes(),
          userHandle: null,
        },
      } as never
    },
  })
  return {
    account,
    compressedPublicKey: bytesToHex(p256.getPublicKey(privateKey, true)),
  }
}

export { passkey, signingPasskey }
