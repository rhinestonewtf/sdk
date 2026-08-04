import fc from 'fast-check'
import { bytesToHex, type Hex, keccak256, size, zeroHash } from 'viem'
import { describe, expect, test } from 'vitest'
import { fastLzCompress, fastLzDecompress } from './fast-lz'
import { encodeSmartSessionEnablePayload } from './signature'

const address = '0x1111111111111111111111111111111111111111' as const
const otherAddress = '0x2222222222222222222222222222222222222222' as const
const permissionId = `0x${'33'.repeat(32)}` as Hex
const validatorSignature = `0x${'44'.repeat(65)}` as Hex

function repeated(length: number, value = 0): Hex {
  return bytesToHex(new Uint8Array(length).fill(value))
}

function sequence(length: number): Hex {
  return bytesToHex(Uint8Array.from({ length }, (_, index) => index & 0xff))
}

function enablePayload(chainCount: number, withPolicies: boolean): Hex {
  return encodeSmartSessionEnablePayload({
    permissionId,
    signature: validatorSignature,
    enableData: {
      userSignature: `0x${'55'.repeat(65)}`,
      hashesAndChainIds: Array.from({ length: chainCount }, (_, index) => ({
        chainId: BigInt(index + 1),
        sessionDigest:
          `0x${(index + 1).toString(16).padStart(2, '0').repeat(32)}` as Hex,
      })),
      sessionToEnableIndex: 0,
      session: {
        sessionValidator: address,
        sessionValidatorInitData: '0x1234',
        salt: zeroHash,
        actions: withPolicies
          ? [
              {
                actionTargetSelector: '0xa9059cbb',
                actionTarget: otherAddress,
                actionPolicies: [{ policy: address, initData: '0x01020304' }],
              },
            ]
          : [],
        claimPolicies: withPolicies
          ? [{ policy: otherAddress, initData: '0xaabbccdd' }]
          : [],
        erc7739Policies: {
          allowedERC7739Content: withPolicies
            ? [
                {
                  appDomainSeparator: permissionId,
                  contentNames: ['Transfer(address,uint256)', 'Permit'],
                },
              ]
            : [],
          erc1271Policies: withPolicies
            ? [{ policy: address, initData: '0xdeadbeef' }]
            : [],
        },
      },
    },
  })
}

const arbitraryHex = fc
  .uint8Array({ maxLength: 12_000 })
  .map((bytes) => bytesToHex(bytes))

const repeatedHex = fc
  .record({
    chunk: fc.uint8Array({ minLength: 1, maxLength: 64 }),
    repeats: fc.integer({ min: 1, max: 256 }),
    suffix: fc.uint8Array({ maxLength: 64 }),
  })
  .map(({ chunk, repeats, suffix }) => {
    const bytes = new Uint8Array(chunk.length * repeats + suffix.length)
    for (let index = 0; index < repeats; index++) {
      bytes.set(chunk, index * chunk.length)
    }
    bytes.set(suffix, chunk.length * repeats)
    return bytesToHex(bytes)
  })

describe('FastLZ', () => {
  test('matches golden boundary vectors', () => {
    const vectors = {
      empty: '0x' as Hex,
      short: '0x000102' as Hex,
      literalBlock: sequence(32),
      literalBlockBoundary: sequence(33),
      shortMatch: repeated(32),
      extendedMatch: repeated(269),
      extendedMatchBoundary: repeated(271),
      splitMatch: repeated(272),
    }

    const compressed = Object.fromEntries(
      Object.entries(vectors).map(([name, input]) => [
        name,
        fastLzCompress(input),
      ]),
    )
    expect(compressed).toMatchInlineSnapshot(`
      {
        "empty": "0x",
        "extendedMatch": "0x010000e0fd01040000000000",
        "extendedMatchBoundary": "0x010000e0ff01040000000000",
        "literalBlock": "0x1f000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
        "literalBlockBoundary": "0x1f000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f0020",
        "short": "0x02000102",
        "shortMatch": "0x010000e01001040000000000",
        "splitMatch": "0x010000e0fd012001040000000000",
      }
    `)
  })

  test('matches the golden distance-window vector', () => {
    const bytes = new Uint8Array(8_260)
    for (let index = 0; index < bytes.length; index++) {
      bytes[index] = (index * 131 + (index >> 3)) & 0xff
    }
    bytes.set(bytes.slice(0, 64), 8_190)
    const input = bytesToHex(bytes)
    const compressed = fastLzCompress(input)

    expect({
      bytes: size(compressed),
      hash: keccak256(compressed),
    }).toMatchInlineSnapshot(`
        {
          "bytes": 1133,
          "hash": "0xff6866815afefb2e1817673beede5e19c5f59b1dd8c0f88c5fab5dc5b53e7cf1",
        }
      `)
  })

  test('matches golden realistic enable payloads', () => {
    const payloads = {
      singleChain: enablePayload(1, false),
      multiChainWithPolicies: enablePayload(3, true),
    }
    const compressed = Object.fromEntries(
      Object.entries(payloads).map(([name, input]) => [
        name,
        fastLzCompress(input),
      ]),
    )

    expect(compressed).toMatchInlineSnapshot(`
      {
        "multiChainWithPolicies": "0x010000e0140100c0e0141de019000006e017220033e01600e0153f0008e0179f0080e0153f0200c0ffe016002023e01200010140e0121c400000204004e03200014155e03700e0327ce01a000060e01523e1181f0003e0153f010001e017002023e013000002e01700e0133c20000003e017002023e000000011e00a00e0001ce00d00e217bfe01600e018fee1169f0003e2179f02021234e01682e01500e017a00420a9059cbbe01542e001000022e00a00e0011de00c00e016ffe0199f2023e00000e10adee117dfe4171f040401020304e00060e02900e1185fe00352e10a3ee1173fe018bf03aabbccdde00363e02600e0165f0101a0e0164fe018ffe6165ee6165fe0179f0000e4173fe016dfe6189f19195472616e7366657228616464726573732c75696e7432353629203ce01a0006065065726d6974e01a29e00d00e1185fe00336230ee00800e0031fe00a00e1171f0404deadbeefe00a37e01f00014144e03700e01169040000000000",
        "singleChain": "0x010000e0140100c0e0141de019000006e017220033e01600e0153f010480e0151f0000e0171f01c0ffe016002043e01200010140e0121c400000204004e03200014155e03700e0327ce01a000060e01623e2173f0001e0163f0001e01700e0033f0011e00a00e0031fe00a00e0179fe01600e0047ee00a000001e116ffe2183f02021234e00a56e06100e217dfe117ffe03700014144e03700e01181040000000000",
      }
    `)
    for (const [name, input] of Object.entries(payloads)) {
      expect(fastLzDecompress(compressed[name] as Hex)).toBe(input)
    }
  })

  test('round-trips arbitrary byte strings', () => {
    fc.assert(
      fc.property(arbitraryHex, (input) => {
        expect(fastLzDecompress(fastLzCompress(input))).toBe(input)
      }),
      { numRuns: 250 },
    )
  })

  test('round-trips repetition-heavy byte strings', () => {
    fc.assert(
      fc.property(repeatedHex, (input) => {
        expect(fastLzDecompress(fastLzCompress(input))).toBe(input)
      }),
      { numRuns: 250 },
    )
  })
})
