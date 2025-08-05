import type {
  Account,
  Chain,
  HashTypedDataParameters,
  Hex,
  TypedData,
} from 'viem'
import type { WebAuthnAccount } from 'viem/_types/account-abstraction'
import {
  getWebauthnValidatorSignature,
  isRip7212SupportedNetwork,
} from '../../modules'
import type { SignerSet } from '../../types'
import { SigningNotSupportedForAccountError } from '../error'
import {
  type SigningFunctions,
  signWithGuardians,
  signWithOwners,
  signWithSession,
} from './common'

async function sign<
  typedData extends TypedData | Record<string, unknown> = TypedData,
  primaryType extends keyof typedData | 'EIP712Domain' = keyof typedData,
>(
  signers: SignerSet,
  chain: Chain,
  parameters: HashTypedDataParameters<typedData, primaryType>,
): Promise<Hex> {
  const signingFunctions: SigningFunctions<
    HashTypedDataParameters<typedData, primaryType>
  > = {
    signEcdsa: (account, params) => signEcdsa(account, params),
    signPasskey: (account, chain, params) =>
      signPasskey(account, chain, params),
  }

  switch (signers.type) {
    case 'owner': {
      return signWithOwners(signers, chain, parameters, signingFunctions, sign)
    }
    case 'session': {
      return signWithSession(signers, chain, parameters, sign)
    }
    case 'guardians': {
      return signWithGuardians(signers, parameters, signingFunctions)
    }
  }
}

async function signEcdsa<
  typedData extends TypedData | Record<string, unknown> = TypedData,
  primaryType extends keyof typedData | 'EIP712Domain' = keyof typedData,
>(
  account: Account,
  parameters: HashTypedDataParameters<typedData, primaryType>,
) {
  if (!account.signTypedData) {
    throw new SigningNotSupportedForAccountError()
  }
  return await account.signTypedData<typedData, primaryType>(parameters)
}

async function signPasskey<
  typedData extends TypedData | Record<string, unknown> = TypedData,
  primaryType extends keyof typedData | 'EIP712Domain' = keyof typedData,
>(
  account: WebAuthnAccount,
  chain: Chain,
  parameters: HashTypedDataParameters<typedData, primaryType>,
) {
  const { webauthn, signature } = await account.signTypedData(parameters)
  const usePrecompiled = isRip7212SupportedNetwork(chain)
  const encodedSignature = getWebauthnValidatorSignature({
    webauthn,
    signature,
    usePrecompiled,
  })
  return encodedSignature
}

export { sign }
