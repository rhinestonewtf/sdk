import { type Hex, hashTypedData, type TypedDataDefinition } from 'viem'
import { describe, expect, test } from 'vitest'
import { withoutHostCollation } from '../../../test/utils/locale'
import {
  isErc6492Signature,
  unwrapErc6492Signature,
  wrapErc6492Signature,
} from './erc6492'
import {
  type Erc7739VerifierDomain,
  encodeErc7739ContentType,
  hashErc7739TypedData,
  wrapErc7739TypedDataSignature,
} from './erc7739'

const factory = '0x1111111111111111111111111111111111111111'
const account = '0x2222222222222222222222222222222222222222'

describe('signing protocol operations', () => {
  test('wraps, detects, and unwraps ERC-6492 exactly', () => {
    const wrapped = wrapErc6492Signature({
      factory,
      factoryData: '0x1234',
      signature: '0xabcd',
    })
    expect(isErc6492Signature(wrapped)).toBe(true)
    expect(unwrapErc6492Signature(wrapped)).toEqual({
      factory,
      factoryData: '0x1234',
      signature: '0xabcd',
    })
    expect(isErc6492Signature('0x1234')).toBe(false)
    expect(() => unwrapErc6492Signature('0x1234')).toThrow('not ERC-6492')
  })

  test('matches the calibrated Solady ERC-7739 digest vector', () => {
    const typedData = {
      domain: {
        name: 'TestApp',
        version: '1',
        chainId: 421614,
        verifyingContract: '0x1234567890abcdef1234567890abcdef12345678',
      },
      types: {
        Greeting: [
          { name: 'text', type: 'string' },
          { name: 'value', type: 'uint256' },
        ],
      },
      primaryType: 'Greeting',
      message: { text: 'Hello', value: 42n },
    } as const
    expect(
      hashErc7739TypedData({
        typedData,
        verifierDomain: {
          name: 'Startale',
          version: '1.0.0',
          chainId: 421614,
          verifyingContract: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
          salt: `0x${'00'.repeat(32)}` as Hex,
        },
      }),
    ).toBe('0xacd2d65e9986501bb617b90505f4b527ee4eac3c29ac4fea21bb74d8e754e61b')
    const wrapped = wrapErc7739TypedDataSignature({
      typedData,
      signature: `0x${'11'.repeat(65)}`,
    })
    expect(wrapped).not.toBe(`0x${'11'.repeat(65)}`)
    expect(hashTypedData(typedData)).toHaveLength(66)
  })

  test('encodes nested ERC-7739 content types canonically', () => {
    const verifierDomain: Erc7739VerifierDomain = {
      name: 'Startale',
      version: '1.0.0',
      chainId: 421614,
      verifyingContract: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      salt: `0x${'00'.repeat(32)}`,
    }
    const domain = {
      name: 'TestApp',
      version: '1',
      chainId: 421614,
      verifyingContract: '0x1234567890abcdef1234567890abcdef12345678' as const,
    }
    const person = [
      { name: 'name', type: 'string' },
      { name: 'wallet', type: 'address' },
    ]
    const attachment = [
      { name: 'uri', type: 'string' },
      { name: 'uploader', type: 'Person' },
    ]
    const mail = [
      { name: 'from', type: 'Person' },
      { name: 'to', type: 'Person' },
      { name: 'contents', type: 'string' },
      { name: 'attachment', type: 'Attachment' },
    ]
    const message = {
      from: { name: 'Alice', wallet: account },
      to: { name: 'Bob', wallet: factory },
      contents: 'Hello',
      attachment: {
        uri: 'ipfs://cid',
        uploader: { name: 'Alice', wallet: account },
      },
    }
    const hash = (
      types: Record<string, { name: string; type: string }[]>,
      data: Record<string, unknown> = message,
    ): Hex =>
      hashErc7739TypedData({
        typedData: {
          domain,
          types,
          primaryType: 'Mail',
          message: data,
        } as unknown as TypedDataDefinition,
        verifierDomain,
      })

    expect(
      encodeErc7739ContentType({
        primaryType: 'Mail',
        types: { Mail: mail, Person: person, Attachment: attachment },
      }),
    ).toBe(
      'Mail(Person from,Person to,string contents,Attachment attachment)Attachment(string uri,Person uploader)Person(string name,address wallet)',
    )
    // The dependency set is discovery-ordered, so the digest is only stable
    // because the shared content encoder sorts it; declaration order must not matter.
    expect(hash({ Mail: mail, Person: person, Attachment: attachment })).toBe(
      hash({ Attachment: attachment, Person: person, Mail: mail }),
    )
    expect(
      hash(
        {
          Mail: mail,
          Person: person,
          Attachment: [...attachment, { name: 'size', type: 'uint256' }],
        },
        { ...message, attachment: { ...message.attachment, size: 1n } },
      ),
    ).not.toBe(hash({ Mail: mail, Person: person, Attachment: attachment }))
  })

  test('orders nested type dependencies by value, not by host collation', () => {
    // `Aardvark` precedes `Zebra` byte-wise but follows it on Danish-family
    // locales, where `aa` is a letter sorting after `z`.
    const types = {
      Note: [
        { name: 'zebra', type: 'Zebra' },
        { name: 'aardvark', type: 'Aardvark' },
      ],
      Zebra: [{ name: 'stripes', type: 'uint256' }],
      Aardvark: [{ name: 'burrows', type: 'uint256' }],
    }
    const hash = withoutHostCollation(() =>
      hashErc7739TypedData({
        typedData: {
          domain: {
            name: 'TestApp',
            version: '1',
            chainId: 1,
            verifyingContract: factory,
          },
          types,
          primaryType: 'Note',
          message: { zebra: { stripes: 1n }, aardvark: { burrows: 2n } },
        } as unknown as TypedDataDefinition,
        verifierDomain: {
          name: 'Startale',
          version: '1.0.0',
          chainId: 1,
          verifyingContract: account,
          salt: `0x${'00'.repeat(32)}`,
        },
      }),
    )
    expect(hash).toBe(
      '0xfe19863b25115aeca4c3c9cf35bb13bac15de5a4ddd39beef7b38eeee6d1f4f5',
    )
  })

  test('hashes only the EIP-712 domain fields the app domain declares', () => {
    const verifierDomain: Erc7739VerifierDomain = {
      name: 'Startale',
      version: '1.0.0',
      chainId: 1,
      verifyingContract: account,
      salt: `0x${'00'.repeat(32)}`,
    }
    const typedData = (domain: Record<string, unknown>) => ({
      typedData: {
        domain,
        types: { Greeting: [{ name: 'text', type: 'string' }] },
        primaryType: 'Greeting',
        message: { text: 'Hello' },
      } as never,
      verifierDomain,
    })
    const full = {
      name: 'TestApp',
      version: '1',
      chainId: 1,
      verifyingContract: account,
      salt: `0x${'11'.repeat(32)}`,
    }

    const nameOnly = hashErc7739TypedData(typedData({ name: 'TestApp' }))
    expect(nameOnly).toHaveLength(66)
    expect(nameOnly).not.toBe(hashErc7739TypedData(typedData(full)))
    expect(
      hashErc7739TypedData(
        typedData({ chainId: 1, verifyingContract: account }),
      ),
    ).not.toBe(nameOnly)
    const { salt: _salt, ...withoutSalt } = full
    expect(hashErc7739TypedData(typedData(withoutSalt))).not.toBe(
      hashErc7739TypedData(typedData(full)),
    )
  })

  test('requires complete ERC-7739 typed data', () => {
    expect(() =>
      hashErc7739TypedData({
        typedData: { domain: {}, types: {}, message: {} } as never,
        verifierDomain: {
          name: 'Test',
          version: '1',
          chainId: 1,
          verifyingContract: account,
          salt: `0x${'00'.repeat(32)}`,
        },
      }),
    ).toThrow('complete')
  })
})
