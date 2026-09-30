import { p256 } from '@noble/curves/nist'
import { secp256k1 } from '@noble/curves/secp256k1'
import { bytesToHex, hexToBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arbitrum, base, hyperEvm } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { asSwigNamespace, locateSwig } from '../accounts/solana/address'
import {
  hyperCorePerp,
  solanaAddress,
  solanaDevnet,
  solanaMainnet,
  stellarMainnet,
  tronMainnet,
} from '../chains/non-evm'
import type { RhinestoneAccountConfig, Transaction } from '../config/account'
import { UnsupportedAccountCapabilityError } from '../errors/capability'
import {
  isCrossChainSolanaOrigin,
  isSolanaAuthorityChange,
  isSolanaInstructionExecution,
  isSolanaOrigin,
  normalizeAuthorityChange,
  normalizeTransaction,
} from './transaction-input'

const owner = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const solanaOwner = privateKeyToAccount(`0x${'22'.repeat(32)}`)
const swig = locateSwig(asSwigNamespace('dev-v1'), solanaOwner.address).swig

const usdcBase = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' as const
const usdcArbitrum = '0xaf88d065e77c8cc2239327c5edb3a432268e5831' as const
const usdcHyperEvm = '0x0000000000000000000000000000000000000021' as const
const recipientAddress = '0x0000000000000000000000000000000000000010' as const
const hyperCoreToken = '0x0000000000000000000000000000000000000022' as const
const tronRecipient = 'TXYZ1111111111111111111111111111NM'
const stellarRecipient =
  'GBBM6BKZPEHWYO3E3YKREDPQXMS4VVBLNK4GDNW2QGN3VYQKJ2KGXNV3'

const usdcMintDevnet = solanaAddress(
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
)
const solanaMintAlt = solanaAddress(
  '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
)
const nativeSol = solanaAddress('11111111111111111111111111111111')
const solanaRecipient = solanaAddress(
  'Vote111111111111111111111111111111111111111',
)
const solanaReceiverAddress = solanaAddress(
  '9fTE4gQnweN345EGzy6jnXNFW8VryvZ8QwLZqgBubmMs',
)

const evmConfig: RhinestoneAccountConfig = {
  evm: {
    account: { type: 'nexus', version: '1.2.1' },
    owners: { type: 'ecdsa', accounts: [owner] },
  },
}

const evmConfigNoSolana: RhinestoneAccountConfig = evmConfig

const evmWithSolanaReceiver: RhinestoneAccountConfig = {
  ...evmConfig,
  solana: { address: solanaReceiverAddress },
}

const managedSolanaConfig: RhinestoneAccountConfig = {
  ...evmConfig,
  solana: { owner: { type: 'ecdsa', account: solanaOwner }, swig },
}

const solanaOnlyManagedConfig: RhinestoneAccountConfig = {
  solana: { owner: { type: 'ecdsa', account: solanaOwner }, swig },
}

function thrown(run: () => unknown): UnsupportedAccountCapabilityError {
  try {
    run()
  } catch (error) {
    if (error instanceof UnsupportedAccountCapabilityError) return error
    throw error
  }
  throw new Error(
    'expected an UnsupportedAccountCapabilityError, but none was thrown',
  )
}

function normalize(tx: unknown, config: RhinestoneAccountConfig = evmConfig) {
  return normalizeTransaction(tx as Transaction, config) as any
}

describe('replaced top-level fields', () => {
  const fields = [
    'chain',
    'targetChain',
    'sourceChains',
    'sourceAssets',
    'sourceTokens',
    'sourceCalls',
    'auxiliaryFunds',
    'tokenRequests',
    'recipient',
    'calls',
    'gasLimit',
    'hyperCore',
    'instructions',
    'addressLookupTables',
    'authority',
  ]

  test.each(fields)('refuses top-level `%s`', (field) => {
    const error = thrown(() => normalize({ [field]: 'x' }))
    expect(error.message).toMatch(/was replaced by/)
    expect(error.context.field).toBe(field)
  })
})

describe('replaced nested fields', () => {
  const cases: [string, unknown][] = [
    [
      'source.amount',
      { destination: { chain: base, token: usdcBase }, source: { amount: 1n } },
    ],
    [
      'source.selection',
      {
        destination: { chain: base, token: usdcBase },
        source: { selection: [] },
      },
    ],
    [
      'source.limits',
      { destination: { chain: base, token: usdcBase }, source: { limits: {} } },
    ],
    [
      'source.executions',
      {
        destination: { chain: base, token: usdcBase },
        source: { executions: [] },
      },
    ],
    [
      'source.address',
      {
        destination: { chain: base, token: usdcBase },
        source: { address: usdcBase },
      },
    ],
    [
      'destination.tokenRequests',
      { destination: { chain: base, tokenRequests: [] } },
    ],
    [
      'destination.address',
      { destination: { chain: base, address: usdcBase } },
    ],
  ]

  test.each(cases)('refuses `%s`', (field, tx) => {
    const error = thrown(() => normalize(tx))
    expect(error.message).toMatch(/was replaced by/)
    expect(error.context.field).toBe(field)
  })
})

