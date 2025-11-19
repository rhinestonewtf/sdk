import type { WebAuthnP256 } from 'ox'
import {
  type Account,
  type Address,
  type Chain,
  concat,
  createWalletClient,
  custom,
  encodeAbiParameters,
  type Hex,
  pad,
  toHex,
} from 'viem'
import type { WebAuthnAccount } from 'viem/account-abstraction'
import { isRip7212SupportedNetwork } from '../../modules'
import {
  ENS_VALIDATOR_ADDRESS,
  getValidator,
  OWNABLE_VALIDATOR_ADDRESS,
  WEBAUTHN_V0_VALIDATOR_ADDRESS,
} from '../../modules/validators/core'
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
        module: owners.module ?? OWNABLE_VALIDATOR_ADDRESS,
      }
    }
    case 'ens': {
      return {
        type: 'owner',
        kind: 'ecdsa',
        accounts: owners.accounts,
        module: owners.module ?? ENS_VALIDATOR_ADDRESS,
      }
    }
    case 'passkey': {
      return {
        type: 'owner',
        kind: 'passkey',
        accounts: owners.accounts,
        module: owners.module,
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
                type: validator.type,
                id: index,
                accounts: validator.accounts,
                module: validator.module ?? OWNABLE_VALIDATOR_ADDRESS,
              }
            }
            case 'ens': {
              return {
                type: 'ecdsa',
                id: index,
                accounts: validator.accounts,
                module: validator.module ?? ENS_VALIDATOR_ADDRESS,
              }
            }
            case 'passkey': {
              return {
                type: 'passkey',
                id: index,
                accounts: validator.accounts,
                module: validator.module,
              }
            }
            default: {
              throw new Error(
                `Unsupported validator type: ${(validator as any).type}`,
              )
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
  isUserOpHash: boolean,
  signMain: (
    signers: SignerSet,
    chain: Chain,
    address: Address,
    params: T,
    isUserOpHash: boolean,
  ) => Promise<Hex>,
): Promise<Hex> {
  const signatures = await Promise.all(
    signers.validators.map(async (validator) => {
      if (validator === null) {
        return '0x'
      }
      const validatorSigners: SignerSet = convertOwnerSetToSignerSet(validator)
      return signMain(validatorSigners, chain, address, params, isUserOpHash)
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
  isUserOpHash: boolean,
  signMain: (
    signers: SignerSet,
    chain: Chain,
    address: Address,
    params: T,
    isUserOpHash: boolean,
  ) => Promise<Hex>,
): Promise<Hex> {
  const sessionSigners: SignerSet = convertOwnerSetToSignerSet(
    signers.session.owners,
  )
  return signMain(sessionSigners, chain, address, params, isUserOpHash)
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
  isUserOpHash: boolean,
  signMain: (
    signers: SignerSet,
    chain: Chain,
    address: Address,
    params: T,
    isUserOpHash: boolean,
  ) => Promise<Hex>,
): Promise<Hex> {
  async function signEcdsWithChain(
    account: Account,
    params: T,
    updateV: boolean,
    chain: Chain,
  ): Promise<Hex> {
    const client = account.client
    const transport = client?.transport
    if (transport) {
      // Switch chain
      const walletClient = createWalletClient({
        chain,
        transport: custom(transport),
        account,
      })
      await walletClient.switchChain({
        id: chain.id,
      })
    }
    // Sign
    return signingFunctions.signEcdsa(account, params, updateV)
  }

  switch (signers.kind) {
    case 'ecdsa': {
      // Ownable validator uses `v` value to determine which validation mode to use
      // ENS validator (based on Ownable) also uses the same signature format
      // This is not needed for UserOps
      const isOwnableOrENS =
        !signers.module ||
        signers.module?.toLowerCase() === OWNABLE_VALIDATOR_ADDRESS ||
        signers.module?.toLowerCase() === ENS_VALIDATOR_ADDRESS

      const updateV = isOwnableOrENS && !isUserOpHash

      const signatures = await Promise.all(
        signers.accounts.map((account) =>
          signEcdsWithChain(account, params, updateV, chain),
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
      if (signers.module?.toLowerCase() === WEBAUTHN_V0_VALIDATOR_ADDRESS) {
        return packPasskeySignatureV0(webAuthns[0], usePrecompile)
      }
      return packPasskeySignature(credIds, usePrecompile, webAuthns)
    }
    case 'multi-factor': {
      return signWithMultiFactorAuth(
        signers,
        chain,
        address,
        params,
        isUserOpHash,
        signMain,
      )
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
