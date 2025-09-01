import type { WebAuthnP256 } from 'ox'
import {
  type Account,
  type Address,
  type Chain,
  concat,
  encodeAbiParameters,
  type Hex,
  pad,
  toHex,
} from 'viem'
import type { WebAuthnAccount } from 'viem/account-abstraction'
import { isRip7212SupportedNetwork } from '../../modules'
import { getValidator } from '../../modules/validators/core'
import type { OwnerSet, SignerSet } from '../../types'
import {
  generateCredentialId,
  packSignature as packPasskeySignature,
  packSignatureV0 as packPasskeySignatureV0,
  parsePublicKey,
  parseSignature,
} from './passkeys'

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
        accounts: owners.accounts,
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
                accounts: validator.accounts,
              }
            }
          }
        }),
      }
    }
  }
}

type SigningFunctions<T> = {
  signEcdsa: (account: Account, params: T, updateV: boolean) => Promise<Hex>
  signPasskey: (
    account: WebAuthnAccount,
    params: T,
  ) => Promise<{
    webauthn: WebAuthnP256.SignMetadata
    signature: Hex
  }>
}

async function signWithMultiFactorAuth<T>(
  signers: SignerSet & { type: 'owner'; kind: 'multi-factor' },
  chain: Chain,
  address: Address,
  params: T,
  signMain: (
    signers: SignerSet,
    chain: Chain,
    address: Address,
    params: T,
  ) => Promise<Hex>,
): Promise<Hex> {
  const signatures = await Promise.all(
    signers.validators.map(async (validator) => {
      if (validator === null) {
        return '0x'
      }
      const validatorSigners: SignerSet = convertOwnerSetToSignerSet(validator)
      return signMain(validatorSigners, chain, address, params)
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
  address: Address,
  params: T,
  signMain: (
    signers: SignerSet,
    chain: Chain,
    address: Address,
    params: T,
  ) => Promise<Hex>,
): Promise<Hex> {
  const sessionSigners: SignerSet = convertOwnerSetToSignerSet(
    signers.session.owners,
  )
  return signMain(sessionSigners, chain, address, params)
}

async function signWithGuardians<T>(
  signers: SignerSet & { type: 'guardians' },
  params: T,
  signingFunctions: SigningFunctions<T>,
): Promise<Hex> {
  const signatures = await Promise.all(
    signers.guardians.map((account) =>
      signingFunctions.signEcdsa(account, params, false),
    ),
  )
  return concat(signatures)
}

async function signWithOwners<T>(
  signers: SignerSet & { type: 'owner' },
  chain: Chain,
  address: Address,
  params: T,
  signingFunctions: SigningFunctions<T>,
  signMain: (
    signers: SignerSet,
    chain: Chain,
    address: Address,
    params: T,
  ) => Promise<Hex>,
): Promise<Hex> {
  switch (signers.kind) {
    case 'ecdsa': {
      // Ownable validator uses `v` value to determine which validation mode to use
      const updateV =
        !signers.module ||
        signers.module?.toLowerCase() ===
          '0x000000000013fdb5234e4e3162a810f54d9f7e98'
      const signatures = await Promise.all(
        signers.accounts.map((account) =>
          signingFunctions.signEcdsa(account, params, updateV),
        ),
      )
      return concat(signatures)
    }
    case 'passkey': {
      const signatures = await Promise.all(
        signers.accounts.map((account) =>
          signingFunctions.signPasskey(account, params),
        ),
      )
      const usePrecompile = isRip7212SupportedNetwork(chain)
      const credIds = signers.accounts.map((account) => {
        const publicKey = account.publicKey
        const { x, y } = parsePublicKey(publicKey)
        return generateCredentialId(x, y, address)
      })
      const webAuthns = signatures.map((signature) => {
        const { r, s } = parseSignature(signature.signature)
        return {
          authenticatorData: signature.webauthn.authenticatorData,
          clientDataJSON: signature.webauthn.clientDataJSON,
          challengeIndex: BigInt(signature.webauthn.challengeIndex),
          typeIndex: BigInt(signature.webauthn.typeIndex),
          r,
          s,
        }
      })
      // Legacy WebAuthn validator
      if (
        signers.module?.toLowerCase() ===
        '0x0000000000578c4cb0e472a5462da43c495c3f33'
      ) {
        return packPasskeySignatureV0(webAuthns[0], usePrecompile)
      }
      return packPasskeySignature(credIds, usePrecompile, webAuthns)
    }
    case 'multi-factor': {
      return signWithMultiFactorAuth(signers, chain, address, params, signMain)
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