describe('unknown keys', () => {
  test('refuses an unknown root key', () => {
    const error = thrown(() =>
      normalize({
        destination: { chain: base, token: usdcBase },
        source: { token: usdcBase },
        foo: 1,
      }),
    )
    expect(error.message).toMatch(/`foo` is not a transaction field/)
    expect(error.context.field).toBe('foo')
  })

  test('refuses an unknown source key', () => {
    const error = thrown(() =>
      normalize({
        destination: { chain: base, token: usdcBase },
        source: { token: usdcBase, foo: 1 },
      }),
    )
    expect(error.message).toMatch(/`source\.foo` is not a source field/)
    expect(error.context.field).toBe('source.foo')
  })

  test('refuses an unknown destination key', () => {
    const error = thrown(() =>
      normalize({
        destination: { chain: base, token: usdcBase, foo: 1 },
        source: { token: usdcBase },
      }),
    )
    expect(error.message).toMatch(/`destination\.foo` is not supported/)
    expect(error.context.field).toBe('destination.foo')
  })
})

describe('delivery modes', () => {
  test('token + amount delivers exactly amount', () => {
    const tx = normalize({
      source: { token: usdcBase },
      destination: { chain: base, token: usdcBase, amount: 10n },
    })
    expect(tx.destination.token).toBe(usdcBase)
    expect(tx.destination.amount).toBe(10n)
  })

  test('token alone delivers everything the source yields', () => {
    const tx = normalize({
      source: { token: usdcBase },
      destination: { chain: base, token: usdcBase },
    })
    expect(tx.destination.token).toBe(usdcBase)
    expect('amount' in tx.destination).toBe(false)
  })

  test('neither token nor amount is a pure execution', () => {
    const tx = normalize({
      sponsored: true,
      destination: {
        chain: base,
        calls: [{ to: usdcBase, data: '0x', value: 0n }],
      },
    })
    expect('token' in tx.destination).toBe(false)
  })

  test('amount without token is refused', () => {
    const error = thrown(() =>
      normalize({ destination: { chain: base, amount: 1n } }),
    )
    expect(error.message).toMatch(/needs `destination\.token`/)
    expect(error.context.field).toBe('destination.amount')
  })

  test('EVM destination amount of 0n is allowed (non-negative)', () => {
    const tx = normalize({
      source: { token: usdcBase },
      destination: { chain: base, token: usdcBase, amount: 0n },
    })
    expect(tx.destination.amount).toBe(0n)
  })

  test('HyperCore destination amount of 0n is allowed', () => {
    const tx = normalize({
      source: { chain: hyperEvm, token: usdcHyperEvm },
      destination: { chain: hyperCorePerp, token: hyperCoreToken, amount: 0n },
    })
    expect(tx.destination.amount).toBe(0n)
  })

  test('svm destination amount must be positive; 0n is refused', () => {
    const error = thrown(() =>
      normalize({
        source: { chain: base, token: usdcBase },
        destination: { chain: solanaDevnet, token: usdcMintDevnet, amount: 0n },
      }),
    )
    expect(error.context.field).toBe('destination.amount')
  })

  test('negative destination amount is refused', () => {
    const error = thrown(() =>
      normalize({
        source: { token: usdcBase },
        destination: { chain: base, token: usdcBase, amount: -1n },
      }),
    )
    expect(error.context.field).toBe('destination.amount')
  })

  test('negative source.maxAmount is refused', () => {
    const error = thrown(() =>
      normalize({
        source: { token: usdcBase, maxAmount: -1n },
        destination: { chain: base, token: usdcBase },
      }),
    )
    expect(error.context.field).toBe('source.maxAmount')
  })

  test('non-positive source.auxiliaryFunds is refused', () => {
    const error = thrown(() =>
      normalize({
        source: { token: usdcBase, auxiliaryFunds: 0n },
        destination: { chain: base, token: usdcBase },
      }),
    )
    expect(error.context.field).toBe('source.auxiliaryFunds')
  })

  test('a null destination.token is present, and invalid', () => {
    const error = thrown(() =>
      normalize({
        source: { token: usdcBase },
        destination: { chain: base, token: null },
      }),
    )
    expect(error.context.field).toBe('destination.token')
  })

  test('a null destination.amount is present, and invalid', () => {
    const error = thrown(() =>
      normalize({
        source: { token: usdcBase },
        destination: { chain: base, token: usdcBase, amount: null },
      }),
    )
    expect(error.context.field).toBe('destination.amount')
  })
})

