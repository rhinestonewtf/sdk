import { base58 } from '@scure/base'
import { getAccount } from '@solana/spl-token'
import {
  type Connection,
  Keypair,
  SystemProgram,
  Transaction,
} from '@solana/web3.js'
import {
  Actions,
  fetchSwig,
  getSwigWalletAddress,
  Secp256k1Authority,
} from '@swig-wallet/classic'
import { keccak256, type PublicClient, type WalletClient } from 'viem'
import { estimateTotalFee } from 'viem/op-stack'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { solanaDevnet } from '../../../../src/solana/index'
import { SolanaSuiteSafety } from '../solana-matrix'
import { SolanaRequestScope } from './deadline'
import {
  assertVerifiedSolanaFixture,
  deployAndVerifySolanaFixture,
  deriveCompatibleSwig,
  type SolanaFixture,
  verifySolanaFixtureAuthority,
} from './fixture'
import {
  fundBaseSepoliaShortfall,
  SolanaFundingBudget,
  SolanaFundingHarness,
} from './funding'

vi.mock('viem/op-stack', () => ({ estimateTotalFee: vi.fn() }))

import { DEVNET_GENESIS, DEVNET_USDC, SWIG_PROGRAM, usdcAta } from './rpc'

vi.mock('@swig-wallet/classic', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@swig-wallet/classic')>()
  return {
    ...actual,
    fetchSwig: vi.fn(),
    getSwigWalletAddress: vi.fn(),
    Secp256k1Authority: class {
      secp256k1AddressString = '0x1234567890123456789012345678901234567890'
    },
  }
})
vi.mock('@solana/spl-token', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@solana/spl-token')>()
  return {
    ...actual,
    getMint: vi.fn().mockResolvedValue({ decimals: 6, isInitialized: true }),
    getAccount: vi.fn(),
  }
})
const evmAddress = '0x1234567890123456789012345678901234567890'
function fixtureForTest() {
  const derived = deriveCompatibleSwig(evmAddress, 'dev')
  const connection = {
    getGenesisHash: vi.fn().mockResolvedValue(DEVNET_GENESIS),
    getAccountInfo: vi.fn().mockImplementation(async (address) => ({
      owner: address.equals(derived.swig)
        ? SWIG_PROGRAM
        : SystemProgram.programId,
    })),
    getBalance: vi.fn().mockResolvedValue(10_000_000),
    getLatestBlockhash: vi.fn().mockResolvedValue({
      blockhash: Keypair.generate().publicKey.toBase58(),
      lastValidBlockHeight: 123,
    }),
    getFeeForMessage: vi.fn().mockResolvedValue({ value: 5000 }),
    getMinimumBalanceForRentExemption: vi.fn().mockResolvedValue(2_039_280),
    sendRawTransaction: vi.fn().mockResolvedValue('public-signature'),
    getTransaction: vi.fn().mockResolvedValue({ meta: { err: null } }),
  }
  const fixture = {
    ...derived,
    requests: new SolanaRequestScope(),
    withRequests: <T>(run: () => Promise<T>, timeoutMs?: number) =>
      fixture.requests.wait(run, timeoutMs),
    evmAddress,
    owner: { address: evmAddress },
    recipient: Keypair.generate(),
    connection: connection as unknown as Connection,
    evmClient: {
      getChainId: vi.fn().mockResolvedValue(84532),
    } as unknown as PublicClient,
  } as unknown as SolanaFixture
  const root = {
    authority: new Secp256k1Authority(new Uint8Array()),
    actions: Actions.set().all().get(),
  }
  const swig = {
    id: derived.id,
    roles: [root],
    findRoleById: vi.fn().mockReturnValue(root),
  }
  vi.mocked(fetchSwig).mockResolvedValue(
    swig as unknown as Awaited<ReturnType<typeof fetchSwig>>,
  )
  vi.mocked(getSwigWalletAddress).mockResolvedValue(derived.wallet)
  vi.mocked(getAccount).mockResolvedValue({
    owner: derived.wallet,
    mint: DEVNET_USDC,
    amount: 100_000n,
    isInitialized: true,
    isFrozen: false,
  } as Awaited<ReturnType<typeof getAccount>>)
  return { fixture, connection, swig, root }
}
afterEach(() => vi.useRealTimers())
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(estimateTotalFee).mockResolvedValue(30_000n)
})
describe('verified fixture gates and bounded funding', () => {
  test('only onchain identity plus exact root All permission unlock funding', async () => {
    const { fixture } = fixtureForTest()
    expect(() => assertVerifiedSolanaFixture(fixture)).toThrow('not verified')
    await verifySolanaFixtureAuthority(fixture)
    expect(() => assertVerifiedSolanaFixture(fixture)).not.toThrow()
  })
  test.each([
    'program',
    'wallet',
    'identity',
    'permissions',
    'authority',
    'wallet-owner',
  ])('refuses %s mismatch', async (mismatch) => {
    const { fixture, connection, swig, root } = fixtureForTest()
    if (mismatch === 'program')
      connection.getAccountInfo.mockResolvedValue({
        owner: SystemProgram.programId,
      })
    if (mismatch === 'wallet')
      vi.mocked(getSwigWalletAddress).mockResolvedValue(
        Keypair.generate().publicKey,
      )
    if (mismatch === 'identity') swig.id = Buffer.alloc(32)
    if (mismatch === 'permissions')
      root.actions = Actions.set().manageAuthority().get()
    if (mismatch === 'authority')
      Object.defineProperty(root.authority, 'secp256k1AddressString', {
        value: '0x0000000000000000000000000000000000000001',
      })
    if (mismatch === 'wallet-owner')
      connection.getAccountInfo.mockResolvedValue({ owner: SWIG_PROGRAM })
    await expect(verifySolanaFixtureAuthority(fixture)).rejects.toThrow(
      'mismatch',
    )
    expect(() => assertVerifiedSolanaFixture(fixture)).toThrow('not verified')
    expect(connection.sendRawTransaction).not.toHaveBeenCalled()
  })
  test('unverified and wrong-network funding never write', async () => {
    const { fixture, connection } = fixtureForTest()
    const funding = new SolanaFundingHarness(fixture, Keypair.generate())
    await expect(
      funding.fundShortfall({ usdc: 0n, lamports: 0n }),
    ).rejects.toThrow('not verified')
    await verifySolanaFixtureAuthority(fixture)
    connection.getGenesisHash.mockResolvedValue('mainnet')
    await expect(
      funding.fundShortfall({ usdc: 0n, lamports: 0n }),
    ).rejects.toThrow('require Solana Devnet')
    expect(connection.sendRawTransaction).not.toHaveBeenCalled()
  })
  test('existing balances do not cause topups or fees', async () => {
    const { fixture, connection } = fixtureForTest()
    await verifySolanaFixtureAuthority(fixture)
    const funding = new SolanaFundingHarness(fixture, Keypair.generate())
    await funding.fundShortfall({ usdc: 10_000n, lamports: 10n })
    expect(connection.sendRawTransaction).not.toHaveBeenCalled()
    expect(funding.budget.snapshot().solLamports).toBe(0n)
  })
  test('SOL shortfall includes fee and refuses insufficient funder headroom before writing', async () => {
    const { fixture, connection } = fixtureForTest()
    await verifySolanaFixtureAuthority(fixture)
    const funding = new SolanaFundingHarness(fixture, Keypair.generate())
    connection.getBalance.mockResolvedValue(0)
    await expect(
      funding.fundShortfall({ usdc: 0n, lamports: 100n }),
    ).rejects.toThrow('rent/fee headroom')
    expect(connection.sendRawTransaction).not.toHaveBeenCalled()
  })
  test('successful funding sends only the native shortfall and accounts for its fee', async () => {
    const { fixture, connection } = fixtureForTest()
    await verifySolanaFixtureAuthority(fixture)
    const funder = Keypair.generate()
    let funded = false
    connection.getBalance.mockImplementation(async (address) =>
      address.equals(funder.publicKey) ? 10_000_000 : funded ? 200 : 100,
    )
    connection.sendRawTransaction.mockImplementation(async () => {
      funded = true
      return 'public-signature'
    })
    const funding = new SolanaFundingHarness(fixture, funder)
    const result = await funding.fundShortfall({
      usdc: 100_000n,
      lamports: 200n,
    })
    expect(result.before.lamports).toBe(100n)
    expect(result.after.lamports).toBe(200n)
    expect(funding.budget.snapshot()).toMatchObject({
      solLamports: 5100n,
      solUsdc: 0n,
    })
    await funding.fundShortfall({ usdc: 100_000n, lamports: 200n })
    expect(connection.sendRawTransaction).toHaveBeenCalledTimes(1)
  })
  test('aggregate budget refuses a transfer before submitting', async () => {
    const { fixture, connection } = fixtureForTest()
    await verifySolanaFixtureAuthority(fixture)
    const funder = Keypair.generate()
    connection.getBalance.mockImplementation(async (address) =>
      address.equals(funder.publicKey) ? 1_000_000_000 : 0,
    )
    const funding = new SolanaFundingHarness(fixture, funder)
    await expect(
      funding.fundShortfall({ usdc: 0n, lamports: 100_000_000n }),
    ).rejects.toThrow('budget exceeded')
    expect(connection.sendRawTransaction).not.toHaveBeenCalled()
  })
  test('recipient native rent is initialized once before a tiny SOL instruction transfer', async () => {
    const { fixture, connection } = fixtureForTest()
    await verifySolanaFixtureAuthority(fixture)
    const funder = Keypair.generate()
    let funded = false
    connection.getBalance.mockImplementation(async (address) =>
      address.equals(fixture.recipient.publicKey)
        ? funded
          ? 2_039_280
          : 0
        : 10_000_000,
    )
    connection.sendRawTransaction.mockImplementation(async () => {
      funded = true
      return 'public-signature'
    })
    vi.mocked(getAccount).mockImplementation(
      async (_connection, address) =>
        ({
          owner: address.equals(usdcAta(fixture.recipient.publicKey))
            ? fixture.recipient.publicKey
            : fixture.wallet,
          mint: DEVNET_USDC,
          amount: 0n,
          isInitialized: true,
          isFrozen: false,
        }) as Awaited<ReturnType<typeof getAccount>>,
    )
    const funding = new SolanaFundingHarness(fixture, funder)
    await funding.setupTokenAccounts()
    expect(funding.budget.snapshot().solLamports).toBe(2_044_280n)
    await funding.setupTokenAccounts()
    expect(connection.sendRawTransaction).toHaveBeenCalledTimes(1)
  })
  test('ATA setup refuses rent plus fee headroom before writing', async () => {
    const { fixture, connection } = fixtureForTest()
    await verifySolanaFixtureAuthority(fixture)
    connection.getAccountInfo.mockResolvedValue(null)
    connection.getBalance.mockResolvedValue(4_078_560)
    const funding = new SolanaFundingHarness(fixture, Keypair.generate())
    await expect(funding.setupTokenAccounts()).rejects.toThrow(
      'rent/fee headroom',
    )
    expect(connection.sendRawTransaction).not.toHaveBeenCalled()
  })
  test('failed receipt blocks any refill or retry', async () => {
    const { fixture, connection } = fixtureForTest()
    await verifySolanaFixtureAuthority(fixture)
    const funder = Keypair.generate()
    connection.getBalance.mockImplementation(async (address) =>
      address.equals(funder.publicKey) ? 10_000_000 : 0,
    )
    connection.getTransaction.mockResolvedValue({
      meta: { err: { InstructionError: [0, 'failed'] } },
    })
    const funding = new SolanaFundingHarness(fixture, funder)
    await expect(
      funding.fundShortfall({ usdc: 0n, lamports: 100n }),
    ).rejects.toThrow('receipt failed')
    await expect(
      funding.fundShortfall({ usdc: 0n, lamports: 100n }),
    ).rejects.toThrow('unresolved')
    expect(connection.sendRawTransaction).toHaveBeenCalledTimes(1)
  })
  test('unknown submission poisons subsequent funding instead of retrying', async () => {
    const { fixture, connection } = fixtureForTest()
    await verifySolanaFixtureAuthority(fixture)
    const funder = Keypair.generate()
    connection.getBalance.mockImplementation(async (address) =>
      address.equals(funder.publicKey) ? 10_000_000 : 0,
    )
    connection.sendRawTransaction.mockRejectedValue(
      new Error('transport lost after write'),
    )
    const funding = new SolanaFundingHarness(fixture, funder)
    await expect(
      funding.fundShortfall({ usdc: 0n, lamports: 100n }),
    ).rejects.toThrow('transport lost')
    expect(funding.budget.snapshot().solLamports).toBe(5100n)
    await expect(
      funding.fundShortfall({ usdc: 0n, lamports: 100n }),
    ).rejects.toThrow('unresolved')
    expect(connection.sendRawTransaction).toHaveBeenCalledTimes(1)
  })
})

