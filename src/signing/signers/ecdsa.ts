import { concat, type Hex, hexToBytes, toHex } from 'viem'
import type { EvmChainReference } from '../../chains/types'
import type { RawSignerResult, SignerInvocation } from '../types'
import type { ChainResolver, ExternalSigner } from './types'
import { selectSignerChain } from './wallet-chain'

export async function invokeEcdsaSigner(input: {
  readonly signer: Extract<
    ExternalSigner,
    { readonly kind: 'ecdsa' | 'wallet-authorization' }
  >
  readonly invocation: Extract<
    SignerInvocation,
    {
      readonly kind:
        | 'ecdsa-sign-message'
        | 'ecdsa-sign-typed-data'
        | 'sign-authorization'
    }
  >
  readonly resolveChain?: ChainResolver
}): Promise<RawSignerResult> {
  const account = input.signer.account
  const chain = invocationChain(input.invocation)
  await selectSignerChain({
    account,
    ...(chain ? { chain } : {}),
    ...(input.resolveChain ? { resolveChain: input.resolveChain } : {}),
  })
  switch (input.invocation.kind) {
    case 'ecdsa-sign-message': {
      if (!account.signMessage)
        throw new Error('Account does not support signMessage')
      const signature = await account.signMessage({
        message: input.invocation.message,
      })
      return {
        kind: 'ecdsa-signature',
        signature: normalizeRecovery(signature),
      }
    }
    case 'ecdsa-sign-typed-data': {
      if (!account.signTypedData)
        throw new Error('Account does not support signTypedData')
      const signature = await account.signTypedData(input.invocation.typedData)
      return {
        kind: 'ecdsa-signature',
        signature: normalizeRecovery(signature),
      }
    }
    case 'sign-authorization': {
      if (!account.signAuthorization) {
        throw new Error('Account does not support signAuthorization')
      }
      return {
        kind: 'signed-authorization',
        authorization: await account.signAuthorization(
          input.invocation.authorization,
        ),
      }
    }
  }
}

function invocationChain(
  invocation: SignerInvocation,
): EvmChainReference | undefined {
  return 'chain' in invocation ? invocation.chain : undefined
}

export function normalizeRecovery(signature: Hex): Hex {
  const bytes = hexToBytes(signature)
  if (bytes.length !== 65) return signature
  const recovery = bytes[64]
  if (recovery >= 27) return signature
  return concat([signature.slice(0, -2) as Hex, toHex(recovery + 27)])
}