describe('source requirement', () => {
  test('a delivery without source is refused even when sponsored', () => {
    const error = thrown(() =>
      normalize({
        sponsored: true,
        destination: { chain: base, token: usdcBase, amount: 1n },
      }),
    )
    expect(error.context.field).toBe('source')
  })

  test.each([false, { gas: false, bridging: true, swaps: true }])(
    'unsponsored/partially-sponsored execution without source is refused (%j)',
    (sponsored) => {
      const error = thrown(() =>
        normalize({
          sponsored,
          destination: {
            chain: base,
            calls: [{ to: usdcBase, data: '0x', value: 0n }],
          },
        }),
      )
      expect(error.context.field).toBe('source')
    },
  )

  test.each([true, { gas: true, bridging: false, swaps: false }])(
    'sponsored source-free EVM calls are allowed (%j)',
    (sponsored) => {
      const tx = normalize({
        sponsored,
        destination: {
          chain: base,
          calls: [{ to: usdcBase, data: '0x', value: 0n }],
        },
      })
      expect(tx.source).toBeUndefined()
    },
  )

  test('source-free delivery is refused for a HyperCore destination even when sponsored', () => {
    const error = thrown(() =>
      normalize({
        sponsored: true,
        destination: {
          chain: hyperCorePerp,
          token: hyperCoreToken,
          recipient: recipientAddress,
        },
      }),
    )
    expect(error.context.field).toBe('source')
  })

  test('source-free delivery is refused for a Tron destination even when sponsored', () => {
    const error = thrown(() =>
      normalize({
        sponsored: true,
        destination: {
          chain: tronMainnet,
          token: usdcBase,
          recipient: tronRecipient,
        },
      }),
    )
    expect(error.context.field).toBe('source')
  })

  test('source-free delivery is refused for a Stellar destination even when sponsored', () => {
    const error = thrown(() =>
      normalize({
        sponsored: true,
        destination: {
          chain: stellarMainnet,
          token: usdcBase,
          recipient: stellarRecipient,
        },
      }),
    )
    expect(error.context.field).toBe('source')
  })

  test('source-free execution is refused for a HyperCore destination unconditionally', () => {
    const error = thrown(() =>
      normalize({
        sponsored: true,
        destination: {
          chain: hyperCorePerp,
          calls: [{ to: usdcBase, data: '0x', value: 0n }],
        },
      }),
    )
    expect(error.context.field).toBe('source')
  })
})

describe('same-chain source shorthand', () => {
  test('an omitted source.chain resolves to destination.chain', () => {
    const tx = normalize({
      source: { token: usdcBase },
      destination: { chain: base, token: usdcBase, amount: 1n },
    })
    expect(tx.source.chain).toEqual(base)
    expect(tx.source.chain).toBe(tx.destination.chain)
  })

  test('the output is frozen', () => {
    const tx = normalize({
      source: { token: usdcBase },
      destination: { chain: base, token: usdcBase, amount: 1n },
    })
    expect(Object.isFrozen(tx)).toBe(true)
    expect(Object.isFrozen(tx.source)).toBe(true)
    expect(Object.isFrozen(tx.destination)).toBe(true)
  })

  test('normalizing twice is idempotent', () => {
    const tx = normalize({
      source: { token: usdcBase },
      destination: { chain: base, token: usdcBase, amount: 1n },
    })
    const twice = normalize(tx)
    expect(twice).toEqual(tx)
  })

  test('an inferred HyperCore/Tron/Stellar source chain is refused', () => {
    const error = thrown(() =>
      normalize({
        source: { token: usdcBase },
        destination: {
          chain: hyperCorePerp,
          calls: [{ to: usdcBase, data: '0x', value: 0n }],
        },
      }),
    )
    expect(error.context.field).toBe('source.chain')
    expect(error.message).toMatch(/cannot fund itself; name `source\.chain`/)
  })

  test('an explicit HyperCore/Tron/Stellar source chain is refused', () => {
    const error = thrown(() =>
      normalize({
        source: { chain: tronMainnet, token: usdcBase },
        destination: { chain: base, token: usdcBase },
      }),
    )
    expect(error.context.field).toBe('source.chain')
    expect(error.message).toMatch(/cannot fund a transaction/)
  })
})

