import type { Hex, TypedDataDefinition } from 'viem'
import { toWebAuthnAccount } from 'viem/account-abstraction'
import type { WebAuthnSignResponse } from './accounts/signing/remoteWebAuthn'

interface PasskeyCredential {
  id: string
  publicKey: Hex
}

async function signWithPasskey(params: {
  credential: PasskeyCredential
  hash: Hex
}): Promise<WebAuthnSignResponse> {
  const account = toWebAuthnAccount({
    credential: params.credential,
  })
  const { webauthn, signature } = await account.sign({ hash: params.hash })
  return { webauthn, signature }
}

async function signTypedDataWithPasskey(params: {
  credential: PasskeyCredential
  typedData: TypedDataDefinition
}): Promise<WebAuthnSignResponse> {
  const account = toWebAuthnAccount({
    credential: params.credential,
  })
  const { webauthn, signature } = await account.signTypedData(params.typedData)
  return { webauthn, signature }
}

export { signWithPasskey, signTypedDataWithPasskey }
export type { PasskeyCredential }
export type { WebAuthnSignResponse } from './accounts/signing/remoteWebAuthn'
