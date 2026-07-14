import {
  concat,
  type Hex,
  hashMessage,
  hashTypedData,
  type TypedDataDefinition,
} from 'viem'
import {
  toWebAuthnAccount,
  type WebAuthnAccount,
} from 'viem/account-abstraction'
import { privateKeyToAccount } from 'viem/accounts'
import { arbitrum, base } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { accountA, accountB, accountC } from '../../test/consts'
import type { Quote, SignData } from '../orchestrator'
import type {
  AccountProviderConfig,
  MultiFactorValidatorConfig,
  OwnerSet,
  RhinestoneConfig,
} from '../types'
import {
  IndependentSigningNotSupportedError,
  InsufficientOwnerSignaturesError,
  InvalidOwnerSigningOptionsError,
  MismatchedOwnerSignaturesError,
  UnknownOwnerError,
} from './error'
import {
  assembleTransaction,
  type OwnerSignature,
  type PreparedTransactionData,
  signTransaction,
} from './utils'

const ACCOUNT_ADDRESS = '0x1111111111111111111111111111111111111111'
const OWNABLE_V0_VALIDATOR_ADDRESS =
  '0x2483da3a338895199e5e538530213157e931bf06'
const OWNABLE_BETA_VALIDATOR_ADDRESS =
  '0x0000000000e9e6e96bcaa3c113187cdb7e38aed9'
const WEBAUTHN_V0_VALIDATOR_ADDRESS =
  '0x0000000000578c4cb0e472a5462da43c495c3f33'
const K1_VALIDATOR_ADDRESS = '0x00000072f286204bb934ed49d8969e86f7dec7b1'

const message = (chainId: number, value: bigint): TypedDataDefinition => ({
  domain: {
    name: 'Independent signing test',
    version: '1',
    chainId,
    verifyingContract: ACCOUNT_ADDRESS,
  },
  types: {
    Test: [{ name: 'value', type: 'uint256' }],
  },
  primaryType: 'Test',
  message: { value },
})

const signData: SignData = {
  origin: [message(base.id, 1n), message(arbitrum.id, 2n)],
  destination: message(arbitrum.id, 3n),
}

function makeQuote(intentId: string, data: SignData = signData): Quote {
  return { intentId, signData: data } as Quote
}

function makePrepared(
  options: {
    quotes?: Quote[]
    transaction?: PreparedTransactionData['transaction']
  } = {},
): PreparedTransactionData {
  const quotes = options.quotes ?? [makeQuote('intent-a')]
  return {
    quotes: { traceId: 'trace', best: quotes[0], all: quotes },
    intentInput: { test: true },
    transaction: options.transaction ?? { chain: base },
  }
}

function makeConfig(
  account: AccountProviderConfig['type'],
  owners: OwnerSet,
): RhinestoneConfig {
  return {
    account: { type: account } as AccountProviderConfig,
    owners,
    ...(account === 'kernel' || account === 'hca'
      ? {}
      : { initData: { address: ACCOUNT_ADDRESS as Hex } }),
  }
}

function makePasskey(seed: string): WebAuthnAccount {
  const hashSeed = privateKeyToAccount(
    `0x${seed.padStart(64, seed)}` as Hex,
  ).address.slice(2)
  const publicKey = `0x${hashSeed.padEnd(128, hashSeed)}` as Hex
  const account = toWebAuthnAccount({
    credential: { id: `credential-${seed}`, publicKey },
  })
  const signHash = async (hash: Hex) => ({
    signature: concat([hash, hash]),
    webauthn: {
      authenticatorData: `0x${'ab'.repeat(37)}` as Hex,
      clientDataJSON: JSON.stringify({ type: 'webauthn.get', challenge: hash }),
      challengeIndex: 23,
      typeIndex: 1,
      userVerificationRequired: false,
    },
    raw: {},
  })
  account.sign = ({ hash }) => signHash(hash)
  account.signMessage = ({ message }) => signHash(hashMessage(message))
  account.signTypedData = (parameters) =>
    signHash(hashTypedData(parameters as TypedDataDefinition))
  return account
}

const passkeyA = makePasskey('1')
const passkeyB = makePasskey('2')

const accountTypes = ['safe', 'nexus', 'kernel', 'startale'] as const

function signingOptions(owners: OwnerSet) {
  switch (owners.type) {
    case 'ecdsa':
      return owners.accounts.map((owner) => ({ owner }))
    case 'ens':
      return owners.owners.map(({ account: owner }) => ({ owner }))
    case 'passkey':
      return owners.accounts.map((owner) => ({ owner }))
    case 'multi-factor':
      return owners.validators.flatMap((validator, validatorId) => {
        const accounts =
          validator.type === 'ens'
            ? validator.owners.map(({ account }) => account)
            : validator.accounts
        return accounts.map((owner) => ({ owner, validatorId }))
      })
  }
}