describe('funding evidence persistence', () => {
  test.each(['receipt failure', 'receipt timeout', 'broadcast timeout'])(
    'persists the signed Solana reference before %s',
    async (failure) => {
      const { fixture, connection } = fixtureForTest()
      await verifySolanaFixtureAuthority(fixture)
      const funder = Keypair.generate()
      connection.getBalance.mockImplementation(async (address) =>
        address.equals(funder.publicKey) ? 10_000_000 : 0,
      )
      const persisted: string[] = []
      const persist = vi.fn(async (signature: string) => {
        await Promise.resolve()
        persisted.push(signature)
      })
      connection.sendRawTransaction.mockImplementation(async (raw) => {
        const signature = Transaction.from(raw).signature
        expect(signature).not.toBeNull()
        expect(persisted).toEqual([base58.encode(signature!)])
        if (failure === 'broadcast timeout')
          throw new Error('broadcast timeout')
        return persisted[0]
      })
      connection.getTransaction.mockImplementation(async (signature) => {
        expect(persisted).toEqual([signature])
        return failure === 'receipt timeout'
          ? null
          : { meta: { err: { InstructionError: [0, 'failed'] } } }
      })
      const funding = new SolanaFundingHarness(
        fixture,
        funder,
        undefined,
        undefined,
        persist,
      )
      vi.useFakeTimers()
      try {
        const rejected = expect(
          funding.fundShortfall({ usdc: 0n, lamports: 100n }),
        ).rejects.toThrow(
          failure === 'receipt failure' ? 'receipt failed' : 'timeout',
        )
        await vi.advanceTimersByTimeAsync(60_001)
        await rejected
        expect(persist).toHaveBeenCalledTimes(1)
        expect(persisted).toHaveLength(1)
        await expect(
          funding.fundShortfall({ usdc: 0n, lamports: 100n }),
        ).rejects.toThrow('unresolved')
        expect(connection.sendRawTransaction).toHaveBeenCalledTimes(1)
        expect(funding.budget.snapshot().solLamports).toBe(5100n)
      } finally {
        vi.useRealTimers()
      }
    },
  )

  test.each(['fund', 'setup'])(
    'failed persistence prevents Solana %s broadcast',
    async (operation) => {
      const { fixture, connection } = fixtureForTest()
      await verifySolanaFixtureAuthority(fixture)
      const funder = Keypair.generate()
      connection.getBalance.mockImplementation(async (address) =>
        address.equals(funder.publicKey) ? 10_000_000 : 0,
      )
      const funding = new SolanaFundingHarness(
        fixture,
        funder,
        undefined,
        undefined,
        async () => {
          throw new Error('evidence unavailable')
        },
      )
      await expect(
        operation === 'fund'
          ? funding.fundShortfall({ usdc: 0n, lamports: 100n })
          : funding.setupTokenAccounts(),
      ).rejects.toThrow('evidence unavailable')
      expect(connection.sendRawTransaction).not.toHaveBeenCalled()
      expect(connection.getTransaction).not.toHaveBeenCalled()
      await expect(funding.setupTokenAccounts()).rejects.toThrow('unresolved')
    },
  )
})