describe('source validation', () => {
  test('source.token must be an EVM address', () => {
    const error = thrown(() =>
      normalize({
        source: { token: 'not-an-address' },
        destination: { chain: base, token: usdcBase },
      }),
    )
    expect(error.context.field).toBe('source.token')
  })

  test('source.calls must be an array', () => {
    const error = thrown(() =>
      normalize({
        source: { token: usdcBase, calls: {} },
        destination: { chain: base, token: usdcBase },
      }),
    )
    expect(error.context.field).toBe('source.calls')
  })

  test('a source call `provides` matching source.token (case-insensitively) is accepted', () => {
    const tx = normalize({
      source: {
        token: usdcBase,
        calls: [
          {
            to: usdcBase,
            data: '0x',
            value: 0n,
            provides: [{ token: usdcBase.toUpperCase(), amount: 1n }],
          },
        ],
      },
      destination: { chain: base, token: usdcBase },
    })
    expect(tx.source.calls).toHaveLength(1)
  })

  test('a source call `provides` naming a foreign token is refused', () => {
    const error = thrown(() =>
      normalize({
        source: {
          token: usdcBase,
          calls: [
            {
              to: usdcBase,
              data: '0x',
              value: 0n,
              provides: [{ token: usdcArbitrum, amount: 1n }],
            },
          ],
        },
        destination: { chain: base, token: usdcBase },
      }),
    )
    expect(error.context.field).toBe('source.calls.0.provides.0.token')
  })
})

describe('customDeadline', () => {
  test('is refused cross-chain', () => {
    const error = thrown(() =>
      normalize({
        customDeadline: 1_000,
        source: { chain: arbitrum, token: usdcArbitrum },
        destination: { chain: base, token: usdcBase, amount: 1n },
      }),
    )
    expect(error.context.field).toBe('customDeadline')
  })

  test('is allowed same-chain via the shorthand', () => {
    const tx = normalize({
      customDeadline: 1_000,
      source: { token: usdcBase },
      destination: { chain: base, token: usdcBase, amount: 1n },
    })
    expect(tx.customDeadline).toBe(1_000)
  })

  test('is allowed same-chain with an explicit equal chain', () => {
    const tx = normalize({
      customDeadline: 1_000,
      source: { chain: base, token: usdcBase },
      destination: { chain: base, token: usdcBase, amount: 1n },
    })
    expect(tx.customDeadline).toBe(1_000)
  })
})

describe('destination.hyperCore', () => {
  test('is refused for a non-HyperCore destination', () => {
    const error = thrown(() =>
      normalize({
        source: { token: usdcBase },
        destination: { chain: base, token: usdcBase, hyperCore: {} },
      }),
    )
    expect(error.context.field).toBe('destination.hyperCore')
  })

  test('is allowed for a HyperCore destination', () => {
    const tx = normalize({
      source: { chain: hyperEvm, token: usdcHyperEvm },
      destination: {
        chain: hyperCorePerp,
        token: hyperCoreToken,
        hyperCore: { action: 'openPerp' },
      },
    })
    expect(tx.destination.hyperCore).toEqual({ action: 'openPerp' })
  })
})

describe('recipient', () => {
  test('recipient + calls is refused', () => {
    const error = thrown(() =>
      normalize({
        source: { token: usdcBase },
        destination: {
          chain: base,
          token: usdcBase,
          recipient: recipientAddress,
          calls: [{ to: usdcBase, data: '0x', value: 0n }],
        },
      }),
    )
    expect(error.context.field).toBe('destination.recipient')
  })

  test('recipient without token is refused', () => {
    const error = thrown(() =>
      normalize({
        destination: { chain: base, recipient: recipientAddress },
      }),
    )
    expect(error.context.field).toBe('destination.recipient')
    expect(error.message).toMatch(/requires `destination\.token`/)
  })

  test('a Tron delivery requires destination.recipient', () => {
    const error = thrown(() =>
      normalize({
        source: { chain: base, token: usdcBase },
        destination: { chain: tronMainnet, token: usdcBase },
      }),
    )
    expect(error.context.field).toBe('destination.recipient')
  })

  test('a Stellar delivery requires destination.recipient', () => {
    const error = thrown(() =>
      normalize({
        source: { chain: base, token: usdcBase },
        destination: { chain: stellarMainnet, token: usdcBase },
      }),
    )
    expect(error.context.field).toBe('destination.recipient')
  })

  test('Tron/Stellar deliveries are accepted with an explicit recipient', () => {
    const tron = normalize({
      source: { chain: base, token: usdcBase },
      destination: {
        chain: tronMainnet,
        token: usdcBase,
        recipient: tronRecipient,
      },
    })
    expect(tron.destination.recipient).toBe(tronRecipient)
    const stellar = normalize({
      source: { chain: base, token: usdcBase },
      destination: {
        chain: stellarMainnet,
        token: usdcBase,
        recipient: stellarRecipient,
      },
    })
    expect(stellar.destination.recipient).toBe(stellarRecipient)
  })
})