async function expectGoldenEquivalence(
  config: RhinestoneConfig,
  prepared = makePrepared(),
) {
  const full = await signTransaction(config, prepared)
  const partials: OwnerSignature[] = []
  for (const options of signingOptions(config.owners as OwnerSet)) {
    partials.push(await signTransaction(config, prepared, options))
  }
  expect(JSON.parse(JSON.stringify(partials))).toEqual(partials)
  const assembled = await assembleTransaction(
    config,
    prepared,
    partials.reverse(),
  )
  expect(assembled).toEqual(full)
}

describe.each(accountTypes)('independent signing: %s', (accountType) => {
  test('assembles ECDSA signatures byte-for-byte', async () => {
    await expectGoldenEquivalence(
      makeConfig(accountType, {
        type: 'ecdsa',
        accounts: [accountA, accountB],
        threshold: 2,
      }),
    )
  })

  test('assembles passkey signatures byte-for-byte', async () => {
    await expectGoldenEquivalence(
      makeConfig(accountType, {
        type: 'passkey',
        accounts: [passkeyA, passkeyB],
        threshold: 2,
      }),
    )
  })

  test('assembles multi-factor signatures byte-for-byte', async () => {
    await expectGoldenEquivalence(
      makeConfig(accountType, {
        type: 'multi-factor',
        validators: [
          {
            type: 'ecdsa',
            accounts: [accountA, accountB],
            threshold: 2,
          },
          { type: 'passkey', accounts: [passkeyA] },
        ],
        threshold: 2,
      }),
    )
  })
})

test('assembles HCA ENS signatures byte-for-byte', async () => {
  await expectGoldenEquivalence(
    makeConfig('hca', {
      type: 'ens',
      owners: [{ account: accountA }, { account: accountB }],
      threshold: 2,
    }),
  )
})

describe('independent signing transformations', () => {
  test.each([
    ['safe', OWNABLE_V0_VALIDATOR_ADDRESS],
    ['safe', OWNABLE_BETA_VALIDATOR_ADDRESS],
    ['kernel', OWNABLE_V0_VALIDATOR_ADDRESS],
    ['kernel', OWNABLE_BETA_VALIDATOR_ADDRESS],
  ] as const)(
    'matches legacy Ownable signing for %s with %s',
    async (accountType, module) => {
      await expectGoldenEquivalence(
        makeConfig(accountType, {
          type: 'ecdsa',
          accounts: [accountA, accountB],
          threshold: 2,
          module,
        }),
      )
    },
  )

  test.each(['safe', 'kernel'] as const)(
    'matches legacy WebAuthn signing for %s',
    async (accountType) => {
      await expectGoldenEquivalence(
        makeConfig(accountType, {
          type: 'passkey',
          accounts: [passkeyA],
          module: WEBAUTHN_V0_VALIDATOR_ADDRESS,
        }),
      )
    },
  )
})

