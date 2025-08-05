import {
  type Account,
  type Chain,
  concat,
  encodeAbiParameters,
  type Hex,
  pad,
  toHex,
} from 'viem'
import type { WebAuthnAccount } from 'viem/_types/account-abstraction'
import { getValidator } from '../../modules/validators/core'
import type { OwnerSet, SignerSet } from '../../types'

function convertOwnerSetToSignerSet(owners: OwnerSet): SignerSet {
  switch (owners.type) {
    case 'ecdsa': {
      return {
        type: 'owner',
        kind: 'ecdsa',
        accounts: owners.accounts,
      }
    }
    case 'passkey': {
      return {
        type: 'owner',
        kind: 'passkey',
        account: owners.account,
      }
    }
    case 'multi-factor': {
      return {
        type: 'owner',
        kind: 'multi-factor',
        validators: owners.validators.map((validator, index) => {
          switch (validator.type) {
            case 'ecdsa': {
              return {
                type: 'ecdsa',
                id: index,
                accounts: validator.accounts,
              }
            }
            case 'passkey': {
              return {
                type: 'passkey',
                id: index,
                account: validator.account,
              }
            }
          }
        }),
      }
    }
  }
}

type SigningFunctions<T> = {
  signEcdsa: (account: Account, params: T) => Promise<Hex>
  signPasskey: (
    account: WebAuthnAccount,
    chain: Chain,
    params: T,
  ) => Promise<Hex>
}

async function signWithMultiFactorAuth<T>(
  signers: SignerSet & { type: 'owner'; kind: 'multi-factor' },
  chain: Chain,
  params: T,
  signMain: (signers: SignerSet, chain: Chain, params: T) => Promise<Hex>,
): Promise<Hex> {
  const signatures = await Promise.all(
    signers.validators.map(async (validator) => {
      if (validator === null) {
        return '0x'
      }
      const validatorSigners: SignerSet = convertOwnerSetToSignerSet(validator)
      return signMain(validatorSigners, chain, params)
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

async function signWithSession<T>(
  signers: SignerSet & { type: 'session' },
  chain: Chain,
  params: T,
  signMain: (signers: SignerSet, chain: Chain, params: T) => Promise<Hex>,
): Promise<Hex> {
  const sessionSigners: SignerSet = convertOwnerSetToSignerSet(
    signers.session.owners,
  )
  return signMain(sessionSigners, chain, params)
}

async function signWithGuardians<T>(
  signers: SignerSet & { type: 'guardians' },
  params: T,
  signingFunctions: SigningFunctions<T>,
): Promise<Hex> {
  const signatures = await Promise.all(
    signers.guardians.map((account) =>
      signingFunctions.signEcdsa(account, params),
    ),
  )
  return concat(signatures)
}

async function signWithOwners<T>(
  signers: SignerSet & { type: 'owner' },
  chain: Chain,
  params: T,
  signingFunctions: SigningFunctions<T>,
  signMain: (signers: SignerSet, chain: Chain, params: T) => Promise<Hex>,
): Promise<Hex> {
  switch (signers.kind) {
    case 'ecdsa': {
      const signatures = await Promise.all(
        signers.accounts.map((account) =>
          signingFunctions.signEcdsa(account, params),
        ),
      )
      return concat(signatures)
    }
    case 'passkey': {
      return await signingFunctions.signPasskey(signers.account, chain, params)
    }
    case 'multi-factor': {
      return signWithMultiFactorAuth(signers, chain, params, signMain)
    }
    default: {
      throw new Error('Unsupported owner kind')
    }
  }
}

export {
  convertOwnerSetToSignerSet,
  signWithMultiFactorAuth,
  signWithSession,
  signWithGuardians,
  signWithOwners,
  type SigningFunctions,
}
