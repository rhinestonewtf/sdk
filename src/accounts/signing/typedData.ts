import type {
  Account,
  Address,
  Chain,
  HashTypedDataParameters,
  Hex,
  TypedData,
} from 'viem'
import type { WebAuthnAccount } from 'viem/account-abstraction'
import type { OwnerSet, SignerSet } from '../../types'
import { SigningNotSupportedForAccountError } from '../error'
import {
  type SigningFunctions,
  signWithGuardians,
  signWithOwners,
} from './common'

async function sign<
  typedData extends TypedData | Record<string, unknown> = TypedData,
  primaryType extends keyof typedData | 'EIP712Domain' = keyof typedData,
>(
  signers: SignerSet,
  configuredOwners: OwnerSet,
  chain: Chain,
  address: Address,
  parameters: HashTypedDataParameters<typedData, primaryType>,
  _isUserOpHash = false,
  statelessPasskey = false,
): Promise<Hex> {
  const signingFunctions: SigningFunctions<
    HashTypedDataParameters<typedData, primaryType>
  > = {
    signEcdsa: (account, params) => signEcdsa(account, params),
    signPasskey: (account, params) => signPasskey(account, params),
  }

  switch (signers.type) {
    case 'owner': {
      return signWithOwners(
        signers,
        configuredOwners,
        chain,
        address,
        parameters,
        signingFunctions,
        false,
        sign,
        statelessPasskey,
      )
    }
    case 'guardians': {
      return signWithGuardians(signers, parameters, signingFunctions)
    }
    case 'experimental_session': {
      throw new Error('Not supported')
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
  parameters: HashTypedDataParameters<typedData, primaryType>,
) {
  const { webauthn, signature } = await account.signTypedData(parameters)
  return {
    webauthn,
    signature,
  }
}

export { sign }
