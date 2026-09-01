import {
  type Account,
  type Address,
  type Chain,
  concat,
  createWalletClient,
  custom,
  encodeAbiParameters,
  encodePacked,
  type Hex,
  hashMessage,
  hexToBytes,
  pad,
  padHex,
  toHex,
} from 'viem'
import type { WebAuthnAccount } from 'viem/account-abstraction'
import { isRip7212SupportedNetwork } from '../../modules'
import {
  ENS_HCA_MODULE,
  getValidator,
  OWNABLE_VALIDATOR_ADDRESS,
  WEBAUTHN_V0_VALIDATOR_ADDRESS,
} from '../../modules/validators/core'
import {
  encodeQuorumErc1271Signature,
  encodeQuorumOwnerSignatures,
  getQuorumConfigOwners,
  getQuorumSignableHash,
  getQuorumValidator,
} from '../../modules/validators/quorum'
import {
  packSignature as packSmartSessionSignature,
  type ResolvedSessionSignerSet,
} from '../../modules/validators/smart-sessions'
import type { OwnerSet, SignerSet } from '../../types'
import {
  generateCredentialId,
  packSignature as packPasskeySignature,
  packSignatureV0 as packPasskeySignatureV0,
  packStatelessSignature as packStatelessPasskeySignature,
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
    case 'quorum': {
      return {
        type: 'owner',
        kind: 'quorum',
        accounts: owners.owners.map(({ account }) => account),
      }
    }
    case 'ens': {
      return {
        type: 'owner',
        kind: 'ecdsa',
        accounts: owners.accounts,
        module: ENS_HCA_MODULE,
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
                module: ENS_HCA_MODULE,
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
        module: owners.module,
      }
    }
  }
}

type WebAuthnSignMetadata = {
  authenticatorData: Hex
  challengeIndex?: number | undefined
  clientDataJSON: string
  typeIndex?: number | undefined
  userVerificationRequired?: boolean | undefined
}

type SigningFunctions<T> = {
  signEcdsa: (account: Account, params: T, updateV: boolean) => Promise<Hex>
  signPasskey: (
    account: WebAuthnAccount,
    params: T,
  ) => Promise<{
    webauthn: WebAuthnSignMetadata
    signature: Hex
  }>
}

async function signWithMultiFactorAuth<T>(
  signers: SignerSet & { type: 'owner'; kind: 'multi-factor' },
  configuredOwners: OwnerSet & { type: 'multi-factor' },
  chain: Chain,
  address: Address,
  params: T,
  isUserOpHash: boolean,
  signMain: (
    signers: SignerSet,
    configuredOwners: OwnerSet,
    chain: Chain,
    address: Address,
    params: T,
    isUserOpHash: boolean,
    statelessPasskey?: boolean,
  ) => Promise<Hex>,
): Promise<Hex> {
  const configuredValidators = signers.validators.map((validator) => {
    const configuredValidator =
      configuredOwners.validators[Number(BigInt(validator.id))]
    if (!configuredValidator) {
      throw new Error(`Unknown multi-factor validator ID ${validator.id}`)
    }
    if (
      validator.type !== configuredValidator.type &&
      !(validator.type === 'ecdsa' && configuredValidator.type === 'ens')
    ) {
      throw new Error(
        `Multi-factor validator ID ${validator.id} has wrong type`,
      )
    }
    return configuredValidator
  })
  const signatures = await Promise.all(
    signers.validators.map((validator, index) => {
      const configuredValidator = configuredValidators[index]
      const validatorSigners: SignerSet =
        validator.type === 'passkey'
          ? {
              type: 'owner',
              kind: 'passkey',
              accounts: validator.accounts,
              module: getValidator(configuredValidator).address,
            }
          : {
              type: 'owner',
              kind: 'ecdsa',
              accounts: validator.accounts,
              module: getValidator(configuredValidator).address,
            }
      return signMain(
        validatorSigners,
        configuredValidator,
        chain,
        address,
        params,
        isUserOpHash,
        configuredValidator.type === 'passkey',
      )
    }),
  )

  return encodeAbiParameters(
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
      signers.validators.map((validator, index) => ({
        packedValidatorAndId: concat([
          pad(toHex(validator.id), { size: 12 }),
          getValidator(configuredValidators[index]).address,
        ]),
        data: signatures[index],
      })),
    ],
  )
}