describe('independent signing validation', () => {
  const owners: OwnerSet = {
    type: 'ecdsa',
    accounts: [accountA, accountB],
    threshold: 2,
  }
  const config = makeConfig('safe', owners)

  test('assembles a threshold subset in configured owner order', async () => {
    const subsetConfig = makeConfig('safe', {
      type: 'ecdsa',
      accounts: [accountA, accountB, accountC],
      threshold: 2,
    })
    const prepared = makePrepared({
      transaction: {
        chain: base,
        signers: {
          type: 'owner',
          kind: 'ecdsa',
          accounts: [accountA, accountC],
        },
      },
    })
    const full = await signTransaction(subsetConfig, prepared)
    const signatureA = await signTransaction(subsetConfig, prepared, {
      owner: accountA,
    })
    const signatureC = await signTransaction(subsetConfig, prepared, {
      owner: accountC,
    })
    await expect(
      assembleTransaction(subsetConfig, prepared, [signatureC, signatureA]),
    ).resolves.toEqual(full)
  })

  test('omits unsigned multi-factor validators', async () => {
    const multiFactorConfig = makeConfig('safe', {
      type: 'multi-factor',
      validators: [
        { type: 'ecdsa', accounts: [accountA] },
        { type: 'passkey', accounts: [passkeyA] },
        { type: 'ecdsa', accounts: [accountC] },
      ],
      threshold: 2,
    })
    const prepared = makePrepared({
      transaction: {
        chain: base,
        signers: {
          type: 'owner',
          kind: 'multi-factor',
          validators: [
            { type: 'ecdsa', id: 0, accounts: [accountA] },
            { type: 'ecdsa', id: 2, accounts: [accountC] },
          ],
        },
      },
    })
    const full = await signTransaction(multiFactorConfig, prepared)
    const factorA = await signTransaction(multiFactorConfig, prepared, {
      owner: accountA,
      validatorId: 0,
    })
    const factorC = await signTransaction(multiFactorConfig, prepared, {
      owner: accountC,
      validatorId: 2,
    })
    await expect(
      assembleTransaction(multiFactorConfig, prepared, [factorC, factorA]),
    ).resolves.toEqual(full)
  })

  test('rejects an owner outside the configured owner set', async () => {
    await expect(
      signTransaction(config, makePrepared(), { owner: accountC }),
    ).rejects.toBeInstanceOf(UnknownOwnerError)
  })

  test('rejects signatures from different quotes', async () => {
    const prepared = makePrepared({
      quotes: [makeQuote('intent-a'), makeQuote('intent-b')],
    })
    const signatureA = await signTransaction(config, prepared, {
      owner: accountA,
      intentId: 'intent-a',
    })
    const signatureB = await signTransaction(config, prepared, {
      owner: accountB,
      intentId: 'intent-b',
    })
    await expect(
      assembleTransaction(config, prepared, [signatureA, signatureB]),
    ).rejects.toBeInstanceOf(MismatchedOwnerSignaturesError)
  })

  test('does not count duplicate owner signatures toward the threshold', async () => {
    const prepared = makePrepared()
    const signature = await signTransaction(config, prepared, {
      owner: accountA,
    })
    await expect(
      assembleTransaction(config, prepared, [signature, signature]),
    ).rejects.toBeInstanceOf(InsufficientOwnerSignaturesError)
  })

  test('rejects a partial with the wrong origin count', async () => {
    const prepared = makePrepared()
    const signature = await signTransaction(config, prepared, {
      owner: accountA,
    })
    if (signature.kind === 'multi-factor') throw new Error('unexpected kind')
    signature.origin.pop()
    await expect(
      assembleTransaction(config, prepared, [signature]),
    ).rejects.toBeInstanceOf(MismatchedOwnerSignaturesError)
  })

  test('requires a validator id for multi-factor signing', async () => {
    const multiFactorConfig = makeConfig('safe', {
      type: 'multi-factor',
      validators: [{ type: 'ecdsa', accounts: [accountA] }],
    })
    await expect(
      signTransaction(multiFactorConfig, makePrepared(), { owner: accountA }),
    ).rejects.toBeInstanceOf(InvalidOwnerSigningOptionsError)
  })

  test('requires enough complete multi-factor validators', async () => {
    const multiFactorOwners: MultiFactorValidatorConfig = {
      type: 'multi-factor',
      validators: [
        {
          type: 'ecdsa',
          accounts: [accountA, accountB],
          threshold: 2,
        },
        { type: 'passkey', accounts: [passkeyA] },
      ],
      threshold: 2,
    }
    const multiFactorConfig = makeConfig('safe', multiFactorOwners)
    const prepared = makePrepared()
    const factorA = await signTransaction(multiFactorConfig, prepared, {
      owner: accountA,
      validatorId: 0,
    })
    const factorB = await signTransaction(multiFactorConfig, prepared, {
      owner: accountB,
      validatorId: 0,
    })
    await expect(
      assembleTransaction(multiFactorConfig, prepared, [factorA, factorB]),
    ).rejects.toBeInstanceOf(InsufficientOwnerSignaturesError)
  })

  test('requires each included factor to meet its own threshold', async () => {
    const multiFactorConfig = makeConfig('safe', {
      type: 'multi-factor',
      validators: [
        {
          type: 'ecdsa',
          accounts: [accountA, accountB],
          threshold: 2,
        },
        { type: 'passkey', accounts: [passkeyA] },
      ],
      threshold: 2,
    })
    const prepared = makePrepared()
    const ecdsa = await signTransaction(multiFactorConfig, prepared, {
      owner: accountA,
      validatorId: 0,
    })
    const passkey = await signTransaction(multiFactorConfig, prepared, {
      owner: passkeyA,
      validatorId: 1,
    })
    await expect(
      assembleTransaction(multiFactorConfig, prepared, [ecdsa, passkey]),
    ).rejects.toMatchObject({ context: { validatorId: 0 } })
  })

  test('rejects smart-session transactions', async () => {
    const prepared = makePrepared({
      transaction: {
        chain: base,
        signers: {
          type: 'experimental_session',
          session: {} as never,
        },
      },
    })
    await expect(
      signTransaction(config, prepared, { owner: accountA }),
    ).rejects.toBeInstanceOf(IndependentSigningNotSupportedError)
  })

  test('rejects transactions routed through a different validator', async () => {
    const prepared = makePrepared({
      transaction: {
        chain: base,
        signers: {
          type: 'owner',
          kind: 'passkey',
          accounts: [passkeyA],
        },
      },
    })
    await expect(
      signTransaction(config, prepared, { owner: accountA }),
    ).rejects.toBeInstanceOf(IndependentSigningNotSupportedError)
  })

  test('rejects EOA accounts', async () => {
    const eoaConfig = makeConfig('eoa', owners)
    await expect(
      signTransaction(eoaConfig, makePrepared(), { owner: accountA }),
    ).rejects.toBeInstanceOf(IndependentSigningNotSupportedError)
  })

  test('rejects K1/ERC-7739 validators', async () => {
    const k1Config = makeConfig('startale', {
      type: 'ecdsa',
      accounts: [accountA],
      module: K1_VALIDATOR_ADDRESS,
    })
    await expect(
      signTransaction(k1Config, makePrepared(), { owner: accountA }),
    ).rejects.toBeInstanceOf(IndependentSigningNotSupportedError)
  })
})
