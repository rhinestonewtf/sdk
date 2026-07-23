import type { RawSignerResult, SignerInvocation } from '../types'
import type { ExternalSigner } from './types'

export async function invokeWebauthnSigner(input: {
  readonly signer: Extract<ExternalSigner, { readonly kind: 'webauthn' }>
  readonly invocation: Extract<
    SignerInvocation,
    { readonly kind: 'webauthn-sign-hash' | 'webauthn-sign-typed-data' }
  >
}): Promise<RawSignerResult> {
  const result =
    input.invocation.kind === 'webauthn-sign-hash'
      ? await input.signer.account.sign({ hash: input.invocation.hash })
      : await input.signer.account.signTypedData(input.invocation.typedData)
  return {
    kind: 'webauthn-assertion',
    signature: result.signature,
    authenticatorData: result.webauthn.authenticatorData,
    clientDataJSON: result.webauthn.clientDataJSON,
    challengeIndex: result.webauthn.challengeIndex ?? 0,
    typeIndex: result.webauthn.typeIndex ?? 0,
    userVerificationRequired: result.webauthn.userVerificationRequired ?? false,
  }
}