describe('funding deadlines and OP Stack fees', () => {
  test.each(['fund', 'setup'])(
    'expired deadline after fee await blocks Solana %s write',
    async (operation) => {
      const { fixture, connection } = fixtureForTest()
      await verifySolanaFixtureAuthority(fixture)
      let active = true
      const funder = Keypair.generate()
      connection.getBalance.mockImplementation(async (address) =>
        address.equals(funder.publicKey) ? 10_000_000 : 0,
      )
      connection.getFeeForMessage.mockImplementation(async () => {
        active = false
        return { value: 5000 }
      })
      const funding = new SolanaFundingHarness(
        fixture,
        funder,
        undefined,
        () => {
          if (!active) throw new Error('deadline expired')
        },
      )
      await expect(
        operation === 'fund'
          ? funding.fundShortfall({ usdc: 0n, lamports: 100n })
          : funding.setupTokenAccounts(),
      ).rejects.toThrow('deadline expired')
      expect(connection.sendRawTransaction).not.toHaveBeenCalled()
    },
  )

  async function baseSetup() {
    const { fixture } = fixtureForTest()
    await verifySolanaFixtureAuthority(fixture)
    let writes = 0
    const publicClient = {
      getChainId: vi.fn().mockResolvedValue(84532),
      getBalance: vi
        .fn()
        .mockImplementation(async ({ address }) =>
          address === evmAddress ? (writes ? 100n : 0n) : 10n ** 18n,
        ),
      readContract: vi
        .fn()
        .mockImplementation(async ({ args }) =>
          args[0] === evmAddress ? (writes === 2 ? 100n : 0n) : 1000n,
        ),
      getGasPrice: vi.fn().mockResolvedValue(1n),
      estimateGas: vi.fn().mockResolvedValue(21_000n),
      waitForTransactionReceipt: vi
        .fn()
        .mockResolvedValue({ status: 'success' }),
    }
    const walletClient = {
      account: {
        address: '0x0000000000000000000000000000000000000001',
        type: 'local',
      },
      getChainId: vi.fn().mockResolvedValue(84532),
      prepareTransactionRequest: vi.fn(async (request) => request),
      signTransaction: vi
        .fn()
        .mockResolvedValueOnce('0x1234')
        .mockResolvedValue('0x5678'),
      sendRawTransaction: vi.fn().mockImplementation(async () => {
        writes++
        return keccak256(writes === 1 ? '0x1234' : '0x5678')
      }),
    }
    const budget = new SolanaFundingBudget()
    const input = {
      fixture,
      publicClient: publicClient as unknown as PublicClient,
      walletClient: walletClient as unknown as WalletClient,
      budget,
      target: { wei: 100n, usdc: 0n },
    }
    return { input, publicClient, walletClient, budget }
  }

  test.each([
    'receipt failure',
    'receipt timeout',
    'broadcast timeout',
    'later write',
    'persistence',
  ])(
    'retains Base evidence and blocks further spending after %s failure',
    async (failure) => {
      const { input, publicClient, walletClient, budget } = await baseSetup()
      input.target.usdc = 100n
      const persisted: string[] = []
      const persistTransaction = vi.fn(async (hash: string) => {
        await Promise.resolve()
        if (failure === 'persistence') throw new Error('evidence unavailable')
        persisted.push(hash)
      })
      publicClient.waitForTransactionReceipt.mockImplementation(
        async ({ hash }) => {
          expect(persisted).toEqual([hash])
          if (failure === 'receipt timeout') throw new Error('receipt timeout')
          return {
            status: failure === 'receipt failure' ? 'reverted' : 'success',
          }
        },
      )
      walletClient.sendRawTransaction.mockImplementation(
        async ({ serializedTransaction }) => {
          const hash = keccak256(serializedTransaction)
          expect(persisted.at(-1)).toBe(hash)
          if (failure === 'broadcast timeout')
            throw new Error('broadcast timeout')
          if (failure === 'later write' && persisted.length === 2)
            throw new Error('later write failed')
          return hash
        },
      )
      await expect(
        fundBaseSepoliaShortfall({ ...input, persistTransaction }),
      ).rejects.toThrow(
        failure === 'persistence'
          ? 'evidence unavailable'
          : failure === 'later write'
            ? 'later write failed'
            : failure === 'receipt timeout'
              ? 'receipt timeout'
              : failure === 'broadcast timeout'
                ? 'broadcast timeout'
                : 'receipt failed',
      )
      expect(persistTransaction).toHaveBeenNthCalledWith(1, keccak256('0x1234'))
      expect(persistTransaction).toHaveBeenCalledTimes(
        failure === 'later write' ? 2 : 1,
      )
      expect(persisted).toEqual(
        failure === 'persistence'
          ? []
          : failure === 'later write'
            ? [keccak256('0x1234'), keccak256('0x5678')]
            : [keccak256('0x1234')],
      )
      expect(publicClient.waitForTransactionReceipt).toHaveBeenCalledTimes(
        failure === 'persistence' || failure === 'broadcast timeout' ? 0 : 1,
      )
      await expect(fundBaseSepoliaShortfall(input)).rejects.toThrow(
        'unresolved',
      )
      expect(walletClient.sendRawTransaction).toHaveBeenCalledTimes(
        failure === 'persistence' ? 0 : failure === 'later write' ? 2 : 1,
      )
      expect(budget.snapshot()).toMatchObject({
        baseWei: 120_100n,
        baseUsdc: 100n,
      })
    },
  )

  test('reserves bounded L1-inclusive fees for native and token writes, and no fees for no-op', async () => {
    const { input, walletClient, budget } = await baseSetup()
    input.target.usdc = 100n
    await fundBaseSepoliaShortfall(input)
    expect(estimateTotalFee).toHaveBeenCalledTimes(2)
    expect(estimateTotalFee).toHaveBeenCalledWith(
      input.publicClient,
      expect.objectContaining({
        chain: expect.objectContaining({ id: 84532 }),
        gas: 21_000n,
      }),
    )
    expect(budget.snapshot()).toMatchObject({
      baseWei: 120_100n,
      baseUsdc: 100n,
    })
    await fundBaseSepoliaShortfall(input)
    expect(walletClient.sendRawTransaction).toHaveBeenCalledTimes(2)
    expect(estimateTotalFee).toHaveBeenCalledTimes(2)
  })

  test.each(['unavailable', 'negative', 'over-budget', 'headroom'])(
    'fails closed for %s full fee estimate',
    async (reason) => {
      const { input, publicClient, walletClient } = await baseSetup()
      if (reason === 'unavailable')
        vi.mocked(estimateTotalFee).mockRejectedValueOnce(
          new Error('oracle unavailable'),
        )
      if (reason === 'negative')
        vi.mocked(estimateTotalFee).mockResolvedValueOnce(-1n)
      if (reason === 'over-budget')
        vi.mocked(estimateTotalFee).mockResolvedValueOnce(
          1_000_000_000_000_000n,
        )
      if (reason === 'headroom')
        publicClient.getBalance.mockImplementation(async ({ address }) =>
          address === evmAddress ? 0n : 30_000n,
        )
      await expect(fundBaseSepoliaShortfall(input)).rejects.toThrow()
      expect(walletClient.sendRawTransaction).not.toHaveBeenCalled()
    },
  )

  test('rejects non-local Base signers before signing or broadcasting', async () => {
    const { input, walletClient } = await baseSetup()
    walletClient.account.type = 'json-rpc'
    await expect(fundBaseSepoliaShortfall(input)).rejects.toThrow(
      'local signer',
    )
    expect(walletClient.prepareTransactionRequest).not.toHaveBeenCalled()
    expect(walletClient.signTransaction).not.toHaveBeenCalled()
    expect(walletClient.sendRawTransaction).not.toHaveBeenCalled()
  })

  test.each(['estimate', 'receipt', 'persistence'])(
    'deadline expiring during %s blocks the next Base write',
    async (stage) => {
      const { input, publicClient, walletClient } = await baseSetup()
      input.target.usdc = 100n
      let active = true
      const expire = async () => {
        active = false
        return 30_000n
      }
      if (stage === 'estimate')
        vi.mocked(estimateTotalFee).mockImplementationOnce(expire)
      else if (stage === 'receipt')
        publicClient.waitForTransactionReceipt.mockImplementationOnce(
          async () => {
            active = false
            return { status: 'success' }
          },
        )
      await expect(
        fundBaseSepoliaShortfall({
          ...input,
          persistTransaction: async () => {
            if (stage === 'persistence') active = false
          },
          assertActive: () => {
            if (!active) throw new Error('deadline expired')
          },
        }),
      ).rejects.toThrow('deadline expired')
      expect(walletClient.sendRawTransaction).toHaveBeenCalledTimes(
        stage === 'receipt' ? 1 : 0,
      )
    },
  )
})

