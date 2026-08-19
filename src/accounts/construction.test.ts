import {
  type Address,
  decodeAbiParameters,
  type Hex,
  keccak256,
  toHex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, test } from 'vitest'
import { passkey } from '../../test/utils/passkeys'
import type { AccountConstructionInput } from '../config/input'
import { resolveStandaloneAccountConfig } from '../config/resolve'
import {
  generateWebauthnCredentialId,
  parseWebauthnPublicKey,
} from '../modules/validators/webauthn'
import { createAccountConstruction } from './construction'
import { createAccountAdapter } from './registry'
import type { AccountConstruction } from './types'

const CHAIN = { kind: 'evm', id: 1, caip2: 'eip155:1' } as const

function construct(input: AccountConstructionInput): AccountConstruction {
  const resolved = resolveStandaloneAccountConfig(input, 'current-v2')
  return createAccountConstruction({
    material: {
      account: resolved.account,
      ...(resolved.owners ? { owner: resolved.owners } : {}),
      modules: resolved.modules,
      ...(resolved.initData ? { initData: resolved.initData } : {}),
      ...(resolved.eoa ? { eoa: resolved.eoa } : {}),
      sessions: {
        enabled: resolved.sessions.enabled,
        environment: resolved.sessions.environment,
      },
    },
    chain: CHAIN,
    deployed: false,
  })
}

function deployment(input: AccountConstructionInput): {
  readonly address: Address
  readonly factoryData: Hex | undefined
} {
  const construction = construct(input)
  const plan =
    createAccountAdapter(construction).getDeploymentPlan(construction)
  return { address: plan.address, factoryData: plan.factoryData }
}

function installedCredentials(validator: { readonly initData: Hex }) {
  return decodeAbiParameters(
    [
      { name: 'threshold', type: 'uint256' },
      {
        name: 'credentials',
        type: 'tuple[]',
        components: [
          { name: 'pubKeyX', type: 'uint256' },
          { name: 'pubKeyY', type: 'uint256' },
          { name: 'requireUV', type: 'bool' },
        ],
      },
    ],
    validator.initData,
  )[1]
}

function credentialIds(
  accounts: readonly { publicKey: Hex }[],
  address: Address,
): readonly Hex[] {
  return accounts.map((account) => {
    const key = parseWebauthnPublicKey(account.publicKey)
    return generateWebauthnCredentialId(key.x, key.y, address)
  })
}

function installable(
  accounts: readonly { publicKey: Hex }[],
  address: Address,
): boolean {
  // The order the validator sees is canonical (by public key), so that is the
  // order whose credential IDs must be strictly ascending.
  const canonical = [...accounts].sort((left, right) => {
    const a = parseWebauthnPublicKey(left.publicKey)
    const b = parseWebauthnPublicKey(right.publicKey)
    if (a.x !== b.x) return a.x < b.x ? -1 : 1
    return a.y < b.y ? -1 : 1
  })
  const ids = credentialIds(canonical, address)
  return ids.every(
    (id, index) => index === 0 || BigInt(ids[index - 1]) < BigInt(id),
  )
}

describe('passkey account construction', () => {
  test('derives the same address for every ordering of the same passkey set', () => {
    const accounts = [passkey('a'), passkey('b'), passkey('c')]
    const derived = [
      accounts,
      [...accounts].reverse(),
      [accounts[1], accounts[2], accounts[0]],
    ].map((order) =>
      deployment({
        account: { type: 'nexus' },
        owners: { type: 'passkey', accounts: order },
      }),
    )
    expect(new Set(derived.map((entry) => entry.address)).size).toBe(1)
    expect(new Set(derived.map((entry) => entry.factoryData)).size).toBe(1)
  })

  test('derived addresses accept the credential set the validator installs', () => {
    for (let index = 0; index < 25; index++) {
      for (const size of [2, 3]) {
        const accounts = Array.from({ length: size }, (_, key) =>
          passkey(`set:${index}:${key}`),
        )
        const { address } = deployment({
          account: { type: 'nexus' },
          owners: { type: 'passkey', accounts },
        })
        expect(installable(accounts, address)).toBe(true)
      }
    }
  })

  test('installs cleanly across account kinds', () => {
    const accounts = [passkey('kind:a'), passkey('kind:b')]
    for (const account of [
      { type: 'nexus' },
      { type: 'kernel' },
      { type: 'startale' },
      { type: 'safe' },
    ] as const) {
      const { address } = deployment({
        account,
        owners: { type: 'passkey', accounts },
      })
      expect(installable(accounts, address)).toBe(true)
    }
  })

  test('is reproducible across repeated derivations and chains', () => {
    const accounts = [passkey('repeat:a'), passkey('repeat:b')]
    const owners = { type: 'passkey', accounts } as const
    const first = deployment({ account: { type: 'nexus' }, owners })
    const second = deployment({ account: { type: 'nexus' }, owners })
    const resolved = resolveStandaloneAccountConfig(
      { account: { type: 'nexus' }, owners },
      'current-v2',
    )
    const onAnotherChain = createAccountConstruction({
      material: {
        account: resolved.account,
        owner: resolved.owners,
        modules: resolved.modules,
        sessions: { enabled: false, environment: 'production' },
      },
      chain: { kind: 'evm', id: 8453, caip2: 'eip155:8453' },
      deployed: true,
    })
    expect(second).toEqual(first)
    expect(onAnotherChain.account).toEqual(
      construct({
        account: { type: 'nexus' },
        owners,
      }).account,
    )
  })

  test('keeps the caller salt when it already installs', () => {
    const accounts = [passkey('salt:a'), passkey('salt:b')]
    const { address } = deployment({
      account: { type: 'nexus' },
      owners: { type: 'passkey', accounts },
    })
    const withExplicitSalt = deployment({
      account: { type: 'nexus', salt: keccak256('0x') },
      owners: { type: 'passkey', accounts },
    })
    expect(withExplicitSalt.address).toBe(address)
  })

  test('orders credentials against a fixed address instead of searching', () => {
    const eoa = privateKeyToAccount(keccak256(toHex('eoa:7702')))
    const accounts = [passkey('7702:a'), passkey('7702:b')]
    const construction = construct({
      account: { type: 'nexus' },
      eoa,
      owners: { type: 'passkey', accounts },
    })
    // The address is the EOA's, so the salt must not move.
    expect(construction.account).toEqual(
      resolveStandaloneAccountConfig(
        { account: { type: 'nexus' }, owners: { type: 'passkey', accounts } },
        'current-v2',
      ).account,
    )
    const installed = installedCredentials(construction.setup.validators[0])
    const ids = installed.map((credential) =>
      generateWebauthnCredentialId(
        credential.pubKeyX,
        credential.pubKeyY,
        eoa.address,
      ),
    )
    expect(ids.length).toBe(2)
    expect(BigInt(ids[0])).toBeLessThan(BigInt(ids[1]))
  })

  test('rejects duplicate passkeys and oversized deployment sets', () => {
    const duplicate = passkey('dupe')
    expect(() =>
      deployment({
        account: { type: 'nexus' },
        owners: { type: 'passkey', accounts: [duplicate, duplicate] },
      }),
    ).toThrow('duplicate passkeys')
    expect(() =>
      deployment({
        account: { type: 'nexus' },
        owners: {
          type: 'passkey',
          accounts: Array.from({ length: 7 }, (_, index) =>
            passkey(`many:${index}`),
          ),
        },
      }),
    ).toThrow('passkeys.addOwner')
  })
})