describe('EVM -> Solana delivery', () => {
  test('requires destination.token', () => {
    const error = thrown(() =>
      normalize(
        {
          source: { chain: base, token: usdcBase },
          destination: { chain: solanaDevnet },
        },
        evmWithSolanaReceiver,
      ),
    )
    expect(error.context.field).toBe('destination.token')
  })

  test('defaults the recipient from a configured Solana receiver', () => {
    const tx = normalize(
      {
        source: { chain: base, token: usdcBase },
        destination: { chain: solanaDevnet, token: usdcMintDevnet, amount: 1n },
      },
      evmWithSolanaReceiver,
    )
    expect(tx.destination.recipient).toBe(solanaReceiverAddress)
  })

  test('throws AccountVmNotConfiguredError with no solana branch and no recipient', () => {
    expect(() =>
      normalize(
        {
          source: { chain: base, token: usdcBase },
          destination: {
            chain: solanaDevnet,
            token: usdcMintDevnet,
            amount: 1n,
          },
        },
        evmConfigNoSolana,
      ),
    ).toThrow(/solana.*not configured/i)
  })
})

describe('Solana-origin: shared rules', () => {
  test('source.auxiliaryFunds is refused', () => {
    const error = thrown(() =>
      normalize(
        {
          source: { token: usdcMintDevnet, auxiliaryFunds: 1n },
          destination: {
            chain: solanaDevnet,
            token: usdcMintDevnet,
            recipient: solanaRecipient,
          },
        },
        managedSolanaConfig,
      ),
    )
    expect(error.context.field).toBe('source.auxiliaryFunds')
  })

  test('source.calls is refused', () => {
    const error = thrown(() =>
      normalize(
        {
          source: { token: usdcMintDevnet, calls: [] },
          destination: {
            chain: solanaDevnet,
            token: usdcMintDevnet,
            recipient: solanaRecipient,
          },
        },
        managedSolanaConfig,
      ),
    )
    expect(error.context.field).toBe('source.calls')
  })
})

describe('Solana-origin: same-chain transfer', () => {
  test('requires a source', () => {
    const error = thrown(() =>
      normalize(
        {
          destination: {
            chain: solanaDevnet,
            token: usdcMintDevnet,
            recipient: solanaRecipient,
          },
        },
        managedSolanaConfig,
      ),
    )
    expect(error.context.field).toBe('source')
  })

  test('requires source.token === destination.token', () => {
    const error = thrown(() =>
      normalize(
        {
          source: { token: solanaMintAlt },
          destination: {
            chain: solanaDevnet,
            token: usdcMintDevnet,
            recipient: solanaRecipient,
          },
        },
        managedSolanaConfig,
      ),
    )
    expect(error.context.field).toBe('source.token')
  })

  test('native SOL is refused; SPL only', () => {
    const error = thrown(() =>
      normalize(
        {
          source: { token: nativeSol },
          destination: {
            chain: solanaDevnet,
            token: nativeSol,
            recipient: solanaRecipient,
          },
        },
        managedSolanaConfig,
      ),
    )
    expect(error.context.field).toBe('destination.token')
    expect(error.message).toMatch(/cannot send native SOL/)
  })

  test('destination.amount must not exceed source.maxAmount', () => {
    const error = thrown(() =>
      normalize(
        {
          source: { token: usdcMintDevnet, maxAmount: 5n },
          destination: {
            chain: solanaDevnet,
            token: usdcMintDevnet,
            amount: 10n,
            recipient: solanaRecipient,
          },
        },
        managedSolanaConfig,
      ),
    )
    expect(error.context.field).toBe('source.maxAmount')
  })

  test('accepts a valid same-chain SPL transfer, defaulting source.chain', () => {
    const tx = normalize(
      {
        source: { token: usdcMintDevnet, maxAmount: 100n },
        destination: {
          chain: solanaDevnet,
          token: usdcMintDevnet,
          amount: 10n,
          recipient: solanaRecipient,
        },
      },
      managedSolanaConfig,
    )
    expect(tx.source.chain).toEqual(solanaDevnet)
    expect(tx.destination.token).toBe(usdcMintDevnet)
  })

  test('requires a managed Solana account, not an address-only receiver', () => {
    const error = thrown(() =>
      normalize(
        {
          source: { token: usdcMintDevnet },
          destination: {
            chain: solanaDevnet,
            token: usdcMintDevnet,
            recipient: solanaRecipient,
          },
        },
        evmWithSolanaReceiver,
      ),
    )
    expect(error.message).toMatch(/managed Solana source is required/)
  })
})

