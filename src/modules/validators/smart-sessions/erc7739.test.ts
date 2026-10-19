import {
  concat,
  type Hex,
  hashStruct,
  keccak256,
  type TypedData,
  toHex,
} from 'viem'
import { describe, expect, test } from 'vitest'
import { encodeEip712Data, encodeErc7739ContentType } from './erc7739'

const word = (byte: string) => `0x${byte.repeat(32)}` as Hex
const address = (byte: string) => `0x${byte.repeat(20)}` as Hex

const shapes: readonly {
  readonly label: string
  readonly types: TypedData
  readonly primaryType: string
  readonly message: Record<string, unknown>
}[] = [
  {
    label: 'atomic fields',
    types: {
      Atomic: [
        { name: 'flag', type: 'bool' },
        { name: 'small', type: 'uint8' },
        { name: 'big', type: 'uint256' },
        { name: 'negative', type: 'int64' },
        { name: 'who', type: 'address' },
        { name: 'selector', type: 'bytes4' },
        { name: 'id', type: 'bytes32' },
      ],
    },
    primaryType: 'Atomic',
    message: {
      flag: true,
      small: 255,
      big: 2n ** 256n - 1n,
      negative: -(2n ** 63n),
      who: address('ab'),
      selector: '0xa9059cbb',
      id: word('cd'),
    },
  },
  {
    label: 'string and bytes',
    types: {
      Dynamic: [
        { name: 'text', type: 'string' },
        { name: 'payload', type: 'bytes' },
        { name: 'empty', type: 'string' },
        { name: 'none', type: 'bytes' },
      ],
    },
    primaryType: 'Dynamic',
    message: {
      text: 'Grüße, 世界',
      payload: toHex(new Uint8Array(70).map((_, index) => index)),
      empty: '',
      none: '0x',
    },
  },
  {
    label: 'dynamic, fixed and nested arrays',
    types: {
      Arrays: [
        { name: 'amounts', type: 'uint256[]' },
        { name: 'grid', type: 'uint16[3]' },
        { name: 'memos', type: 'string[]' },
        { name: 'blobs', type: 'bytes[2]' },
        { name: 'matrix', type: 'address[][]' },
        { name: 'nothing', type: 'bytes32[]' },
      ],
    },
    primaryType: 'Arrays',
    message: {
      amounts: [1n, 2n, 3n],
      grid: [7, 8, 9],
      memos: ['a', 'bc'],
      blobs: ['0x01', '0x'],
      matrix: [[address('11'), address('22')], [], [address('33')]],
      nothing: [],
    },
  },
  {
    label: 'nested structs',
    types: {
      Mail: [
        { name: 'from', type: 'Person' },
        { name: 'to', type: 'Person' },
        { name: 'contents', type: 'string' },
      ],
      Person: [
        { name: 'name', type: 'string' },
        { name: 'wallet', type: 'address' },
      ],
    },
    primaryType: 'Mail',
    message: {
      from: { name: 'Cow', wallet: address('cd') },
      to: { name: 'Bob', wallet: address('bb') },
      contents: 'Hello, Bob!',
    },
  },
  {
    label: 'arrays of structs, three levels deep',
    types: {
      Outer: [
        { name: 'items', type: 'Item[]' },
        { name: 'pair', type: 'Item[2]' },
        { name: 'owner', type: 'address' },
      ],
      Item: [
        { name: 'token', type: 'address' },
        { name: 'leaves', type: 'Leaf[]' },
      ],
      Leaf: [
        { name: 'data', type: 'bytes' },
        { name: 'tags', type: 'bytes32[]' },
      ],
    },
    primaryType: 'Outer',
    message: {
      items: [
        {
          token: address('44'),
          leaves: [{ data: '0xabcdef', tags: [word('01')] }],
        },
        { token: address('55'), leaves: [] },
      ],
      pair: [
        { token: address('66'), leaves: [{ data: '0x', tags: [] }] },
        { token: address('77'), leaves: [] },
      ],
      owner: address('88'),
    },
  },
]

describe('encodeEip712Data', () => {
  test.each(shapes.map((shape) => [shape.label, shape] as const))(
    "%s: keccak(keccak(contentsType) ‖ encodeData) is viem's struct hash",
    (_label, { types, primaryType, message }) => {
      const encodeData = encodeEip712Data({ primaryType, types, message })
      const typeHash = keccak256(
        toHex(encodeErc7739ContentType({ primaryType, types })),
      )

      expect(keccak256(concat([typeHash, encodeData]))).toBe(
        hashStruct({ data: message, primaryType, types }),
      )
      expect((encodeData.length - 2) / 64).toBe(types[primaryType]?.length)
    },
  )

  test('encodes a struct with no fields as empty data', () => {
    expect(
      encodeEip712Data({
        primaryType: 'Empty',
        types: { Empty: [] },
        message: {},
      }),
    ).toBe('0x')
  })

  test('refuses a primary type missing from types', () => {
    expect(() =>
      encodeEip712Data({ primaryType: 'Missing', types: {}, message: {} }),
    ).toThrow('EIP-712 type "Missing" is missing from types')
  })
})