describe('deployment quote selection and idempotency', () => {
  function deploymentSetup() {
    const { fixture, connection } = fixtureForTest()
    fixture.deploymentEvidence = [
      { intentId: 'unused', quotedAmounts: ['100'], submissions: 0 },
      { intentId: 'selected', quotedAmounts: ['200'], submissions: 1 },
      { intentId: 'another', quotedAmounts: ['300'], submissions: 0 },
    ]
    const deploy = vi.fn().mockResolvedValue(undefined)
    fixture.account = { deploy } as unknown as SolanaFixture['account']
    fixture.sdk = {
      getIntentStatus: vi.fn().mockResolvedValue({
        status: 'COMPLETED',
        purpose: 'deployment',
        operations: [
          {
            chainId: solanaDevnet.caip2,
            items: [
              {
                status: 'COMPLETED',
                transaction: {
                  vm: 'svm',
                  chainId: solanaDevnet.caip2,
                  signature: 'public-signature',
                },
              },
            ],
          },
        ],
      }),
    } as unknown as SolanaFixture['sdk']
    connection.getAccountInfo.mockResolvedValueOnce(null)
    return { fixture, deploy }
  }
  test('pending deployment rejects inside the guard, preserves evidence and revokes late writes', async () => {
    vi.useFakeTimers()
    const { fixture, deploy } = deploymentSetup()
    const safety = new SolanaSuiteSafety()
    const failures: unknown[] = []
    const network = vi.fn(async () => Response.json({ status: 'PENDING' }))
    const fetcher = fixture.requests.fetch(network as unknown as typeof fetch)
    deploy.mockImplementationOnce(async () => {
      // Model the SDK's deadline-free PENDING status loop.
      for (;;) {
        const response = await fetcher('https://example.test/intents/selected')
        if ((await response.json()).status !== 'PENDING') return
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    })
    const run = safety.guard(
      'setup',
      async () => {
        await deployAndVerifySolanaFixture(fixture)
      },
      async (error) => {
        failures.push({
          stage: 'deploy-and-verify',
          error,
          evidence: structuredClone(fixture.deploymentEvidence),
        })
        expect(() => safety.assertActive()).toThrow()
      },
    )
    const rejected = expect(run).rejects.toThrow('RPC timeout')
    await vi.advanceTimersByTimeAsync(60_000)
    await rejected
    expect(failures).toEqual([
      expect.objectContaining({
        stage: 'deploy-and-verify',
        evidence: expect.arrayContaining([
          expect.objectContaining({
            intentId: 'selected',
            submissions: 1,
            quotedAmounts: ['200'],
          }),
        ]),
      }),
    ])
    expect(deploy).toHaveBeenCalledTimes(1)
    expect(fixture.sdk.getIntentStatus).not.toHaveBeenCalled()
    expect(() => safety.begin()).toThrow('setup')
    const reads = network.mock.calls.length
    await vi.advanceTimersByTimeAsync(10_000)
    expect(network).toHaveBeenCalledTimes(reads)
    await expect(
      fetcher('https://example.test/intents', { method: 'POST' }),
    ).rejects.toThrow('revoked')
    expect(network).toHaveBeenCalledTimes(reads)
  })

  test('accepts multiple valid quotes but verifies only the submitted intent', async () => {
    const { fixture, deploy } = deploymentSetup()
    const result = await deployAndVerifySolanaFixture(fixture)
    expect(result.evidence.intentId).toBe('selected')
    expect(fixture.sdk.getIntentStatus).toHaveBeenCalledWith('selected')
    expect(deploy).toHaveBeenCalledTimes(2)
  })
  test.each(['duplicate', 'two', 'none'])(
    'refuses %s submissions',
    async (reason) => {
      const { fixture } = deploymentSetup()
      if (reason === 'duplicate') fixture.deploymentEvidence[1].submissions = 2
      if (reason === 'two') fixture.deploymentEvidence[0].submissions = 1
      if (reason === 'none') fixture.deploymentEvidence[1].submissions = 0
      await expect(deployAndVerifySolanaFixture(fixture)).rejects.toThrow()
    },
  )
  test.each(['other-submission', 'quote', 'replacement'])(
    'idempotency catches %s evidence changes',
    async (change) => {
      const { fixture, deploy } = deploymentSetup()
      deploy
        .mockResolvedValueOnce(undefined)
        .mockImplementationOnce(async () => {
          if (change === 'other-submission')
            fixture.deploymentEvidence[0].submissions++
          if (change === 'quote')
            fixture.deploymentEvidence[0].quotedAmounts.push('400')
          if (change === 'replacement')
            fixture.deploymentEvidence[1] = {
              ...fixture.deploymentEvidence[1],
              submissions: 2,
            }
        })
      await expect(deployAndVerifySolanaFixture(fixture)).rejects.toThrow(
        'Idempotent deployment',
      )
    },
  )
})