describe('Solana-origin: instructions', () => {
  const instruction = {
    programId: solanaMintAlt,
    accounts: [],
    data: '',
  }

  test('unsponsored without source is refused', () => {
    const error = thrown(() =>
      normalize(
        {
          destination: { chain: solanaDevnet, instructions: [instruction] },
        },
        managedSolanaConfig,
      ),
    )
    expect(error.context.field).toBe('source')
  })

  test('with source.token is accepted', () => {
    const tx = normalize(
      {
        source: { token: nativeSol },
        destination: { chain: solanaDevnet, instructions: [instruction] },
      },
      managedSolanaConfig,
    )
    expect(tx.source.token).toBe(nativeSol)
    expect(tx.destination.instructions).toHaveLength(1)
  })

  test('sponsored source-free is accepted', () => {
    const tx = normalize(
      {
        sponsored: true,
        destination: { chain: solanaDevnet, instructions: [instruction] },
      },
      managedSolanaConfig,
    )
    expect(tx.source).toBeUndefined()
  })

  test('source.maxAmount is refused', () => {
    const error = thrown(() =>
      normalize(
        {
          source: { token: nativeSol, maxAmount: 1n },
          destination: { chain: solanaDevnet, instructions: [instruction] },
        },
        managedSolanaConfig,
      ),
    )
    expect(error.context.field).toBe('source.maxAmount')
  })

  test('appFees/protocolFees are refused', () => {
    const error = thrown(() =>
      normalize(
        {
          sponsored: true,
          appFees: { feeBps: 1 },
          destination: { chain: solanaDevnet, instructions: [instruction] },
        },
        managedSolanaConfig,
      ),
    )
    expect(error.context.field).toBe('appFees')
  })
})

describe('Solana-origin: authority change', () => {
  const p256Secret = hexToBytes(`0x${'44'.repeat(32)}`)
  const compressedP256 = bytesToHex(
    p256.getPublicKey(p256Secret, true),
  ).toLowerCase()
  const uncompressedP256 = bytesToHex(p256.getPublicKey(p256Secret, false))

  const secpSecret = hexToBytes(`0x${'33'.repeat(32)}`)
  const compressedSecp = bytesToHex(
    secp256k1.getPublicKey(secpSecret, true),
  ).toLowerCase()
  const uncompressedSecp = bytesToHex(secp256k1.getPublicKey(secpSecret, false))

  test('canonicalizes a 65-byte uncompressed P-256 key to compressed', () => {
    const tx = normalize(
      {
        destination: {
          chain: solanaDevnet,
          authority: {
            action: 'add',
            permission: 'all',
            key: { type: 'passkey', publicKey: uncompressedP256 },
          },
        },
      },
      managedSolanaConfig,
    )
    expect(tx.destination.authority.key.publicKey).toBe(compressedP256)
  })

  test('canonicalizes an uncompressed secp256k1 key to compressed', () => {
    const tx = normalize(
      {
        destination: {
          chain: solanaDevnet,
          authority: {
            action: 'remove',
            key: { type: 'ecdsa', publicKey: uncompressedSecp },
          },
        },
      },
      managedSolanaConfig,
    )
    expect(tx.destination.authority.key.publicKey).toBe(compressedSecp)
  })

  test('refuses an EVM address in place of a public key', () => {
    const error = thrown(() =>
      normalize(
        {
          destination: {
            chain: solanaDevnet,
            authority: {
              action: 'remove',
              key: { type: 'ecdsa', publicKey: owner.address },
            },
          },
        },
        managedSolanaConfig,
      ),
    )
    expect(error.message).toMatch(/is an EVM address, not a public key/)
  })

  test('refuses source', () => {
    const error = thrown(() =>
      normalize(
        {
          source: { token: nativeSol },
          destination: {
            chain: solanaDevnet,
            authority: {
              action: 'remove',
              key: { type: 'ecdsa', publicKey: compressedSecp },
            },
          },
        },
        managedSolanaConfig,
      ),
    )
    expect(error.context.field).toBe('source')
  })

  test('refuses sponsored', () => {
    const error = thrown(() =>
      normalize(
        {
          sponsored: true,
          destination: {
            chain: solanaDevnet,
            authority: {
              action: 'remove',
              key: { type: 'ecdsa', publicKey: compressedSecp },
            },
          },
        },
        managedSolanaConfig,
      ),
    )
    expect(error.context.field).toBe('sponsored')
  })

  test('refuses extra fields', () => {
    const error = thrown(() =>
      normalize(
        {
          destination: {
            chain: solanaDevnet,
            foo: 1,
            authority: {
              action: 'remove',
              key: { type: 'ecdsa', publicKey: compressedSecp },
            },
          },
        },
        managedSolanaConfig,
      ),
    )
    expect(error.context.field).toBe('destination.foo')
  })
})

