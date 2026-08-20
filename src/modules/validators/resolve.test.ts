import { decodeAbiParameters, maxUint48, size, slice } from 'viem'
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
import {
  buildQuorumSigningTree,
  encodeQuorumErc1271Signature,
  encodeQuorumMerkleSignature,
  encodeQuorumOwnerSignatures,
  getQuorumErc1271SignableHash,
  getQuorumSigningTreeHash,
} from '../../signing/quorum'
import { getValidatorCapabilities } from './capabilities'
import { resolveEnsValidator } from './ens'
import { MULTI_FACTOR_VALIDATOR_ADDRESS } from './multi-factor'
import {
  encodeOwnableMockSignature,
  OWNABLE_V0_VALIDATOR_ADDRESS,
  resolveOwnableValidator,
} from './ownable'
import {
  buildQuorumMerkleTree,
  encodeQuorumMerkleEnvelope,
  encodeQuorumValidatorContribution,
  getQuorumMerkleRootSignableHash,
  getQuorumSignableHash,
} from './quorum'
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

  test('encodes weighted quorum installation and sorted signature envelopes', () => {
    const moduleAddress = '0x0000000000000000000000000000000000000042'
    const definition = validator({
      type: 'quorum',
      module: moduleAddress,
      thresholdWeight: 50n,
      owners: [
        { account: accountA, weight: 50n },
        { account: accountB, weight: 25n },
      ],
    })
    const module = resolveValidator(definition)
    expect(module.address).toBe(moduleAddress)
    const [threshold, owners] = decodeAbiParameters(
      [
        { type: 'uint256' },
        {
          type: 'tuple[]',
          components: [
            { name: 'addr', type: 'address' },
            { name: 'weight', type: 'uint96' },
          ],
        },
      ],
      module.initData,
    )
    expect(threshold).toBe(50n)
    expect(owners).toEqual(
      [
        { addr: accountA.address, weight: 50n },
        { addr: accountB.address, weight: 25n },
      ].sort((left, right) =>
        BigInt(left.addr) < BigInt(right.addr) ? -1 : 1,
      ),
    )
    expect(
      resolveValidator(
        validator({
          type: 'quorum',
          module: moduleAddress,
          thresholdWeight: 50n,
          owners: [
            { account: accountB, weight: 25n },
            { account: accountA, weight: 50n },
          ],
        }),
      ).initData,
    ).toBe(module.initData)

    const signatureA = `0x${'11'.repeat(64)}1b` as const
    const signatureB = `0x${'22'.repeat(64)}1c` as const
    if (definition.kind !== 'quorum')
      throw new Error('missing quorum definition')
    const codec = getValidatorCapabilities(
      definition,
      module,
      'nexus',
      'user-operation',
      true,
    ).contributionCodec
    if (codec.kind !== 'weighted-quorum')
      throw new Error('missing quorum codec')
    const contribution = encodeQuorumValidatorContribution({
      ...codec,
      contributions: definition.owners.map((owner) => {
        if (owner.kind === 'webauthn') throw new Error('unexpected passkey')
        return {
          kind: 'ecdsa' as const,
          ownerId: owner.id,
          signature:
            owner.account.address === accountA.address
              ? signatureA
              : signatureB,
          encoding: 'raw-signer' as const,
        }
      }),
    })
    expect(slice(contribution, 0, 1)).toBe('0x00')
    expect(
      getQuorumSignableHash({
        validator: moduleAddress,
        chainId: 1,
        account: accountA.address,
        hash: `0x${'33'.repeat(32)}`,
      }),
    ).not.toBe(
      getQuorumSignableHash({
        validator: moduleAddress,
        chainId: 2,
        account: accountA.address,
        hash: `0x${'33'.repeat(32)}`,
      }),
    )
    const sortedAddresses = [accountA.address, accountB.address].sort()
    expect(slice(contribution, 1, 21)).toBe(sortedAddresses[0])
    expect(slice(contribution, 88, 108)).toBe(sortedAddresses[1])
    const tree = buildQuorumMerkleTree([
      { account: accountA.address, digest: `0x${'44'.repeat(32)}` },
      { account: accountB.address, digest: `0x${'55'.repeat(32)}` },
    ])
    expect(tree.operations).toHaveLength(2)
    expect(tree.operations.every(({ root }) => root === tree.root)).toBe(true)
    expect(
      getQuorumMerkleRootSignableHash({
        validator: moduleAddress,
        root: tree.root,
      }),
    ).toMatch(/^0x[0-9a-f]{64}$/u)
    const merkleEnvelope = encodeQuorumMerkleEnvelope({
      proof: tree.operations[0],
      signatures: contribution.slice(4) as `0x${string}`,
    })
    expect(slice(merkleEnvelope, 0, 1)).toBe('0x01')
    expect(slice(merkleEnvelope, 1, 33)).toBe(tree.root)

    const publicTree = buildQuorumSigningTree([
      { account: accountA.address, digest: `0x${'44'.repeat(32)}` },
      { account: accountB.address, digest: `0x${'55'.repeat(32)}` },
    ])
    const publicRootHash = getQuorumSigningTreeHash({
      validator: moduleAddress,
      root: publicTree.root,
    })
    expect(publicRootHash).toBe(
      getQuorumMerkleRootSignableHash({
        validator: moduleAddress,
        root: publicTree.root,
      }),
    )
    expect(
      getQuorumErc1271SignableHash({
        validator: moduleAddress,
        chainId: 1,
        account: accountA.address,
        hash: `0x${'33'.repeat(32)}`,
      }),
    ).toBe(
      getQuorumSignableHash({
        validator: moduleAddress,
        chainId: 1,
        account: accountA.address,
        hash: `0x${'33'.repeat(32)}`,
      }),
    )
    const publicOwners = definition.owners.map((owner) => {
      if (owner.kind === 'webauthn' || owner.weight === undefined) {
        throw new Error('unexpected quorum owner')
      }
      return {
        ownerId: owner.id,
        signer: owner.account.address,
        weight: owner.weight,
      }
    })
    const publicWeighted = encodeQuorumOwnerSignatures({
      owners: publicOwners,
      thresholdWeight: 50n,
      signatures: definition.owners.map((owner) => ({
        ownerId: owner.id,
        signature:
          owner.kind !== 'webauthn' &&
          owner.account.address === accountA.address
            ? signatureA
            : signatureB,
      })),
    })
    expect(encodeQuorumErc1271Signature({ signatures: publicWeighted })).toBe(
      contribution,
    )
    expect(
      encodeQuorumMerkleSignature({
        operation: publicTree.operations[0],
        signatures: publicWeighted,
      }),
    ).toBe(merkleEnvelope)
  })

  test('rejects unreachable, duplicate, and underweight quorum policies', () => {
    const module = '0x0000000000000000000000000000000000000042'
    expect(() =>
      resolveValidator(
        validator({
          type: 'quorum',
          module,
          thresholdWeight: 2n,
          owners: [{ account: accountA, weight: 1n }],
        }),
      ),
    ).toThrow('total owner weight')
    expect(() =>
      resolveValidator(
        validator({
          type: 'quorum',
          module,
          thresholdWeight: 1n,
          owners: [
            { account: accountA, weight: 1n },
            { account: accountA, weight: 1n },
          ],
        }),
      ),
    ).toThrow('Duplicate quorum owner')

    const definition = validator({
      type: 'quorum',
      module,
      thresholdWeight: 2n,
      owners: [
        { account: accountA, weight: 1n },
        { account: accountB, weight: 1n },
      ],
    })
    if (definition.kind !== 'quorum')
      throw new Error('missing quorum definition')
    expect(() =>
      encodeQuorumValidatorContribution({
        owners: definition.owners.map((owner) => {
          if (owner.kind === 'webauthn' || owner.weight === undefined) {
            throw new Error('unexpected quorum owner')
          }
          return {
            ownerId: owner.id,
            signer: owner.account.address,
            weight: owner.weight,
          }
        }),
        thresholdWeight: 2n,
        contributions: [
          {
            kind: 'ecdsa',
            ownerId: definition.owners[0].id,
            signature: `0x${'11'.repeat(64)}1b`,
            encoding: 'raw-signer',
          },
        ],
      }),
    ).toThrow('received 1')
    const invalidQuorum = {
      ...definition,
      owners: [{ ...definition.owners[0], weight: undefined }],
    } as AtomicValidatorDefinition
    expect(() =>
      getValidatorCapabilities(
        invalidQuorum,
        resolveValidator(definition),
        'nexus',
        'intent',
        true,
      ),
    ).toThrow('weighted ECDSA owners')
    expect(() =>
      getValidatorCapabilities(
        { ...definition, thresholdWeight: undefined },
        resolveValidator(definition),
        'nexus',
        'intent',
        true,
      ),
    ).toThrow('threshold weight is missing')
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

  test('materializes nested MFA with stable ids and module overrides', () => {
    const module = resolveValidator(
      validator({
        type: 'multi-factor',
        threshold: 1,
        module: '0x00000000000000000000000000000000deadbeef',
        validators: [
          { type: 'ecdsa', accounts: [accountA] },
          { type: 'passkey', accounts: [passkeyAccount] },
        ],
      }),
    )
    expect(module.address).toBe('0x00000000000000000000000000000000deadbeef')
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
