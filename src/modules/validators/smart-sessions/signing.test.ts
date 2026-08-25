import { domainSeparator, encodePacked, zeroHash } from 'viem'
import { base } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { accountA } from '../../../../test/consts'
import {
  SUDO_POLICY_ADDRESS,
  TIME_FRAME_POLICY_ADDRESS,
} from './policies/addresses'
import { toSession } from './resolve'

const domain = {
  name: 'Permit2',
  chainId: base.id,
  verifyingContract: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
} as const
const permitDetails = [
  { name: 'token', type: 'address' },
  { name: 'amount', type: 'uint160' },
  { name: 'expiration', type: 'uint48' },
  { name: 'nonce', type: 'uint48' },
] as const
const permitSingle = [
  { name: 'details', type: 'PermitDetails' },
  { name: 'spender', type: 'address' },
  { name: 'sigDeadline', type: 'uint256' },
] as const
const permitBatch = [
  { name: 'details', type: 'PermitDetails[]' },
  { name: 'spender', type: 'address' },
  { name: 'sigDeadline', type: 'uint256' },
] as const

function definition() {
  return {
    chain: base,
    owners: { type: 'ecdsa' as const, accounts: [accountA] },
  }
}

describe('Smart Session signing capability', () => {
  test('keeps omission and explicit unrestricted signing identical', () => {
    const omitted = toSession(definition())
    const explicit = toSession({
      ...definition(),
      signing: { mode: 'unrestricted' },
    })

    expect(explicit.permissionId).toBe(omitted.permissionId)
    expect(explicit.erc7739Policies).toEqual({
      allowedERC7739Content: [
        { appDomainSeparator: zeroHash, contentNames: [''] },
      ],
      erc1271Policies: [{ policy: SUDO_POLICY_ADDRESS, initData: '0x' }],
    })
  })

  test('resolves disabled signing to empty contract configuration', () => {
    const session = toSession({
      ...definition(),
      signing: { mode: 'disabled' },
    })
    expect(session.erc7739Policies).toEqual({
      allowedERC7739Content: [],
      erc1271Policies: [],
    })
  })

  test('groups canonical schemas under their exact application domain', () => {
    const session = toSession({
      ...definition(),
      signing: {
        mode: 'scoped',
        allowedContents: [
          {
            domain,
            primaryType: 'PermitSingle',
            types: { PermitSingle: permitSingle, PermitDetails: permitDetails },
          },
          {
            domain,
            primaryType: 'PermitBatch',
            types: { PermitDetails: permitDetails, PermitBatch: permitBatch },
          },
        ],
      },
    })

    expect(session.erc7739Policies.allowedERC7739Content).toEqual([
      {
        appDomainSeparator: domainSeparator({ domain }),
        contentNames: [
          'PermitSingle(PermitDetails details,address spender,uint256 sigDeadline)PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)',
          'PermitBatch(PermitDetails[] details,address spender,uint256 sigDeadline)PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)',
        ],
      },
    ])
  })

  test('selects one time-frame policy and honors address overrides', () => {
    const timeFrame = '0xdeadbeef00000000000000000000000000000001' as const
    const session = toSession({
      ...definition(),
      policyAddresses: { timeFrame },
      signing: {
        mode: 'unrestricted',
        validAfter: new Date(1_000),
        validUntil: new Date(5_999),
      },
    })

    expect(session.erc7739Policies.erc1271Policies).toEqual([
      {
        policy: timeFrame,
        initData: encodePacked(['uint48', 'uint48'], [5, 1]),
      },
    ])
  })

  test('uses the established one-sided time-frame defaults', () => {
    const afterOnly = toSession({
      ...definition(),
      signing: { mode: 'unrestricted', validAfter: new Date(1_000) },
    })
    const untilOnly = toSession({
      ...definition(),
      signing: { mode: 'unrestricted', validUntil: new Date(5_000) },
    })

    expect(afterOnly.erc7739Policies.erc1271Policies).toEqual([
      {
        policy: TIME_FRAME_POLICY_ADDRESS,
        initData: encodePacked(['uint48', 'uint48'], [4_102_444_800, 1]),
      },
    ])
    expect(untilOnly.erc7739Policies.erc1271Policies).toEqual([
      {
        policy: TIME_FRAME_POLICY_ADDRESS,
        initData: encodePacked(['uint48', 'uint48'], [5, 0]),
      },
    ])
  })

  test('rejects invalid scoped content', () => {
    expect(() =>
      toSession({
        ...definition(),
        signing: {
          mode: 'scoped',
          allowedContents: [
            {
              domain: {
                ...domain,
                verifyingContracts: domain.verifyingContract,
              },
              primaryType: 'Permit',
              types: { Permit: [{ name: 'value', type: 'uint256' }] },
            },
          ],
        } as never,
      }),
    ).toThrow('Unsupported EIP-712 domain field "verifyingContracts"')
    expect(() =>
      toSession({
        ...definition(),
        signing: {
          mode: 'scoped',
          allowedContents: [
            {
              domain,
              primaryType: 'Permit',
              types: { Permit: [{ name: 'values', type: 'uint256[0]' }] },
            },
          ],
        },
      }),
    ).toThrow('not a valid EIP-712 type')
    for (const type of ['uint', 'int']) {
      expect(() =>
        toSession({
          ...definition(),
          signing: {
            mode: 'scoped',
            allowedContents: [
              {
                domain,
                primaryType: 'Permit',
                types: {
                  Permit: [{ name: 'value', type }],
                  [type]: [],
                },
              },
            ],
          } as never,
        }),
      ).toThrow(`type "${type}" is not a valid EIP-712 type`)
    }
    expect(() =>
      toSession({
        ...definition(),
        signing: {
          mode: 'scoped',
          allowedContents: [
            {
              domain,
              primaryType: 'Permit',
              types: {
                Permit: [
                  { name: 'value', type: 'uint256' },
                  { name: 'value', type: 'address' },
                ],
              },
            },
          ],
        },
      }),
    ).toThrow('duplicate field "value"')
    expect(() =>
      toSession({
        ...definition(),
        signing: {
          mode: 'scoped',
          allowedContents: [
            {
              domain,
              primaryType: 'EIP712Domain',
              types: { EIP712Domain: [] },
            },
          ],
        },
      }),
    ).toThrow('cannot be a scoped signing primary type')
    expect(() =>
      toSession({
        ...definition(),
        signing: { mode: 'scoped', allowedContents: [] },
      }),
    ).toThrow('at least one')
    expect(() =>
      toSession({
        ...definition(),
        signing: {
          mode: 'scoped',
          allowedContents: [{ domain, primaryType: 'Missing', types: {} }],
        },
      }),
    ).toThrow('primary type "Missing" is missing')
    expect(() =>
      toSession({
        ...definition(),
        signing: {
          mode: 'scoped',
          allowedContents: [
            {
              domain,
              primaryType: 'PermitSingle',
              types: { PermitSingle: permitSingle },
            },
          ],
        },
      }),
    ).toThrow('type "PermitDetails" is missing')
  })

  test('rejects duplicate resolved domain and schema pairs', () => {
    expect(() =>
      toSession({
        ...definition(),
        signing: {
          mode: 'scoped',
          allowedContents: [
            {
              domain,
              primaryType: 'PermitSingle',
              types: {
                PermitSingle: permitSingle,
                PermitDetails: permitDetails,
              },
            },
            {
              domain: { ...domain },
              primaryType: 'PermitSingle',
              types: {
                PermitDetails: permitDetails,
                PermitSingle: permitSingle,
              },
            },
          ],
        },
      }),
    ).toThrow('Duplicate scoped signing content')
  })

  test('rejects invalid and inverted validity windows after second normalization', () => {
    expect(() =>
      toSession({
        ...definition(),
        signing: {
          mode: 'disabled',
          validUntil: new Date(),
        } as never,
      }),
    ).toThrow('Disabled session signing cannot have a validity window')
    expect(() =>
      toSession({
        ...definition(),
        signing: { mode: 'unrestricted', validAfter: new Date(Number.NaN) },
      }),
    ).toThrow('valid Date')
    expect(() =>
      toSession({
        ...definition(),
        signing: { mode: 'unrestricted', validAfter: new Date(-1) },
      }),
    ).toThrow('uint48 range')
    expect(() =>
      toSession({
        ...definition(),
        signing: {
          mode: 'unrestricted',
          validAfter: new Date(2_000),
          validUntil: new Date(1_999),
        },
      }),
    ).toThrow('validUntil is before validAfter')
  })
})
