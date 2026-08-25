import { decodeAbiParameters, maxUint48, size } from 'viem'
import { describe, expect, test } from 'vitest'
import {
  accountA,
  accountB,
  accountC,
  collationAccountHigh,
  collationAccountLow,
  passkeyAccount,
} from '../../../test/consts'
import { withoutHostCollation } from '../../../test/utils/locale'
import { resolveStandaloneAccountConfig } from '../../config/resolve'
import { getValidatorCapabilities } from './capabilities'
import { resolveEnsValidator } from './ens'
import {
  MULTI_FACTOR_VALIDATOR_ADDRESS,
  MULTI_FACTOR_VALIDATOR_V2_ADDRESS,
} from './multi-factor'
import {
  encodeOwnableMockSignature,
  OWNABLE_V0_VALIDATOR_ADDRESS,
  resolveOwnableValidator,
} from './ownable'
import { resolveAtomicValidator, resolveValidator } from './resolve'
import type { AtomicValidatorDefinition } from './types'
import {
  parseWebauthnPublicKey,
  resolveWebauthnCredentials,
  resolveWebauthnValidator,
  WEBAUTHN_MOCK_SIGNATURE,
} from './webauthn'

function validator(
  input: Parameters<typeof resolveStandaloneAccountConfig>[0]['owners'],
) {
  const config = resolveStandaloneAccountConfig({ owners: input }, 'current-v2')
  if (!config.owners) throw new Error('missing validator')
  return config.owners
}