describe('normalizeAuthorityChange', () => {
  test('refuses a transaction with no destination.authority', () => {
    expect(() =>
      normalizeAuthorityChange(
        {
          source: { token: usdcBase },
          destination: { chain: base, token: usdcBase },
        },
        evmConfig,
      ),
    ).toThrow(/getAuthorityStatus. takes a/)
  })

  test('refuses a Solana instructions transaction', () => {
    expect(() =>
      normalizeAuthorityChange(
        {
          sponsored: true,
          destination: {
            chain: solanaDevnet,
            instructions: [
              { programId: solanaMintAlt, accounts: [], data: '' },
            ],
          },
        },
        managedSolanaConfig,
      ),
    ).toThrow(/getAuthorityStatus. takes a/)
  })

  test('accepts a valid authority change', () => {
    const secpSecret = hexToBytes(`0x${'33'.repeat(32)}`)
    const compressedSecp = bytesToHex(secp256k1.getPublicKey(secpSecret, true))
    const tx = normalizeAuthorityChange(
      {
        destination: {
          chain: solanaDevnet,
          authority: {
            action: 'remove',
            key: { type: 'ecdsa', publicKey: compressedSecp },
          },
        },
      },
      managedSolanaConfig,
    )
    expect(isSolanaAuthorityChange(tx)).toBe(true)
  })
})

describe('Solana -> EVM delivery', () => {
  test('requires an explicit source.chain (the destination.chain shorthand does not resolve to Solana)', () => {
    const error = thrown(() =>
      normalize(
        {
          source: { token: usdcMintDevnet },
          destination: { chain: base, token: usdcBase, amount: 1n },
        },
        managedSolanaConfig,
      ),
    )
    expect(error.context.field).toBe('source.token')
  })

  test('requires an EVM destination.token', () => {
    const error = thrown(() =>
      normalize(
        {
          source: { chain: solanaDevnet, token: usdcMintDevnet },
          destination: { chain: base, token: usdcMintDevnet, amount: 1n },
        },
        managedSolanaConfig,
      ),
    )
    expect(error.context.field).toBe('destination.token')
  })

  test('calls with an explicit recipient are refused', () => {
    const error = thrown(() =>
      normalize(
        {
          source: { chain: solanaDevnet, token: usdcMintDevnet },
          destination: {
            chain: base,
            token: usdcBase,
            recipient: recipientAddress,
            calls: [{ to: usdcBase, data: '0x', value: 0n }],
          },
        },
        managedSolanaConfig,
      ),
    )
    expect(error.context.field).toBe('destination.recipient')
  })

  test('gasLimit without calls is refused', () => {
    const error = thrown(() =>
      normalize(
        {
          source: { chain: solanaDevnet, token: usdcMintDevnet },
          destination: { chain: base, token: usdcBase, gasLimit: 100_000n },
        },
        managedSolanaConfig,
      ),
    )
    expect(error.context.field).toBe('destination.gasLimit')
  })

  test('eip7702InitSignature without calls is refused', () => {
    const error = thrown(() =>
      normalize(
        {
          source: { chain: solanaDevnet, token: usdcMintDevnet },
          destination: { chain: base, token: usdcBase },
          eip7702InitSignature: '0xaa',
        },
        managedSolanaConfig,
      ),
    )
    expect(error.context.field).toBe('eip7702InitSignature')
  })

  test('calls without a managed EVM account are refused', () => {
    const error = thrown(() =>
      normalize(
        {
          source: { chain: solanaDevnet, token: usdcMintDevnet },
          destination: {
            chain: base,
            token: usdcBase,
            calls: [{ to: usdcBase, data: '0x', value: 0n }],
          },
        },
        solanaOnlyManagedConfig,
      ),
    )
    expect(error.context.field).toBe('destination.calls')
  })

  test('accepts a valid Solana -> EVM delivery with calls under a managed EVM account', () => {
    const tx = normalize(
      {
        source: { chain: solanaDevnet, token: usdcMintDevnet, maxAmount: 10n },
        destination: {
          chain: base,
          token: usdcBase,
          calls: [{ to: usdcBase, data: '0x', value: 0n }],
          gasLimit: 100_000n,
        },
      },
      managedSolanaConfig,
    )
    expect(tx.source.chain).toEqual(solanaDevnet)
    expect(tx.destination.calls).toHaveLength(1)
  })
})

