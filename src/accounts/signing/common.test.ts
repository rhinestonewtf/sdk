import { decodeAbiParameters, type Hex } from 'viem'
import { toWebAuthnAccount } from 'viem/account-abstraction'
import { mainnet } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { accountA, passkeyAccount } from '../../../test/consts'
import {
  ENS_HCA_MODULE,
  OWNABLE_VALIDATOR_ADDRESS,
  WEBAUTHN_VALIDATOR_ADDRESS,
} from '../../modules/validators/core'
import type { OwnerSet, SignerSet } from '../../types'
import { type SigningFunctions, signWithOwners } from './common'
import { sign as signMessage } from './message'
import { sign as signTypedData } from './typedData'

const passkeyAccountB = toWebAuthnAccount({
  credential: {
    id: 'second-passkey',
    publicKey: `0x04${'11'.repeat(32)}${'22'.repeat(32)}` as Hex,
  },
})

const factorContributionAbi = [
  {
    name: 'validators',
    type: 'tuple[]',
    components: [
      { name: 'packedValidatorAndId', type: 'bytes32' },
      { name: 'data', type: 'bytes' },
    ],
  },
] as const

const webAuthnAuthAbi = [
  {
    name: 'webAuthns',
    type: 'tuple[]',
    components: [
      { name: 'authenticatorData', type: 'bytes' },
      { name: 'clientDataJSON', type: 'string' },
      { name: 'challengeIndex', type: 'uint256' },
      { name: 'typeIndex', type: 'uint256' },
      { name: 'r', type: 'uint256' },
      { name: 's', type: 'uint256' },
    ],
  },
] as const

const signingFunctions: SigningFunctions<Hex> = {
  signEcdsa: async () => `0x${'11'.repeat(64)}1b` as Hex,
  signPasskey: async (account) => ({
    webauthn: {
      authenticatorData: account.id === passkeyAccount.id ? '0x01' : '0x02',
      clientDataJSON: '{"type":"webauthn.get","challenge":"test"}',
      challengeIndex: 23,
      typeIndex: 1,
    },
    signature:
      account.id === passkeyAccount.id
        ? (`0x${'22'.repeat(64)}` as Hex)
        : (`0x${'33'.repeat(64)}` as Hex),
  }),
}

async function signOwners(
  signers: SignerSet & { type: 'owner' },
  configuredOwners: OwnerSet,
  statelessPasskey = false,
): Promise<Hex> {
  const signMain = (
    nestedSigners: SignerSet,
    nestedOwners: OwnerSet,
    _chain: typeof mainnet,
    _address: `0x${string}`,
    _params: Hex,
    isUserOpHash: boolean,
    nestedStatelessPasskey = false,
  ) =>
    signWithOwners(
      nestedSigners as SignerSet & { type: 'owner' },
      nestedOwners,
      mainnet,
      accountA.address,
      `0x${'44'.repeat(32)}`,
      signingFunctions,
      isUserOpHash,
      signMain,
      nestedStatelessPasskey,
    )

  return signWithOwners(
    signers,
    configuredOwners,
    mainnet,
    accountA.address,
    `0x${'44'.repeat(32)}`,
    signingFunctions,
    false,
    signMain,
    statelessPasskey,
  )
}

function validatorAddress(packedValidatorAndId: Hex) {
  return `0x${packedValidatorAndId.slice(-40)}`.toLowerCase()
}

const signedPasskeyAccountB = {
  ...passkeyAccountB,
  sign: async () => ({
    webauthn: {
      authenticatorData: '0x02' as Hex,
      clientDataJSON: '{"type":"webauthn.get","challenge":"test"}',
      challengeIndex: 23,
      typeIndex: 1,
    },
    signature: `0x${'33'.repeat(64)}` as Hex,
  }),
  signTypedData: async () => ({
    webauthn: {
      authenticatorData: '0x02' as Hex,
      clientDataJSON: '{"type":"webauthn.get","challenge":"test"}',
      challengeIndex: 23,
      typeIndex: 1,
    },
    signature: `0x${'33'.repeat(64)}` as Hex,
  }),
} as typeof passkeyAccountB