async function signWithSession(
  signers: ResolvedSessionSignerSet,
  chain: Chain,
  address: Address,
  hash: Hex,
  signMain: (
    signers: SignerSet,
    configuredOwners: OwnerSet,
    chain: Chain,
    address: Address,
    hash: Hex,
    isUserOpHash: boolean,
  ) => Promise<Hex>,
): Promise<Hex> {
  const sessionSigners: SignerSet = convertOwnerSetToSignerSet(
    signers.session.owners,
  )
  const signedHash = signers.verifyExecutions
    ? hash
    : hashMessage({
        raw: encodePacked(['bytes32', 'bytes32'], [padHex(address), hash]),
      })
  const validatorHash =
    signers.session.owners.type === 'quorum'
      ? getQuorumSignableHash({
          validator: signers.session.owners.module,
          chainId: chain.id,
          account: address,
          hash: signedHash,
        })
      : signedHash
  const validatorSignature = await signMain(
    sessionSigners,
    signers.session.owners,
    chain,
    address,
    validatorHash,
    false,
  )
  return packSmartSessionSignature(signers, validatorSignature)
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

async function selectAccountChain(account: Account, chain: Chain) {
  const transport = account.client?.transport
  if (!transport) return
  const walletClient = createWalletClient({
    chain,
    transport: custom(transport),
    account,
  })
  await walletClient.switchChain({ id: chain.id })
}

async function signQuorumHash(
  signers: SignerSet & { type: 'owner'; kind: 'quorum' },
  configuredOwners: OwnerSet & { type: 'quorum' },
  chain: Chain | undefined,
  hash: Hex,
): Promise<Hex> {
  getQuorumValidator(configuredOwners)
  const configured = new Map(
    configuredOwners.owners.map(({ account, weight }) => [
      account.address.toLowerCase(),
      weight,
    ]),
  )
  const selected = new Set<string>()
  let selectedWeight = 0n
  for (const account of signers.accounts) {
    const ownerId = account.address.toLowerCase()
    const weight = configured.get(ownerId)
    if (weight === undefined) {
      throw new Error(`Unknown validator owner ${ownerId}`)
    }
    if (selected.has(ownerId)) {
      throw new Error(`Duplicate validator owner ${ownerId}`)
    }
    selected.add(ownerId)
    selectedWeight += weight
  }
  if (selectedWeight < configuredOwners.thresholdWeight) {
    throw new Error(
      `Insufficient validator contribution weight: required ${configuredOwners.thresholdWeight}, received ${selectedWeight}`,
    )
  }

  const signatures = await Promise.all(
    signers.accounts.map(async (account) => {
      if (chain) await selectAccountChain(account, chain)
      if (!account.sign) {
        throw new Error('Account does not support raw hash signing')
      }
      return {
        ownerId: account.address.toLowerCase(),
        signature: normalizeRecovery(await account.sign({ hash })),
      }
    }),
  )
  return encodeQuorumOwnerSignatures({
    owners: getQuorumConfigOwners(configuredOwners),
    thresholdWeight: configuredOwners.thresholdWeight,
    signatures,
  })
}

async function signWithOwners<T>(
  signers: SignerSet & { type: 'owner' },
  configuredOwners: OwnerSet,
  chain: Chain,
  address: Address,
  params: T,
  signingFunctions: SigningFunctions<T>,
  isUserOpHash: boolean,
  signMain: (
    signers: SignerSet,
    configuredOwners: OwnerSet,
    chain: Chain,
    address: Address,
    params: T,
    isUserOpHash: boolean,
    statelessPasskey?: boolean,
  ) => Promise<Hex>,
  statelessPasskey = false,
): Promise<Hex> {
  async function signEcdsWithChain(
    account: Account,
    params: T,
    updateV: boolean,
    chain: Chain,
  ): Promise<Hex> {
    await selectAccountChain(account, chain)
    return signingFunctions.signEcdsa(account, params, updateV)
  }

  if (configuredOwners.type === 'quorum' && signers.kind !== 'quorum') {
    throw new Error('Quorum owners require quorum signers')
  }
  if (configuredOwners.type !== 'quorum' && signers.kind === 'quorum') {
    throw new Error('Quorum signers require quorum owners')
  }

  switch (signers.kind) {
    case 'quorum': {
      if (configuredOwners.type !== 'quorum' || typeof params !== 'string') {
        throw new Error('Quorum signing requires a raw hash')
      }
      return encodeQuorumErc1271Signature({
        signatures: await signQuorumHash(
          signers,
          configuredOwners,
          chain,
          params as Hex,
        ),
      })
    }
    case 'ecdsa': {
      // Ownable validator uses `v` value to determine which validation mode to use
      // ENS validator (based on Ownable) also uses the same signature format
      // This is not needed for UserOps
      const isOwnableOrENS =
        !signers.module ||
        signers.module?.toLowerCase() === OWNABLE_VALIDATOR_ADDRESS ||
        signers.module?.toLowerCase() === ENS_HCA_MODULE

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
          challengeIndex: BigInt(signature.webauthn.challengeIndex ?? 0),
          typeIndex: BigInt(signature.webauthn.typeIndex ?? 0),
          r,
          s,
        }
      })
      if (statelessPasskey) {
        if (configuredOwners.type !== 'passkey') {
          throw new Error('Passkey factor configuration is missing')
        }
        return packStatelessPasskeySignature(
          signers.accounts,
          configuredOwners.accounts,
          webAuthns,
        )
      }
      if (signers.module?.toLowerCase() === WEBAUTHN_V0_VALIDATOR_ADDRESS) {
        return packPasskeySignatureV0(webAuthns[0], usePrecompile)
      }
      return packPasskeySignature(credIds, usePrecompile, webAuthns)
    }
    case 'multi-factor': {
      if (configuredOwners.type !== 'multi-factor') {
        throw new Error('Multi-factor owner configuration is missing')
      }
      return signWithMultiFactorAuth(
        signers,
        configuredOwners,
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

function normalizeRecovery(signature: Hex): Hex {
  const bytes = hexToBytes(signature)
  if (bytes.length !== 65 || bytes[64] >= 27) return signature
  return concat([signature.slice(0, -2) as Hex, toHex(bytes[64] + 27)])
}

export {
  convertOwnerSetToSignerSet,
  signWithMultiFactorAuth,
  signQuorumHash,
  signWithSession,
  signWithGuardians,
  signWithOwners,
  type SigningFunctions,
}
