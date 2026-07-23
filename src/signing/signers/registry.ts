import type { SignerInvocationPort } from '../types'
import { invokeEcdsaSigner } from './ecdsa'
import type { ChainResolver, ExternalSignerRegistry } from './types'
import { invokeWebauthnSigner } from './webauthn'

export function createSignerInvocationPort(input: {
  readonly signers: ExternalSignerRegistry
  readonly resolveChain?: ChainResolver
}): SignerInvocationPort {
  return {
    has: (reference) => {
      const signer = input.signers[reference.id]
      return signer !== undefined && signer.kind === reference.kind
    },
    invoke: async (reference, invocation) => {
      const signer = input.signers[reference.id]
      if (!signer) throw new Error(`Signer ${reference.id} is not registered`)
      if (signer.kind !== reference.kind) {
        throw new Error(
          `Signer ${reference.id} has kind ${signer.kind}, expected ${reference.kind}`,
        )
      }
      if (
        invocation.kind === 'webauthn-sign-hash' ||
        invocation.kind === 'webauthn-sign-typed-data'
      ) {
        if (signer.kind !== 'webauthn') {
          throw new Error(`Signer ${reference.id} cannot invoke WebAuthn`)
        }
        return invokeWebauthnSigner({ signer, invocation })
      }
      if (signer.kind === 'webauthn') {
        throw new Error(`Signer ${reference.id} cannot invoke ECDSA`)
      }
      return invokeEcdsaSigner({
        signer,
        invocation,
        ...(input.resolveChain ? { resolveChain: input.resolveChain } : {}),
      })
    },
  }
}
