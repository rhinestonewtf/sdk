import type { WebAuthnP256 } from 'ox'
import type { Hex, TypedDataDefinition } from 'viem'
import type { WebAuthnAccount } from 'viem/account-abstraction'

interface WebAuthnSignResponse {
  webauthn: WebAuthnP256.SignMetadata
  signature: Hex
}

interface RemoteWebAuthnAccountConfig {
  credential: {
    id: string
    publicKey: Hex
  }
  sign: (params: { hash: Hex }) => Promise<WebAuthnSignResponse>
  signTypedData: <
    const typedData extends
      | TypedDataDefinition
      | Record<string, unknown> = TypedDataDefinition,
    primaryType extends keyof typedData | 'EIP712Domain' = keyof typedData,
  >(
    typedDataDefinition: TypedDataDefinition<typedData, primaryType>,
  ) => Promise<WebAuthnSignResponse>
}

function toRemoteWebAuthnAccount(
  config: RemoteWebAuthnAccountConfig,
): WebAuthnAccount {
  return {
    id: config.credential.id,
    publicKey: config.credential.publicKey,
    type: 'webAuthn',
    async sign({ hash }) {
      const result = await config.sign({ hash })
      return {
        signature: result.signature,
        webauthn: result.webauthn,
        raw: {} as any,
      }
    },
    async signMessage() {
      // For remote accounts, the sign callback should handle message hashing
      // The SDK only uses sign({ hash }) and signTypedData() for passkey signing
      throw new Error(
        'signMessage is not supported on remote WebAuthn accounts. Use sign({ hash }) instead.',
      )
    },
    async signTypedData(typedDataDefinition) {
      const result = await config.signTypedData(typedDataDefinition)
      return {
        signature: result.signature,
        webauthn: result.webauthn,
        raw: {} as any,
      }
    },
  }
}

export { toRemoteWebAuthnAccount }
export type { RemoteWebAuthnAccountConfig, WebAuthnSignResponse }
