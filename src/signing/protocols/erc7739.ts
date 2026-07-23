import {
  type Address,
  concat,
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
  const contentsType = encodeType(primaryType, typeFields)
  const typedDataSignTypeHash = keccak256(
    toHex(
      `TypedDataSign(${primaryType} contents,string name,string version,uint256 chainId,address verifyingContract,bytes32 salt)${contentsType}`,
    ),
  )
  const contentsHash = hashStruct({
    data: message as Record<string, unknown>,
    primaryType,
    types: typeFields,
  })
  const verifier = input.verifierDomain
  const structHash = keccak256(
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
        contentsHash,
        keccak256(toHex(verifier.name)),
        keccak256(toHex(verifier.version)),
        BigInt(verifier.chainId),
        verifier.verifyingContract,
        verifier.salt,
      ],
    ),
  )
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

function encodeType(
  primaryType: string,
  types: Readonly<
    Record<string, readonly { readonly name: string; readonly type: string }[]>
  >,
): string {
  const dependencies = new Set<string>()
  const collect = (type: string): void => {
    const typeName = type.match(/^\w*/)?.[0]
    if (!typeName || dependencies.has(typeName) || !types[typeName]) return
    dependencies.add(typeName)
    for (const field of types[typeName]) collect(field.type)
  }
  collect(primaryType)
  dependencies.delete(primaryType)
  return [primaryType, ...dependencies]
    .sort((left, right) => {
      if (left === primaryType) return -1
      if (right === primaryType) return 1
      return left.localeCompare(right)
    })
    .map(
      (type) =>
        `${type}(${types[type].map((field) => `${field.type} ${field.name}`).join(',')})`,
    )
    .join('')
}
