import { createHash } from 'node:crypto'
import {
  createTransferCheckedInstruction,
  decodeTransferCheckedInstruction,
} from '@solana/spl-token'
import {
  type Connection,
  Keypair,
  PublicKey,
  SystemInstruction,
} from '@solana/web3.js'
import type { PublicClient } from 'viem'
import { describe, expect, test, vi } from 'vitest'
import {
  asSwigNamespace,
  locateSwig,
} from '../../../src/accounts/solana/address'
import type { TransactionStatus } from '../../../src/transactions/intents/types'
import {
  assertDeliveryCap,
  assertSolanaTestNetworks,
  BASE_SEPOLIA_USDC,
  DEVNET_GENESIS,
  DEVNET_USDC,
  deriveCompatibleSwig,
  fundingShortfall,
  observeDeploymentFetch,
  pollSolana,
  SolanaFundingBudget,
  safeSolanaDiagnostic,
  solTransferInstruction,
  usdcAta,
  usdcTransferInstruction,
  verifyIntentReceipts,
  waitForSolanaReceipt,
  waitForTerminalIntent,
} from './solana'

const evmAddress = '0x1234567890123456789012345678901234567890'
describe('Solana independent harness guards', () => {
  test.each(['dev', 'prod'] as const)(
    'independent SHA256/PDA agrees with SDK for %s compatible pair',
    (service) => {
      const derived = deriveCompatibleSwig(evmAddress, service)
      const sdk = locateSwig(asSwigNamespace(`${service}-v1`), evmAddress)
      expect(derived.swig.toBase58()).toBe(sdk.swig)
      expect(derived.wallet.toBase58()).toBe(sdk.wallet)
      expect(derived.id).toEqual(
        createHash('sha256')
          .update(`rhinestone:swig:v1:${service}-v1:${evmAddress}`)
          .digest(),
      )
      expect(PublicKey.isOnCurve(derived.wallet.toBytes())).toBe(false)
      expect(usdcAta(derived.wallet)).toBeInstanceOf(PublicKey)
    },
  )
  test.each([
    [DEVNET_GENESIS, 1],
    ['mainnet-genesis', 84532],
  ])(
    'refuses wrong network %s/%s before caller writes',
    async (genesis, chainId) => {
      const write = vi.fn()
      await expect(
        (async () => {
          await assertSolanaTestNetworks(
            { getGenesisHash: vi.fn().mockResolvedValue(genesis) },
            { getChainId: vi.fn().mockResolvedValue(chainId) },
          )
          write()
        })(),
      ).rejects.toThrow('require Solana Devnet and Base Sepolia')
      expect(write).not.toHaveBeenCalled()
    },
  )
  test('funds shortfall only, rejects negative inputs', () => {
    expect(fundingShortfall(15n, 10n)).toBe(0n)
    expect(fundingShortfall(10n, 15n)).toBe(5n)
    expect(() => fundingShortfall(0n, -1n)).toThrow('Negative')
  })
  test('aggregate budgets include rent/fee headroom and reject atomically', () => {
    const budget = new SolanaFundingBudget()
    budget.reserve({ solLamports: 99_990_000n, solUsdc: 4_000_000n })
    expect(() => budget.reserve({ solLamports: 10_001n, solUsdc: 1n })).toThrow(
      'solLamports',
    )
    expect(budget.snapshot().solUsdc).toBe(4_000_000n)
    budget.reserve({ solLamports: 10_000n, solUsdc: 1_000_000n })
    expect(() => budget.reserve({ solUsdc: 1n })).toThrow('solUsdc')
    expect(() => budget.reserve({ baseWei: -1n })).toThrow()
  })
  test('caps bound actual delivery debit and cannot increase default ceiling', () => {
    assertDeliveryCap(500_000n)
    expect(() => assertDeliveryCap(500_001n)).toThrow('cap')
    expect(() => assertDeliveryCap(0n, 0n)).toThrow('cap')
    expect(() => assertDeliveryCap(1n, 1_000_000n)).toThrow('cap')
  })
  test('constructs official native and checked SPL transfers, not bespoke encodings', () => {
    const wallet = Keypair.generate().publicKey
    const recipient = Keypair.generate().publicKey
    const sol = SystemInstruction.decodeTransfer(
      solTransferInstruction(wallet, recipient),
    )
    expect(sol.lamports).toBe(100_000n)
    expect(sol.toPubkey.equals(recipient)).toBe(true)
    const spl = decodeTransferCheckedInstruction(
      usdcTransferInstruction(wallet, recipient),
    )
    expect(spl.data.amount).toBe(10_000n)
    expect(spl.data.decimals).toBe(6)
    expect(spl.keys.mint.pubkey.equals(DEVNET_USDC)).toBe(true)
    expect(usdcTransferInstruction(wallet, recipient)).toEqual(
      createTransferCheckedInstruction(
        usdcAta(wallet),
        DEVNET_USDC,
        usdcAta(recipient),
        wallet,
        10_000n,
        6,
      ),
    )
    expect(BASE_SEPOLIA_USDC).toBe('0x036CbD53842c5426634e7929541eC2318f3dCF7e')
  })
  test('waits for confirmed transaction then refuses failed/missing metadata', async () => {
    const getTransaction = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ meta: { err: null } })
    const connection = { getTransaction } as unknown as Connection
    await expect(
      waitForSolanaReceipt(connection, 'public-signature', {
        intervalMs: 1,
        timeoutMs: 100,
      }),
    ).resolves.toEqual({ meta: { err: null } })
    getTransaction.mockResolvedValue({
      meta: { err: { InstructionError: [0, 'Custom'] } },
    })
    await expect(
      waitForSolanaReceipt(connection, 'public-signature'),
    ).rejects.toThrow('receipt failed')
    getTransaction.mockResolvedValue({ meta: null })
    await expect(
      waitForSolanaReceipt(connection, 'public-signature'),
    ).rejects.toThrow('metadata')
  })
  test('bounded polling times out even for a hanging RPC', async () => {
    await expect(
      pollSolana(
        () => new Promise(() => {}),
        () => false,
        { timeoutMs: 5, intervalMs: 1 },
      ),
    ).rejects.toThrow('RPC timeout')
    await expect(
      pollSolana(
        async () => null,
        (value) => value !== null,
        { timeoutMs: 5, intervalMs: 1 },
      ),
    ).rejects.toThrow('visibility timeout')
    await expect(
      pollSolana(
        async () => null,
        () => false,
        { timeoutMs: 0 },
      ),
    ).rejects.toThrow('deadline')
  })
  test('terminal status alone is insufficient without completed operations and purpose', async () => {
    const completed = {
      status: 'COMPLETED',
      purpose: 'deployment',
      operations: [
        {
          chainId: 'solana:devnet',
          items: [{ type: 'FILL', status: 'COMPLETED' }],
        },
      ],
    } as unknown as TransactionStatus
    const sdk = { getIntentStatus: vi.fn().mockResolvedValue(completed) }
    await expect(waitForTerminalIntent(sdk, 'id', 'deployment')).resolves.toBe(
      completed,
    )
    sdk.getIntentStatus.mockResolvedValue({ ...completed, operations: [] })
    await expect(
      waitForTerminalIntent(sdk, 'id', 'deployment'),
    ).rejects.toThrow('every operation')
    sdk.getIntentStatus.mockResolvedValue({ ...completed, status: 'FAILED' })
    await expect(
      waitForTerminalIntent(sdk, 'id', 'deployment'),
    ).rejects.toThrow('every operation')
    sdk.getIntentStatus.mockResolvedValue(completed)
    await expect(waitForTerminalIntent(sdk, 'id', 'execution')).rejects.toThrow(
      'purpose',
    )
  })
  test('independent receipt verification requires both expected chains and EVM success', async () => {
    const solanaChain = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
    const connection = {
      getGenesisHash: vi.fn().mockResolvedValue(DEVNET_GENESIS),
      getTransaction: vi.fn().mockResolvedValue({ meta: { err: null } }),
    } as unknown as Connection
    const evm = {
      getChainId: vi.fn().mockResolvedValue(84532),
      waitForTransactionReceipt: vi
        .fn()
        .mockResolvedValue({ status: 'success' }),
    }
    const status = {
      status: 'COMPLETED',
      purpose: 'execution',
      operations: [
        {
          chainId: solanaChain,
          items: [
            {
              status: 'COMPLETED',
              transaction: {
                vm: 'svm',
                chainId: solanaChain,
                signature: 'public-signature',
              },
            },
          ],
        },
        {
          chainId: 'eip155:84532',
          items: [
            {
              status: 'COMPLETED',
              transaction: {
                vm: 'evm',
                chainId: 'eip155:84532',
                txHash: '0x1234',
              },
            },
          ],
        },
      ],
    } as unknown as TransactionStatus
    const expected = [solanaChain, 'eip155:84532']
    await expect(
      verifyIntentReceipts(
        status,
        connection,
        evm as unknown as PublicClient,
        expected,
      ),
    ).resolves.toHaveLength(2)
    evm.waitForTransactionReceipt.mockResolvedValue({ status: 'reverted' })
    await expect(
      verifyIntentReceipts(
        status,
        connection,
        evm as unknown as PublicClient,
        expected,
      ),
    ).rejects.toThrow('EVM execution receipt failed')
    await expect(
      verifyIntentReceipts(
        { ...status, operations: status.operations.slice(0, 1) },
        connection,
        evm as unknown as PublicClient,
        expected,
      ),
    ).rejects.toThrow('Missing expected')
    await expect(
      verifyIntentReceipts(status, connection, evm as unknown as PublicClient, [
        solanaChain,
      ]),
    ).rejects.toThrow('Unexpected receipt chain')
  })
  test('allowlisted diagnostics omit arbitrary payloads and URLs', () => {
    const input = {
      caseId: 'OUT-C/gas',
      intentId: 'public-id',
      errorCode: 'https://rpc.test?apiKey=SECRET',
      privateKey: 'SECRET',
      headers: { authorization: 'SECRET' },
      signedArtifact: 'SECRET',
    }
    expect(safeSolanaDiagnostic(input)).toEqual({
      caseId: 'OUT-C/gas',
      intentId: 'public-id',
    })
  })
  test('persists deployment evidence before any submission and aborts on persistence failure', async () => {
    const evidence = [
      { intentId: 'deployment-id', quotedAmounts: ['1234'], submissions: 0 },
    ]
    const fetcher = vi.fn().mockResolvedValue(new Response('{}'))
    const persist = vi.fn().mockImplementation(async () => {
      expect(fetcher).not.toHaveBeenCalled()
      throw new Error('diagnostic storage unavailable')
    })
    const observed = observeDeploymentFetch(
      fetcher as unknown as typeof fetch,
      evidence,
      persist,
    )
    await expect(
      observed('https://orchestrator.test/intents', {
        method: 'POST',
        body: JSON.stringify({ intentId: 'deployment-id', proofs: ['SECRET'] }),
      }),
    ).rejects.toThrow('diagnostic storage unavailable')
    expect(fetcher).not.toHaveBeenCalled()
    expect(persist).toHaveBeenCalledWith({
      intentId: 'deployment-id',
      quotedAmounts: ['1234'],
      submissions: 1,
    })
  })
  test('intercepted response retains only public deployment identity and rent; originals remain readable', async () => {
    const evidence: Parameters<typeof observeDeploymentFetch>[1] = []
    const payload = {
      status: 'quoted',
      routes: [
        {
          purpose: 'deployment',
          intentId: 'deployment-id',
          deploymentCosts: [{ rent: { amount: '1234' } }],
          proof: 'SECRET',
        },
      ],
    }
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(payload)),
      ) as unknown as typeof fetch
    const observed = observeDeploymentFetch(fetcher, evidence)
    const response = await observed('https://orchestrator.test/quotes', {
      method: 'POST',
    })
    expect(await response.json()).toEqual(payload)
    expect(evidence).toEqual([
      { intentId: 'deployment-id', quotedAmounts: ['1234'], submissions: 0 },
    ])
    vi.mocked(fetcher).mockResolvedValue(
      new Response(
        JSON.stringify({ intentId: 'deployment-id', secret: 'SECRET' }),
      ),
    )
    await observed('https://orchestrator.test/intents', {
      method: 'POST',
      body: JSON.stringify({ intentId: 'deployment-id', proofs: ['SECRET'] }),
    })
    await observed('https://orchestrator.test/intents', {
      method: 'POST',
      body: JSON.stringify({ intentId: 'deployment-id', proofs: ['SECRET'] }),
    })
    expect(evidence[0].submissions).toBe(2)
    expect(JSON.stringify(evidence)).not.toContain('SECRET')
  })
})
