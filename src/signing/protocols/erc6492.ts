import {
  type Address,
  concat,
  decodeAbiParameters,
  encodeAbiParameters,
  type Hex,
  size,
  slice,
} from 'viem'

export const ERC6492_MAGIC_BYTES =
  '0x6492649264926492649264926492649264926492649264926492649264926492' as const

export interface Erc6492Signature {
  readonly factory: Address
  readonly factoryData: Hex
  readonly signature: Hex
}

export function isErc6492Signature(signature: Hex): boolean {
  return (
    size(signature) >= 32 &&
    slice(signature, size(signature) - 32).toLowerCase() === ERC6492_MAGIC_BYTES
  )
}

export function wrapErc6492Signature(input: Erc6492Signature): Hex {
  return concat([
    encodeAbiParameters(
      [
        { name: 'create2Factory', type: 'address' },
        { name: 'factoryCalldata', type: 'bytes' },
        { name: 'originalERC1271Signature', type: 'bytes' },
      ],
      [input.factory, input.factoryData, input.signature],
    ),
    ERC6492_MAGIC_BYTES,
  ])
}

export function unwrapErc6492Signature(signature: Hex): Erc6492Signature {
  if (!isErc6492Signature(signature)) {
    throw new Error('Signature is not ERC-6492 encoded')
  }
  const encoded = slice(signature, 0, size(signature) - 32)
  const [factory, factoryData, originalSignature] = decodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes' }, { type: 'bytes' }],
    encoded,
  )
  return { factory, factoryData, signature: originalSignature }
}