describe('validator resolution', () => {
  test('matches exact ownable bytes and canonical owner order', () => {
    const module = resolveValidator(
      validator({
        type: 'ecdsa',
        accounts: [accountA, accountB, accountC],
        threshold: 2,
      }),
    )
    expect(module.address).toBe('0x000000000013fdb5234e4e3162a810f54d9f7e98')
    expect(module.initData).toBe(
      '0x0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000030000000000000000000000006092086a3dc0020cd604a68fcf5d430007d51bb7000000000000000000000000c27b7578151c5ef713c62c65db09763d57ac3596000000000000000000000000f6c02c78ded62973b43bfa523b247da099486936',
    )
    expect(size(encodeOwnableMockSignature(3))).toBe(195)
  })

  test('matches exact WebAuthn module bytes and mock schema', () => {
    const module = resolveValidator(
      validator({ type: 'passkey', accounts: [passkeyAccount] }),
    )
    expect(module.address).toBe('0x0000000000578c4cb0e472a5462da43c495c3f33')
    expect(module.initData).toBe(
      '0x000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001580a9af0569ad3905b26a703201b358aa0904236642ebe79b22a19d00d3737637d46f725a5427ae45a9569259bf67e1e16b187d7b3ad1ed70138c4f0409677d10000000000000000000000000000000000000000000000000000000000000000',
    )
    expect(() =>
      decodeAbiParameters(
        [
          { type: 'bytes' },
          { type: 'string' },
          { type: 'uint256' },
          { type: 'uint256' },
          { type: 'uint256' },
          { type: 'uint256' },
        ],
        WEBAUTHN_MOCK_SIGNATURE,
      ),
    ).not.toThrow()
  })

  test('materializes nested MFA with stable ids and the registry-free module', () => {
    const module = resolveValidator(
      validator({
        type: 'multi-factor',
        threshold: 1,
        module: MULTI_FACTOR_VALIDATOR_V2_ADDRESS,
        validators: [
          { type: 'ecdsa', accounts: [accountA] },
          { type: 'passkey', accounts: [passkeyAccount] },
        ],
      }),
    )
    expect(module.address).toBe(MULTI_FACTOR_VALIDATOR_V2_ADDRESS)
    expect(module.initData.startsWith('0x01')).toBe(true)
  })

  test('selects default MFA modules and exposes signing capabilities', () => {
    const nested = validator({
      type: 'multi-factor',
      validators: [
        { type: 'ecdsa', accounts: [accountA] },
        { type: 'passkey', accounts: [passkeyAccount] },
      ],
    })
    const module = resolveValidator(nested)
    expect(module.address).toBe(MULTI_FACTOR_VALIDATOR_ADDRESS)
    const capabilities = getValidatorCapabilities(
      nested,
      module,
      'safe-current',
      'intent',
      true,
    )
    expect(capabilities.signerTopology).toBe('nested-threshold')
    expect(capabilities.recoveryEncoding).toBe('ethereum')
    expect(capabilities.contributionCodec.kind).toBe('nested-threshold')
    expect(capabilities.supportsOriginReuse).toBe(true)

    const threshold = validator({
      type: 'ecdsa',
      accounts: [accountA, accountB],
      threshold: 2,
    })
    const legacy = {
      ...resolveValidator(threshold),
      address: OWNABLE_V0_VALIDATOR_ADDRESS,
    }
    const legacyCapabilities = getValidatorCapabilities(
      threshold,
      legacy,
      'safe-v0',
      'user-operation',
      false,
    )
    expect(legacyCapabilities.signerTopology).toBe('threshold')
    expect(legacyCapabilities.supportsEip712).toBe(false)
    expect(legacyCapabilities.contributionCodec.kind).toBe('ordered-threshold')

    const single = validator({ type: 'ecdsa', accounts: [accountA] })
    expect(
      getValidatorCapabilities(
        single,
        resolveValidator(single),
        'nexus',
        'erc1271',
        true,
      ).signerTopology,
    ).toBe('single')

    const passkeys = validator({
      type: 'passkey',
      accounts: [
        passkeyAccount,
        { ...passkeyAccount, publicKey: `0x04${'33'.repeat(64)}` },
      ],
    })
    expect(
      getValidatorCapabilities(
        passkeys,
        resolveValidator(passkeys),
        'nexus',
        'intent',
        true,
      ).contributionCodec,
    ).toMatchObject({ kind: 'ordered-threshold' })
  })

  test('rejects validators whose owner shape does not match their codec', () => {
    const ownable = validator({
      type: 'ecdsa',
      accounts: [accountA],
    }) as AtomicValidatorDefinition
    expect(() =>
      resolveOwnableValidator({
        ...ownable,
        owners: [{ ...ownable.owners[0], kind: 'webauthn' }],
      } as AtomicValidatorDefinition),
    ).toThrow('WebAuthn owner')

    const ens = validator({
      type: 'ens',
      owners: [{ account: accountA, expiration: new Date(2_000_000) }],
    }) as AtomicValidatorDefinition
    expect(
      resolveEnsValidator(ens as AtomicValidatorDefinition).initData,
    ).toBeDefined()
    expect(() =>
      resolveEnsValidator({
        ...ens,
        owners: [{ ...ens.owners[0], kind: 'ecdsa' }],
      } as AtomicValidatorDefinition),
    ).toThrow('non-ENS owner')

    const passkey = validator({
      type: 'passkey',
      accounts: [passkeyAccount],
    }) as AtomicValidatorDefinition
    expect(() =>
      resolveWebauthnValidator({
        ...passkey,
        owners: [{ ...passkey.owners[0], kind: 'ecdsa' }],
      } as AtomicValidatorDefinition),
    ).toThrow('non-WebAuthn owner')
  })

  test('sorts ENS owners by address regardless of input order', () => {
    const ens = validator({
      type: 'ens',
      owners: [{ account: accountA }, { account: accountB }],
      threshold: 2,
    }) as AtomicValidatorDefinition
    const [threshold, owners] = decodeAbiParameters(
      [
        { name: 'threshold', type: 'uint256' },
        {
          name: 'owners',
          type: 'tuple[]',
          components: [
            { name: 'addr', type: 'address' },
            { name: 'expiration', type: 'uint48' },
          ],
        },
      ],
      resolveEnsValidator(ens).initData,
    )
    expect(threshold).toBe(2n)
    expect(owners.map((owner) => owner.addr)).toEqual([
      accountB.address,
      accountA.address,
    ])
    expect(owners.map((owner) => owner.expiration)).toEqual([
      Number(maxUint48),
      Number(maxUint48),
    ])
  })

  test('orders ENS owners by value, not by host collation', () => {
    const ownerAddresses = (owners: { account: typeof accountA }[]) => {
      const ens = validator({
        type: 'ens',
        owners,
        threshold: 1,
      }) as AtomicValidatorDefinition
      const initData = withoutHostCollation(
        () => resolveEnsValidator(ens).initData,
      )
      const [, decoded] = decodeAbiParameters(
        [
          { name: 'threshold', type: 'uint256' },
          {
            name: 'owners',
            type: 'tuple[]',
            components: [
              { name: 'addr', type: 'address' },
              { name: 'expiration', type: 'uint48' },
            ],
          },
        ],
        initData,
      )
      return decoded.map((owner) => owner.addr)
    }

    const expected = [collationAccountLow.address, collationAccountHigh.address]
    expect(
      ownerAddresses([
        { account: collationAccountLow },
        { account: collationAccountHigh },
      ]),
    ).toEqual(expected)
    expect(
      ownerAddresses([
        { account: collationAccountHigh },
        { account: collationAccountLow },
      ]),
    ).toEqual(expected)
  })

  test('parses every supported WebAuthn public-key representation', () => {
    const raw = passkeyAccount.publicKey
    const parsed = parseWebauthnPublicKey(raw)
    expect(parsed.x).toBeGreaterThan(0n)
    const bytes = Uint8Array.from({ length: 65 }, (_, index) =>
      index === 0 ? 4 : index,
    )
    expect(parseWebauthnPublicKey(bytes).prefix).toBe(4)
    expect(parseWebauthnPublicKey(new Uint8Array(63))).toEqual({ x: 0n, y: 0n })
    expect(
      parseWebauthnPublicKey(Uint8Array.from({ length: 65 }, () => 3)).prefix,
    ).toBe(3)
    const custom = resolveWebauthnCredentials({
      credentials: [
        { pubKey: parsed, authenticatorId: 'object' },
        { pubKey: bytes, authenticatorId: 'bytes' },
      ],
      threshold: 2,
      address: accountA.address,
    })
    expect(custom.address).toBe(accountA.address)
  })

  test.each(['k1', 'smart-session'] as const)(
    'requires feature input for %s validators',
    (kind) => {
      const base = validator({ type: 'ecdsa', accounts: [accountA] })
      expect(() =>
        resolveAtomicValidator({ ...base, kind } as AtomicValidatorDefinition),
      ).toThrow('requires feature input')
    },
  )
})
