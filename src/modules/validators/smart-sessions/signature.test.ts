import { type Hex, hexToNumber, size, slice, toHex } from 'viem'
import { describe, expect, test } from 'vitest'
import {
  encodeErc7739ContentTail,
  encodeSmartSessionContribution,
} from './signature'

const permissionId = `0x${'aa'.repeat(32)}` as Hex
const signature = `0x${'bb'.repeat(65)}` as Hex
const claimPolicyData = '0xc0ffee' as Hex
const content = {
  appDomainSeparator: `0x${'dd'.repeat(32)}` as Hex,
  contentsType: 'Test(uint256 value,bytes32 id)',
  encodeData: `0x${'01'.repeat(32)}${'02'.repeat(32)}` as Hex,
}

describe('ERC-7739 Smart Session signature', () => {
  test('lays out the mode 0x01 envelope byte for byte', () => {
    const encoded = encodeSmartSessionContribution({
      mode: 'notarized-typed',
      permissionId,
      signature,
      claimPolicyData,
      erc7739: content,
    })
    const contentsType = toHex(content.contentsType)
    let offset = 0
    const take = (length: number) => {
      const part = slice(encoded, offset, offset + length)
      offset += length
      return part
    }

    expect(take(1)).toBe('0x01')
    expect(take(32)).toBe(permissionId)
    expect(hexToNumber(take(32))).toBe(64 + 65)
    expect(take(65)).toBe(signature)
    expect(take(3)).toBe(claimPolicyData)
    expect(take(32)).toBe(content.appDomainSeparator)
    expect(take(64)).toBe(content.encodeData)
    expect(take(size(contentsType))).toBe(contentsType)
    expect(hexToNumber(take(2))).toBe(2)
    expect(hexToNumber(take(2))).toBe(size(contentsType))
    expect(offset).toBe(size(encoded))
  })

  test('shares its head with the direct envelope apart from the mode byte', () => {
    const direct = encodeSmartSessionContribution({
      mode: 'notarized',
      permissionId,
      signature,
      claimPolicyData,
    })
    const typed = encodeSmartSessionContribution({
      mode: 'notarized-typed',
      permissionId,
      signature,
      claimPolicyData,
      erc7739: content,
    })

    expect(slice(direct, 0, 1)).toBe('0x00')
    expect(slice(typed, 1, size(direct))).toBe(slice(direct, 1))
    expect(slice(typed, size(direct))).toBe(encodeErc7739ContentTail(content))
  })

  test('omits the policy data when there is none', () => {
    const encoded = encodeSmartSessionContribution({
      mode: 'notarized-typed',
      permissionId,
      signature,
      erc7739: content,
    })

    expect(slice(encoded, 1 + 32 + 32 + 65, 1 + 32 + 32 + 65 + 32)).toBe(
      content.appDomainSeparator,
    )
  })

  test('requires the typed content', () => {
    expect(() =>
      encodeSmartSessionContribution({
        mode: 'notarized-typed',
        permissionId,
        signature,
      }),
    ).toThrow('ERC-7739 session signatures require typed content')
  })

  test.each([
    {
      label: 'encodeData that is not whole words',
      content: { ...content, encodeData: '0x01' as Hex },
      error: 'ERC-7739 encodeData must be at most 65535 32-byte words',
    },
    {
      label: 'more than 65535 encodeData words',
      content: {
        ...content,
        encodeData: `0x${'00'.repeat(32 * 65536)}` as Hex,
      },
      error: 'ERC-7739 encodeData must be at most 65535 32-byte words',
    },
    {
      label: 'an empty contentsType',
      content: { ...content, contentsType: '' },
      error: 'ERC-7739 contentsType must be 1 to 65535 bytes',
    },
    {
      label: 'a contentsType over 65535 bytes',
      content: { ...content, contentsType: 'A'.repeat(65536) },
      error: 'ERC-7739 contentsType must be 1 to 65535 bytes',
    },
  ])('refuses $label', ({ content, error }) => {
    expect(() => encodeErc7739ContentTail(content)).toThrow(error)
  })
})