describe('multi-factor signing', () => {
  const configuredOwners: OwnerSet = {
    type: 'multi-factor',
    validators: [
      { type: 'ecdsa', accounts: [accountA] },
      {
        type: 'passkey',
        accounts: [passkeyAccount, passkeyAccountB],
        threshold: 1,
      },
    ],
    threshold: 2,
  }

  test.each([
    {
      name: 'outer threshold 1 with ECDSA only',
      signers: {
        type: 'owner',
        kind: 'multi-factor',
        validators: [{ type: 'ecdsa', id: 0, accounts: [accountA] }],
      } as const,
      expectedAddress: OWNABLE_VALIDATOR_ADDRESS,
      outerThreshold: 1,
    },
    {
      name: 'outer threshold 1 with passkey only',
      signers: {
        type: 'owner',
        kind: 'multi-factor',
        validators: [{ type: 'passkey', id: 1, accounts: [passkeyAccountB] }],
      } as const,
      expectedAddress: WEBAUTHN_VALIDATOR_ADDRESS,
      outerThreshold: 1,
    },
  ])('$name', async ({ signers, expectedAddress, outerThreshold }) => {
    const signature = await signOwners(signers, {
      ...configuredOwners,
      threshold: outerThreshold,
    })
    const [factors] = decodeAbiParameters(factorContributionAbi, signature)

    expect(factors).toHaveLength(1)
    expect(validatorAddress(factors[0].packedValidatorAndId)).toEqual(
      expectedAddress.toLowerCase(),
    )
    if (expectedAddress === WEBAUTHN_VALIDATOR_ADDRESS) {
      const [assertions] = decodeAbiParameters(webAuthnAuthAbi, factors[0].data)
      expect(assertions).toHaveLength(1)
    }
  })

  test('outer threshold 2 combines ECDSA and assertion-only passkey factors', async () => {
    const signature = await signOwners(
      {
        type: 'owner',
        kind: 'multi-factor',
        validators: [
          { type: 'ecdsa', id: 0, accounts: [accountA] },
          { type: 'passkey', id: 1, accounts: [passkeyAccountB] },
        ],
      },
      configuredOwners,
    )
    const [factors] = decodeAbiParameters(factorContributionAbi, signature)
    const [assertions] = decodeAbiParameters(webAuthnAuthAbi, factors[1].data)

    expect(factors).toHaveLength(2)
    expect(assertions).toHaveLength(1)
    expect(assertions[0].authenticatorData).toEqual('0x02')
  })

  test('propagates configured factors through message and typed-data signing', async () => {
    const configuredPasskeyOwners: OwnerSet = {
      type: 'multi-factor',
      validators: [
        {
          type: 'passkey',
          accounts: [passkeyAccount, signedPasskeyAccountB],
        },
      ],
    }
    const signers = {
      type: 'owner',
      kind: 'multi-factor',
      validators: [
        { type: 'passkey', id: 0, accounts: [signedPasskeyAccountB] },
      ],
    } as const
    const messageSignature = await signMessage(
      signers,
      configuredPasskeyOwners,
      mainnet,
      accountA.address,
      `0x${'44'.repeat(32)}`,
      false,
    )
    const typedDataSignature = await signTypedData(
      signers,
      configuredPasskeyOwners,
      mainnet,
      accountA.address,
      {
        domain: {},
        types: { Message: [{ name: 'value', type: 'string' }] },
        primaryType: 'Message',
        message: { value: 'test' },
      },
    )

    for (const signature of [messageSignature, typedDataSignature]) {
      const [factors] = decodeAbiParameters(factorContributionAbi, signature)
      const [assertions] = decodeAbiParameters(webAuthnAuthAbi, factors[0].data)
      expect(assertions).toHaveLength(1)
      expect(assertions[0].authenticatorData).toEqual('0x02')
    }
  })

  test('uses the configured ENS validator address for an ECDSA contribution', async () => {
    const ensOwners: OwnerSet = {
      type: 'multi-factor',
      validators: [
        {
          type: 'ens',
          accounts: [accountA],
          ownerExpirations: [1],
        },
      ],
    }
    const signature = await signOwners(
      {
        type: 'owner',
        kind: 'multi-factor',
        validators: [{ type: 'ecdsa', id: 0, accounts: [accountA] }],
      },
      ensOwners,
    )
    const [factors] = decodeAbiParameters(factorContributionAbi, signature)

    expect(validatorAddress(factors[0].packedValidatorAndId)).toEqual(
      ENS_HCA_MODULE.toLowerCase(),
    )
  })

  test('rejects a non-prefix partial passkey factor selection', async () => {
    await expect(
      signOwners(
        {
          type: 'owner',
          kind: 'multi-factor',
          validators: [{ type: 'passkey', id: 1, accounts: [passkeyAccount] }],
        },
        configuredOwners,
      ),
    ).rejects.toThrow(
      'partial signer set must be the lowest-ordered credentials',
    )
  })
})
