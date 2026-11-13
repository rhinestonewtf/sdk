import { P256, PublicKey, Signature, WebAuthnP256 } from 'ox'
import {
  type Hex,
  hashMessage,
  hashTypedData,
  keccak256,
  type SignableMessage,
  type TypedDataDefinition,
  toHex,
} from 'viem'
import type { WebAuthnAccount } from 'viem/account-abstraction'

// A deterministic software credential keeps offline signing reproducible.
const privateKey = keccak256(toHex('sdk-v1-parity:passkey:v1'))
const publicKey = PublicKey.toHex(P256.getPublicKey({ privateKey }), {
  includePrefix: false,
})

async function signHash({ hash }: { hash: Hex }) {
  const { payload, metadata } = WebAuthnP256.getSignPayload({
    challenge: hash,
    rpId: 'parity.rhinestone.test',
    origin: 'https://parity.rhinestone.test',
  })
  const signature = P256.sign({ payload, privateKey, hash: true })
  return { signature: Signature.toHex(signature), webauthn: metadata, raw: {} }
}

function fixturePasskey(): WebAuthnAccount {
  return {
    id: 'sdk-v1-parity-passkey',
    publicKey,
    type: 'webAuthn',
    sign: signHash,
    signMessage: ({ message }: { message: SignableMessage }) =>
      signHash({ hash: hashMessage(message) }),
    signTypedData: (parameters: TypedDataDefinition) =>
      signHash({ hash: hashTypedData(parameters) }),
  } as unknown as WebAuthnAccount
}

export { fixturePasskey }
