import {
  type Address,
  concat,
  domainSeparator,
  encodeAbiParameters,
  type Hex,
  hashDomain,
  hashStruct,
  keccak256,
  type TypedData,
  type TypedDataDefinition,
  type TypedDataDomain,
  toHex,
} from 'viem'
import { wrapTypedDataSignature } from 'viem/experimental/erc7739'
import {
  encodeEip712Data,
  encodeErc7739ContentType,
} from '../../modules/validators/smart-sessions/erc7739'

export { encodeErc7739ContentType }

export interface Erc7739VerifierDomain {
  readonly name: string
  readonly version: string
  readonly chainId: number
  readonly verifyingContract: Address
  readonly salt: Hex
}

export function hashErc7739TypedData(input: {
  readonly typedData: TypedDataDefinition
  readonly verifierDomain: Erc7739VerifierDomain
}): Hex {
  const { domain, types, primaryType, message } = input.typedData
  if (!domain || !primaryType) {
    throw new Error('ERC-7739 requires a complete typed-data definition')
  }
  const typeFields = types as Record<
    string,
    readonly { readonly name: string; readonly type: string }[]
  >
  const contentsType = encodeErc7739ContentType({
    primaryType,
    types: typeFields,
  })
  const structHash = hashErc7739TypedDataSign({
    primaryType,
    contentsType,
    contents: hashStruct({
      data: message as Record<string, unknown>,
      primaryType,
      types: typeFields,
    }),
    verifierDomain: input.verifierDomain,
  })
  const domainTypes = []
  if (domain.name) domainTypes.push({ name: 'name', type: 'string' })
  if (domain.version) domainTypes.push({ name: 'version', type: 'string' })
  if (domain.chainId) domainTypes.push({ name: 'chainId', type: 'uint256' })
  if (domain.verifyingContract) {
    domainTypes.push({ name: 'verifyingContract', type: 'address' })
  }
  if (domain.salt) domainTypes.push({ name: 'salt', type: 'bytes32' })
  const appDomainSeparator = hashDomain({
    domain,
    types: { EIP712Domain: domainTypes },
  } as Parameters<typeof hashDomain>[0])
  return keccak256(concat(['0x1901', appDomainSeparator, structHash]))
}

/** `hashStruct(TypedDataSign)` for `contents`, a struct hash of type `contentsType`. */
function hashErc7739TypedDataSign(input: {
  readonly primaryType: string
  readonly contentsType: string
  readonly contents: Hex
  readonly verifierDomain: Erc7739VerifierDomain
}): Hex {
  const typedDataSignTypeHash = keccak256(
    toHex(
      `TypedDataSign(${input.primaryType} contents,string name,string version,uint256 chainId,address verifyingContract,bytes32 salt)${input.contentsType}`,
    ),
  )
  const verifier = input.verifierDomain
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'uint256' },
        { type: 'address' },
        { type: 'bytes32' },
      ],
      [
        typedDataSignTypeHash,
        input.contents,
        keccak256(toHex(verifier.name)),
        keccak256(toHex(verifier.version)),
        BigInt(verifier.chainId),
        verifier.verifyingContract,
        verifier.salt,
      ],
    ),
  )
}

/**
 * The parts of a Smart Session ERC-7739 signature: the `TypedDataSign` digest
 * the session signs, and the app domain separator, `contentsType` and
 * `encodeData` the emissary rebuilds the signed contents from.
 */
export function prepareSmartSessionErc7739Signing(input: {
  readonly typedData: TypedDataDefinition
  readonly verifierDomain: Erc7739VerifierDomain
}): {
  readonly appDomainSeparator: Hex
  readonly contentsType: string
  readonly encodeData: Hex
  readonly digest: Hex
} {
  const { domain, types, primaryType, message } = input.typedData
  if (!primaryType) {
    throw new Error('ERC-7739 requires a complete typed-data definition')
  }
  const typeFields = types as Record<
    string,
    readonly { readonly name: string; readonly type: string }[]
  >
  const appDomainSeparator = domainSeparator({ domain: domain ?? {} })
  const contentsType = encodeErc7739ContentType({
    primaryType,
    types: typeFields,
  })
  const encodeData = encodeEip712Data({
    primaryType,
    types: typeFields,
    message: message as Record<string, unknown>,
  })
  const structHash = hashErc7739TypedDataSign({
    primaryType,
    contentsType,
    contents: keccak256(concat([keccak256(toHex(contentsType)), encodeData])),
    verifierDomain: input.verifierDomain,
  })
  return {
    appDomainSeparator,
    contentsType,
    encodeData,
    digest: keccak256(concat(['0x1901', appDomainSeparator, structHash])),
  }
}

export function wrapErc7739TypedDataSignature(input: {
  readonly typedData: TypedDataDefinition
  readonly signature: Hex
}): Hex {
  const typedData = input.typedData
  return wrapTypedDataSignature({
    domain: typedData.domain as TypedDataDomain,
    primaryType: typedData.primaryType as string,
    types: typedData.types as TypedData,
    message: typedData.message as Record<string, unknown>,
    signature: input.signature,
  })
}
