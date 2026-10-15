import {
  encodeAbiParameters,
  type Hex,
  hashStruct,
  keccak256,
  toHex,
} from 'viem'

type TypeFields = Readonly<
  Record<string, readonly { readonly name: string; readonly type: string }[]>
>

export function encodeErc7739ContentType(input: {
  readonly primaryType: string
  readonly types: TypeFields
}): string {
  const { primaryType, types } = input
  const dependencies = new Set<string>()
  const collect = (type: string): void => {
    const typeName = type.match(/^\w*/)?.[0]
    if (!typeName || dependencies.has(typeName) || !types[typeName]) return
    dependencies.add(typeName)
    for (const field of types[typeName]) collect(field.type)
  }
  collect(primaryType)
  dependencies.delete(primaryType)
  return [primaryType, ...[...dependencies].sort()]
    .map(
      (type) =>
        `${type}(${types[type].map((field) => `${field.type} ${field.name}`).join(',')})`,
    )
    .join('')
}

/**
 * EIP-712 `encodeData` of a struct: `hashStruct` is
 * `keccak256(typeHash ‖ encodeEip712Data(...))`.
 */
export function encodeEip712Data(input: {
  readonly primaryType: string
  readonly types: TypeFields
  readonly message: Readonly<Record<string, unknown>>
}): Hex {
  const fields = input.types[input.primaryType]
  if (!fields) {
    throw new Error(`EIP-712 type "${input.primaryType}" is missing from types`)
  }
  const words = fields.map((field) =>
    encodeEip712Field(input.types, field.type, input.message[field.name]),
  )
  return encodeAbiParameters(
    words.map(([type]) => ({ type })),
    words.map(([, value]) => value),
  )
}

function encodeEip712Field(
  types: TypeFields,
  type: string,
  value: unknown,
): readonly [string, unknown] {
  if (types[type]) {
    return [
      'bytes32',
      hashStruct({
        data: value as Record<string, unknown>,
        primaryType: type,
        types: types as Record<string, { name: string; type: string }[]>,
      }),
    ]
  }
  if (type === 'bytes') return ['bytes32', keccak256(value as Hex)]
  if (type === 'string') return ['bytes32', keccak256(toHex(value as string))]
  if (type.endsWith(']')) {
    const elementType = type.slice(0, type.lastIndexOf('['))
    const elements = (value as readonly unknown[]).map((element) =>
      encodeEip712Field(types, elementType, element),
    )
    return [
      'bytes32',
      keccak256(
        encodeAbiParameters(
          elements.map(([elementAbiType]) => ({ type: elementAbiType })),
          elements.map(([, elementValue]) => elementValue),
        ),
      ),
    ]
  }
  return [type, value]
}
