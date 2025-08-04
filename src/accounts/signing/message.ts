import {
  type Account,
  concat,
  encodeAbiParameters,
  type Hex,
  pad,
  toHex,
} from 'viem'
import type { WebAuthnAccount } from 'viem/_types/account-abstraction'
import {
  getWebauthnValidatorSignature,
  isRip7212SupportedNetwork,
} from '../../modules'
import { getValidator } from '../../modules/validators/core'
import type { SignerSet } from '../../types'
import { SigningNotSupportedForAccountError } from '../error'
import { convertOwnerSetToSignerSet } from './common'

async function sign(
  signers: SignerSet,
  chainId: number,
  hash: Hex,
): Promise<Hex> {
  switch (signers.type) {
    case 'owner': {
      switch (signers.kind) {
        case 'ecdsa': {
          const signatures = await Promise.all(
            signers.accounts.map((account) => signEcdsa(account, hash)),
          )
          return concat(signatures)
        }
        case 'passkey': {
          return await signPasskey(signers.account, chainId, hash)
        }
        case 'multi-factor': {
          const signatures = await Promise.all(
            signers.validators.map(async (validator) => {
              if (validator === null) {
                return '0x'
              }
              const validatorSigners: SignerSet =
                convertOwnerSetToSignerSet(validator)
              return sign(validatorSigners, chainId, hash)
            }),
          )
          const data = encodeAbiParameters(
            [
              {
                components: [
                  {
                    internalType: 'bytes32',
                    name: 'packedValidatorAndId',
                    type: 'bytes32',
                  },
                  { internalType: 'bytes', name: 'data', type: 'bytes' },
                ],
                name: 'validators',
                type: 'tuple[]',
              },
            ],
            [
              signers.validators.map((validator, index) => {
                const validatorModule = getValidator(validator)
                return {
                  packedValidatorAndId: concat([
                    pad(toHex(validator.id), {
                      size: 12,
                    }),
                    validatorModule.address,
                  ]),
                  data: signatures[index],
                }
              }),
            ],
          )
          return data
        }
        default: {
          throw new Error('Unsupported owner kind')
        }
      }
    }
    case 'session': {
      const sessionSigners: SignerSet = convertOwnerSetToSignerSet(
        signers.session.owners,
      )
      return sign(sessionSigners, chainId, hash)
    }
    case 'guardians': {
      const signatures = await Promise.all(
        signers.guardians.map((account) => signEcdsa(account, hash)),
      )
      return concat(signatures)
    }
  }
}

async function signEcdsa(account: Account, hash: Hex) {
  if (!account.signMessage) {
    throw new SigningNotSupportedForAccountError()
  }
  return await account.signMessage({ message: { raw: hash } })
}

async function signPasskey(
  account: WebAuthnAccount,
  chainId: number,
  hash: Hex,
) {
  const { webauthn, signature } = await account.sign({ hash })
  const usePrecompiled = isRip7212SupportedNetwork(chainId)
  const encodedSignature = getWebauthnValidatorSignature({
    webauthn,
    signature,
    usePrecompiled,
  })
  return encodedSignature
}

export { sign }