describe('Solana source cluster validation', () => {
  test('a Solana source on another cluster than destination is refused', () => {
    const error = thrown(() =>
      normalize(
        {
          source: { chain: solanaMainnet, token: usdcMintDevnet },
          destination: {
            chain: solanaDevnet,
            token: usdcMintDevnet,
            recipient: solanaRecipient,
          },
        },
        managedSolanaConfig,
      ),
    )
    expect(error.context.field).toBe('source.chain')
    expect(error.message).toMatch(/own cluster only/)
  })
})

describe('routing predicates on normalized outputs', () => {
  const evmOnlyTx = normalize({
    source: { token: usdcBase },
    destination: { chain: base, token: usdcBase, amount: 1n },
  })
  const sameChainSolanaTx = normalize(
    {
      source: { token: usdcMintDevnet, maxAmount: 100n },
      destination: {
        chain: solanaDevnet,
        token: usdcMintDevnet,
        amount: 10n,
        recipient: solanaRecipient,
      },
    },
    managedSolanaConfig,
  )
  const instructionsTx = normalize(
    {
      sponsored: true,
      destination: {
        chain: solanaDevnet,
        instructions: [{ programId: solanaMintAlt, accounts: [], data: '' }],
      },
    },
    managedSolanaConfig,
  )
  const secpSecret = hexToBytes(`0x${'33'.repeat(32)}`)
  const compressedSecp = bytesToHex(secp256k1.getPublicKey(secpSecret, true))
  const authorityTx = normalize(
    {
      destination: {
        chain: solanaDevnet,
        authority: {
          action: 'remove',
          key: { type: 'ecdsa', publicKey: compressedSecp },
        },
      },
    },
    managedSolanaConfig,
  )
  const crossChainTx = normalize(
    {
      source: { chain: solanaDevnet, token: usdcMintDevnet },
      destination: { chain: base, token: usdcBase, amount: 1n },
    },
    managedSolanaConfig,
  )

  test('isSolanaOrigin', () => {
    expect(isSolanaOrigin(evmOnlyTx)).toBe(false)
    expect(isSolanaOrigin(sameChainSolanaTx)).toBe(true)
    expect(isSolanaOrigin(instructionsTx)).toBe(true)
    expect(isSolanaOrigin(authorityTx)).toBe(true)
    expect(isSolanaOrigin(crossChainTx)).toBe(true)
  })

  test('isCrossChainSolanaOrigin', () => {
    expect(isCrossChainSolanaOrigin(evmOnlyTx)).toBe(false)
    expect(isCrossChainSolanaOrigin(sameChainSolanaTx)).toBe(false)
    expect(isCrossChainSolanaOrigin(instructionsTx)).toBe(false)
    expect(isCrossChainSolanaOrigin(authorityTx)).toBe(false)
    expect(isCrossChainSolanaOrigin(crossChainTx)).toBe(true)
  })

  test('isSolanaInstructionExecution', () => {
    expect(isSolanaInstructionExecution(evmOnlyTx)).toBe(false)
    expect(isSolanaInstructionExecution(sameChainSolanaTx)).toBe(false)
    expect(isSolanaInstructionExecution(instructionsTx)).toBe(true)
    expect(isSolanaInstructionExecution(authorityTx)).toBe(false)
  })

  test('isSolanaAuthorityChange', () => {
    expect(isSolanaAuthorityChange(evmOnlyTx)).toBe(false)
    expect(isSolanaAuthorityChange(sameChainSolanaTx)).toBe(false)
    expect(isSolanaAuthorityChange(instructionsTx)).toBe(false)
    expect(isSolanaAuthorityChange(authorityTx)).toBe(true)
  })
})

describe('synchronous, catalog-free normalization', () => {
  test('normalizeTransaction returns synchronously, with no chain catalog lookup', () => {
    const result = normalizeTransaction(
      {
        source: { token: usdcBase },
        destination: { chain: base, token: usdcBase, amount: 1n },
      } as Transaction,
      evmConfig,
    )
    expect(result).not.toBeInstanceOf(Promise)
    expect(typeof (result as any).then).not.toBe('function')
  })
})
