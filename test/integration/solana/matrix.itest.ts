import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { PublicKey } from '@solana/web3.js'
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  erc20Abi,
  http,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'
import { afterAll, describe, expect, it, vi } from 'vitest'
import {
  OrchestratorError,
  SimulationFailedError,
  UnsupportedAccountCapabilityError,
} from '../../../src/errors/index'
import type { SignedTransactionData, Transaction } from '../../../src/index'
import {
  createSolanaSwigId,
  solanaAddress,
  solanaDevnet,
} from '../../../src/solana/index'
import {
  createSolanaReport,
  getSolanaIntegrationConfig,
  preflightSolanaIntegration,
} from '../config/solana'
import {
  assertDeliveryCap,
  BASE_SEPOLIA_USDC,
  createSolanaFixture,
  deployAndVerifySolanaFixture,
  fundBaseSepoliaShortfall,
  pollSolana,
  readBaseSepoliaBalances,
  readSolanaBalances,
  SOLANA_AMOUNTS,
  type SolanaFixture,
  SolanaFundingHarness,
  verifyIntentReceipts,
  waitForTerminalIntent,
} from '../framework/solana'
import {
  assertUserDebit,
  DEVNET_MINT,
  matrixTransaction,
  NATIVE_SOL,
  SOLANA_MATRIX,
  type SolanaCell,
  SolanaSuiteSafety,
} from '../framework/solana-matrix'

type Quote = SignedTransactionData['quote']
async function liveRuntime() {
  stage = 'config'
  const config = getSolanaIntegrationConfig()
  stage = 'network-preflight'
  const preflight = await preflightSolanaIntegration(config)
  // Use viem's chain-neutral client at the harness boundary; network identity
  // remains independently checked before every funding/receipt operation.
  return {
    ...preflight,
    evmClient: createPublicClient({
      transport: http(config.baseSepoliaRpcUrl, {
        retryCount: 0,
        timeout: 30_000,
      }),
    }),
  }
}
type Runtime = Awaited<ReturnType<typeof liveRuntime>>
const evmRecipient = privateKeyToAccount(generatePrivateKey()).address
const runId = randomUUID()
const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim()
const report = createSolanaReport()
const safety = new SolanaSuiteSafety()
let runtime: Runtime | undefined
let fixture: SolanaFixture | undefined
let submissions = 0
let currentCase = 'setup'
let stage = 'config'

async function record(fields: Parameters<typeof report.record>[0] = {}) {
  report.record({
    runId,
    commit,
    caseId: currentCase,
    stage,
    timestamp: new Date().toISOString(),
    service: runtime?.config.target,
    swig: fixture?.swig.toBase58(),
    wallet: fixture?.wallet.toBase58(),
    recipient: fixture?.recipient.publicKey.toBase58(),
    ...fields,
  })
  await report.write()
}
async function guarded(caseId: string, run: () => Promise<void>) {
  safety.begin()
  currentCase = caseId
  stage = 'start'
  try {
    await record()
    await run()
    stage = 'verified'
    await record()
    safety.complete()
  } catch (error) {
    safety.halt(caseId)
    const errorCode =
      error instanceof OrchestratorError
        ? error.code
        : error instanceof Error
          ? error.name
          : 'UNKNOWN'
    await record({ errorCode })
    // Do not let Vitest serialize SDK error causes/artifacts into CI logs.
    throw new Error(
      stage === 'config' && error instanceof Error
        ? error.message
        : `${caseId} failed at ${stage} (${errorCode}); inspect sanitized report and reconcile before rerunning`,
    )
  }
}
function ready() {
  if (!fixture || !runtime)
    throw new Error('Fresh verified fixture is not ready')
  return { fixture, runtime }
}
async function balances() {
  const { fixture: f, runtime: r } = ready()
  const [wallet, recipient, base, baseRecipient] = await Promise.all([
    readSolanaBalances(r.connection, f.wallet),
    readSolanaBalances(r.connection, f.recipient.publicKey),
    readBaseSepoliaBalances(r.evmClient, f.evmAddress),
    readBaseSepoliaBalances(r.evmClient, evmRecipient),
  ])
  return { wallet, recipient, base, baseRecipient }
}
type Balances = Awaited<ReturnType<typeof balances>>
const solChain = solanaDevnet.caip2
const baseChain = 'eip155:84532'
function amount(legs: Quote['cost']['input'], chain: string, token: string) {
  return legs
    .filter(
      (leg) =>
        leg.chainId === chain &&
        (chain === baseChain
          ? leg.tokenAddress.toLowerCase() === token.toLowerCase()
          : leg.tokenAddress === token),
    )
    .reduce((sum, leg) => sum + leg.amount, 0n)
}
function requested(cell: SolanaCell) {
  return cell.row === 'SC-I-SOL'
    ? SOLANA_AMOUNTS.solTransfer
    : cell.row.startsWith('SC-')
      ? SOLANA_AMOUNTS.sameChainUsdc
      : SOLANA_AMOUNTS.crossChainUsdc
}
function isInstruction(cell: SolanaCell) {
  return cell.row === 'SC-I-USDC' || cell.row === 'SC-I-SOL'
}
function validateQuote(cell: SolanaCell, quote: Quote, before: Balances) {
  expect(quote.intentId).toMatch(/^[a-zA-Z0-9_-]{1,160}$/)
  expect(quote.purpose).toBe('execution')
  expect(quote.requirements).toEqual([])
  expect(quote.signingRequests.length).toBeGreaterThan(0)
  expect(quote.expiresAt * 1000).toBeGreaterThan(Date.now())
  const fee = quote.cost.fees
  expect(Number.isFinite(fee.total.usd)).toBe(true)
  expect(fee.total.usd).toBeGreaterThanOrEqual(0)
  for (const category of Object.values(fee.breakdown)) {
    expect(Number.isFinite(category.usd)).toBe(true)
    expect(category.usd).toBeGreaterThanOrEqual(0)
  }
  // Coverage flags describe actual coverage, not a copy of the request:
  // provider subsidies and zero-cost categories can differ between routes.
  if (cell.gasSponsored && fee.breakdown.gas.usd > 0)
    expect(fee.breakdown.gas.sponsored).toBe(true)
  const inbound = cell.row === 'IN-D'
  const sourceChain = inbound ? baseChain : solChain
  const destinationChain = cell.row.startsWith('OUT-') ? baseChain : solChain
  const sourceMint = inbound ? BASE_SEPOLIA_USDC : DEVNET_MINT
  const destinationMint =
    destinationChain === baseChain ? BASE_SEPOLIA_USDC : DEVNET_MINT
  for (const leg of [...quote.cost.input, ...quote.cost.output]) {
    expect(leg.amount).toBeGreaterThanOrEqual(0n)
    if (leg.chainId === solChain) {
      expect([DEVNET_MINT, NATIVE_SOL]).toContain(leg.tokenAddress)
      expect(leg.decimals).toBe(leg.tokenAddress === NATIVE_SOL ? 9 : 6)
    } else {
      expect(leg.chainId).toBe(baseChain)
      expect(leg.tokenAddress.toLowerCase()).toBe(
        BASE_SEPOLIA_USDC.toLowerCase(),
      )
      expect(leg.decimals).toBe(6)
    }
  }
  const input = amount(quote.cost.input, sourceChain, sourceMint)
  if (isInstruction(cell)) {
    for (const token of [DEVNET_MINT, NATIVE_SOL]) {
      const transfer =
        (cell.row === 'SC-I-SOL') === (token === NATIVE_SOL)
          ? requested(cell)
          : 0n
      const net =
        amount(quote.cost.input, solChain, token) -
        amount(quote.cost.output, solChain, token)
      expect(net).toBeGreaterThanOrEqual(0n)
      expect(transfer + net).toBeLessThanOrEqual(
        token === DEVNET_MINT
          ? before.wallet.usdc
          : before.wallet.spendableLamports,
      )
    }
  } else {
    expect(quote.cost.input).toHaveLength(1)
    expect(quote.cost.output).toHaveLength(1)
    expect(input).toBeGreaterThan(0n)
    assertDeliveryCap(input)
    expect(input).toBeLessThanOrEqual(
      inbound ? before.base.usdc : before.wallet.usdc,
    )
    expect(
      amount(quote.cost.output, destinationChain, destinationMint),
    ).toBeGreaterThanOrEqual(requested(cell))
  }
  if (cell.row === 'OUT-C') {
    const { fixture: f } = ready()
    const execution = quote.plan.destination.execution
    expect(execution?.vm).toBe('evm')
    if (execution?.vm !== 'evm')
      throw new Error('Missing EVM destination execution')
    expect(execution.executedBy?.kind).toBe('account')
    expect(execution.executedBy?.address.toLowerCase()).toBe(
      f.evmAddress.toLowerCase(),
    )
    const svm = quote.signingRequests.filter(
      (request) => request.account.vm === 'svm',
    )
    const evm = quote.signingRequests.filter(
      (request) => request.account.vm === 'evm',
    )
    expect(
      svm.some((request) => request.purpose === 'originAuthorization'),
    ).toBe(true)
    expect(
      evm.some(
        (request) =>
          request.purpose === 'destinationAuthorization' ||
          request.purpose === 'targetExecutionAuthorization',
      ),
    ).toBe(true)
    for (const request of svm) {
      if (request.account.vm !== 'svm') throw new Error('Missing SVM account')
      expect(request.account.wallet).toBe(f.wallet.toBase58())
      expect(request.account.swigAccount).toBe(f.swig.toBase58())
      expect(request.chainIds).toContain(solChain)
    }
    for (const request of evm) {
      if (request.account.vm !== 'evm') throw new Error('Missing EVM account')
      expect(request.account.address.toLowerCase()).toBe(
        f.evmAddress.toLowerCase(),
      )
      expect(request.chainIds).toContain(baseChain)
    }
  }
}
function recipientCredit(cell: SolanaCell, before: Balances, after: Balances) {
  return cell.row === 'SC-I-SOL'
    ? after.recipient.lamports - before.recipient.lamports
    : cell.row.startsWith('OUT-')
      ? after.baseRecipient.usdc - before.baseRecipient.usdc
      : after.recipient.usdc - before.recipient.usdc
}
function verifyBalances(
  cell: SolanaCell,
  quote: Quote,
  before: Balances,
  after: Balances,
) {
  const inbound = cell.row === 'IN-D'
  const instruction = isInstruction(cell)
  const credit = recipientCredit(cell, before, after)
  if (instruction || cell.row === 'OUT-C')
    expect(credit).toBe(
      cell.row === 'OUT-C'
        ? SOLANA_AMOUNTS.destinationCallUsdc
        : requested(cell),
    )
  else {
    const chain = cell.row === 'OUT-D' ? baseChain : solChain
    const mint = chain === baseChain ? BASE_SEPOLIA_USDC : DEVNET_MINT
    expect(credit).toBeGreaterThanOrEqual(
      amount(quote.cost.output, chain, mint),
    )
    // Guaranteed output is a floor; rounding overdelivery is safe because
    // the independently measured source debit is still capped below.
  }
  const usdcDebit = inbound
    ? before.base.usdc - after.base.usdc
    : before.wallet.usdc - after.wallet.usdc
  if (!instruction) {
    assertDeliveryCap(usdcDebit)
    expect(usdcDebit).toBeGreaterThan(0n)
    expect(usdcDebit).toBeLessThanOrEqual(
      amount(
        quote.cost.input,
        inbound ? baseChain : solChain,
        inbound ? BASE_SEPOLIA_USDC : DEVNET_MINT,
      ),
    )
  } else {
    for (const token of [DEVNET_MINT, NATIVE_SOL]) {
      const debit =
        token === DEVNET_MINT
          ? usdcDebit
          : before.wallet.spendableLamports - after.wallet.spendableLamports
      const transfer =
        (cell.row === 'SC-I-SOL') === (token === NATIVE_SOL)
          ? requested(cell)
          : 0n
      const net =
        amount(quote.cost.input, solChain, token) -
        amount(quote.cost.output, solChain, token)
      assertUserDebit(debit, transfer, net)
    }
  }
  if (cell.row !== 'SC-I-SOL')
    expect(after.recipient.lamports).toBe(before.recipient.lamports)
  if (cell.row === 'SC-I-SOL' || cell.row.startsWith('OUT-'))
    expect(after.recipient.usdc).toBe(before.recipient.usdc)
  if (inbound) expect(after.wallet.usdc).toBe(before.wallet.usdc)
  if (!cell.row.startsWith('OUT-'))
    expect(after.baseRecipient.usdc).toBe(before.baseRecipient.usdc)
  expect(after.baseRecipient.wei).toBe(before.baseRecipient.wei)
  expect(after.wallet.rentExemptReserve).toBe(before.wallet.rentExemptReserve)
  if (!instruction) expect(after.wallet.lamports).toBe(before.wallet.lamports)
  // No ETH value is sent; any user gas debit must be disclosed as a cost leg.
  const weiDebit = before.base.wei - after.base.wei
  expect(weiDebit).toBe(0n)
  if (cell.row === 'OUT-C') {
    const guaranteed = amount(quote.cost.output, baseChain, BASE_SEPOLIA_USDC)
    expect(after.base.usdc - before.base.usdc + credit).toBeGreaterThanOrEqual(
      guaranteed,
    )
  } else if (!inbound) expect(after.base.usdc).toBe(before.base.usdc)
}

describe.sequential('Solana Devnet / Base Sepolia fresh live matrix', () => {
  it('preflights, deploys once, verifies authority and funds bounded shortfalls', async () =>
    guarded('setup', async () => {
      runtime = await liveRuntime()
      const config = runtime.config
      stage = 'fixture'
      const baseFetch = globalThis.fetch
      const fetcher: typeof fetch = Object.assign(
        async (
          input: Parameters<typeof fetch>[0],
          init?: Parameters<typeof fetch>[1],
        ) => {
          const url =
            typeof input === 'string'
              ? input
              : input instanceof URL
                ? input.href
                : input.url
          if (
            init?.method === 'POST' &&
            new URL(url).pathname.endsWith('/intents')
          ) {
            safety.assertActive()
            submissions++
            if (currentCase === 'refusals')
              throw new Error('Submission forbidden during prepare refusals')
          }
          return baseFetch(input, {
            ...init,
            signal: init?.signal
              ? AbortSignal.any([init.signal, AbortSignal.timeout(30_000)])
              : AbortSignal.timeout(30_000),
          })
        },
        { preconnect: baseFetch.preconnect },
      )
      fixture = await createSolanaFixture({
        sdkConfig: config.sdkConfig,
        connection: runtime.connection,
        evmClient: runtime.evmClient,
        fetcher,
        onDeploymentEvidence: async (evidence) => {
          await record({
            intentId: evidence.intentId,
            quotedAmount: evidence.quotedAmounts.join(' '),
            stage: evidence.submissions
              ? 'deployment-submitting'
              : 'deployment-quoted',
          })
        },
      })
      stage = 'deploy-and-verify'
      await record({
        chain: baseChain,
        wallet: fixture.evmAddress,
        recipient: evmRecipient,
      })
      safety.assertActive()
      const deployment = await deployAndVerifySolanaFixture(fixture)
      for (const group of deployment.status.operations) {
        for (const operation of group.items) {
          if ('transaction' in operation && operation.transaction?.vm === 'svm')
            await record({
              intentId: deployment.evidence.intentId,
              traceId: deployment.status.traceId,
              chain: operation.transaction.chainId,
              transaction: operation.transaction.signature,
            })
        }
      }
      stage = 'ata-and-funding'
      await record({
        chain: solChain,
        wallet: config.funder.publicKey.toBase58(),
      })
      await record({
        chain: baseChain,
        wallet: privateKeyToAccount(config.evmFunderPrivateKey).address,
      })
      const funding = new SolanaFundingHarness(
        fixture,
        config.funder,
        undefined,
        () => safety.assertActive(),
      )
      safety.assertActive()
      const ataSignature = await funding.setupTokenAccounts()
      if (ataSignature)
        await record({ chain: solChain, transaction: ataSignature })
      // One bounded provision for all cells; never refill a failing/negative case.
      const reserve = BigInt(
        await runtime.connection.getMinimumBalanceForRentExemption(0),
      )
      safety.assertActive()
      const solanaFunding = await funding.fundShortfall({
        usdc: 4_000_000n,
        lamports: reserve + 20_000_000n,
      })
      if (solanaFunding.signature)
        await record({ chain: solChain, transaction: solanaFunding.signature })
      safety.assertActive()
      const baseFunding = await fundBaseSepoliaShortfall({
        fixture,
        publicClient: runtime.evmClient,
        walletClient: createWalletClient({
          account: privateKeyToAccount(config.evmFunderPrivateKey),
          chain: baseSepolia,
          transport: http(config.baseSepoliaRpcUrl, {
            retryCount: 0,
            timeout: 30_000,
          }),
        }),
        budget: funding.budget,
        assertActive: () => safety.assertActive(),
        target: { usdc: 1_000_000n, wei: 1_000_000_000_000_000n },
      })
      for (const hash of baseFunding.hashes)
        await record({ chain: baseChain, transaction: hash })
      for (const [asset, spent] of Object.entries(funding.budget.snapshot()))
        await record({
          stage: `funded-${asset}`,
          balanceDelta: spent.toString(),
        })
    }))

  it('refuses malformed and insufficient requests at prepare without signing, submitting or spending', async () =>
    guarded('refusals', async () => {
      const { fixture: f } = ready()
      const before = await balances()
      const count = submissions
      const sign = vi
        .spyOn(f.account, 'signTransaction')
        .mockImplementation(async () => {
          throw new Error('Signing forbidden during prepare refusals')
        })
      const submit = vi
        .spyOn(f.account, 'submitTransaction')
        .mockImplementation(async () => {
          throw new Error('Submission forbidden during prepare refusals')
        })
      const assertNoEffects = async () => {
        expect(sign).not.toHaveBeenCalled()
        expect(submit).not.toHaveBeenCalled()
        expect(submissions).toBe(count)
        expect(await balances()).toEqual(before)
      }
      const delivery: Transaction = matrixTransaction(
        SOLANA_MATRIX[0],
        f.wallet,
        f.recipient.publicKey,
        evmRecipient,
      )
      const recipient = solanaAddress(f.recipient.publicKey.toBase58())
      const instructions = {
        chain: solanaDevnet,
        instructions: [{ programId: NATIVE_SOL, accounts: [], data: '' }],
      }
      const malformed: { id: string; input: unknown; field: string }[] = [
        {
          id: 'native-delivery',
          input: {
            source: { token: NATIVE_SOL },
            destination: {
              chain: solanaDevnet,
              token: NATIVE_SOL,
              amount: 1n,
              recipient,
            },
          },
          field: 'destination.token',
        },
        {
          id: 'inbound-instructions',
          input: {
            source: { chain: baseSepolia, token: BASE_SEPOLIA_USDC },
            destination: instructions,
          },
          field: 'destination.instructions',
        },
        {
          id: 'inbound-calls',
          input: {
            source: { chain: baseSepolia, token: BASE_SEPOLIA_USDC },
            destination: {
              chain: solanaDevnet,
              token: DEVNET_MINT,
              amount: 1n,
              recipient,
              calls: [],
            },
          },
          field: 'destination.calls',
        },
        {
          id: 'missing-fee-source',
          input: { destination: instructions, sponsored: false },
          field: 'source',
        },
        {
          id: 'instruction-cap',
          input: {
            source: { token: DEVNET_MINT, maxAmount: 1n },
            destination: instructions,
          },
          field: 'source.maxAmount',
        },
        ...[0n, -1n].map((maxAmount) => ({
          id: maxAmount === 0n ? 'zero-cap' : 'negative-cap',
          input: { ...delivery, source: { token: DEVNET_MINT, maxAmount } },
          field: 'source.maxAmount',
        })),
        {
          id: 'above-cap',
          input: { ...delivery, source: { token: DEVNET_MINT, maxAmount: 1n } },
          field: 'source.maxAmount',
        },
        {
          id: 'mint-mismatch',
          input: { ...delivery, source: { token: NATIVE_SOL } },
          field: 'source.token',
        },
      ]
      try {
        for (const refusal of malformed) {
          stage = `prepare-refusal-${refusal.id}`
          // Deliberately exercise the untyped JS input boundary, never a happy-path cast.
          let caught: unknown
          try {
            await Reflect.apply(f.account.prepareTransaction, f.account, [
              refusal.input,
            ])
          } catch (error) {
            caught = error
          }
          await record({
            errorCode:
              caught instanceof OrchestratorError
                ? caught.code
                : caught instanceof Error
                  ? caught.name
                  : 'NO_DOMAIN_ERROR',
          })
          expect(caught).toBeInstanceOf(UnsupportedAccountCapabilityError)
          if (!(caught instanceof UnsupportedAccountCapabilityError))
            throw new Error('Wrong refusal domain')
          expect(caught.context.field).toBe(refusal.field)
          await record({ errorCode: caught.name })
          await assertNoEffects()
        }
        stage = 'prepare-refusal-invalid-deployment-id'
        const identity = createSolanaSwigId()
        const independent = await f.sdk.createAccount({
          solana: {
            swig: identity.swig,
            owner: {
              type: 'ecdsa',
              account: privateKeyToAccount(generatePrivateKey()),
            },
          },
        })
        const state = new PublicKey(identity.swig)
        const wallet = new PublicKey(identity.wallet)
        expect(await f.connection.getAccountInfo(state)).toBeNull()
        const independentBefore = await readSolanaBalances(f.connection, wallet)
        let deploymentError: unknown
        try {
          await independent.deploy('solana', solanaDevnet, { swigId: '0x01' })
        } catch (error) {
          deploymentError = error
        }
        expect(deploymentError).toBeInstanceOf(
          UnsupportedAccountCapabilityError,
        )
        if (!(deploymentError instanceof UnsupportedAccountCapabilityError))
          throw new Error('Wrong deployment refusal domain')
        expect(deploymentError.context.field).toBe('swigId')
        expect(await f.connection.getAccountInfo(state)).toBeNull()
        expect(await readSolanaBalances(f.connection, wallet)).toEqual(
          independentBefore,
        )
        await assertNoEffects()
        stage = 'prepare-refusal-insufficient-balance'
        let caught: unknown
        try {
          await f.account.prepareTransaction({
            source: {
              token: DEVNET_MINT,
              maxAmount: before.wallet.usdc + 1_000_000_000n,
            },
            destination: {
              chain: solanaDevnet,
              token: DEVNET_MINT,
              amount: before.wallet.usdc + 1_000_000_000n,
              recipient,
            },
            sponsored: false,
          })
        } catch (error) {
          caught = error
        }
        await record({
          errorCode:
            caught instanceof OrchestratorError
              ? caught.code
              : caught instanceof Error
                ? caught.name
                : 'NO_DOMAIN_ERROR',
        })
        expect(caught).toBeInstanceOf(SimulationFailedError)
        if (!(caught instanceof SimulationFailedError))
          throw new Error('Wrong insufficient-balance domain')
        expect(caught.code).toBe('SIMULATION_FAILED')
        expect(caught.category).toBe('INSUFFICIENT_BALANCE')
        await record({ errorCode: caught.code })
        await assertNoEffects()
      } finally {
        sign.mockRestore()
        submit.mockRestore()
      }
    }))

  for (const cell of SOLANA_MATRIX) {
    it(cell.id, async () =>
      guarded(cell.id, async () => {
        const { fixture: f, runtime: r } = ready()
        stage = 'snapshot'
        const before = await balances()
        stage = 'prepare'
        await record()
        const prepared = await f.account.prepareTransaction(
          matrixTransaction(
            cell,
            f.wallet,
            f.recipient.publicKey,
            evmRecipient,
          ),
        )
        const quote = prepared.quotes.best
        stage = 'quote-check'
        validateQuote(cell, quote, before)
        for (const direction of ['input', 'output'] as const) {
          for (const leg of quote.cost[direction])
            await record({
              stage: `quote-${direction}`,
              chain: leg.chainId,
              mint: leg.tokenAddress,
              quotedAmount: leg.amount.toString(),
              intentId: quote.intentId,
              traceId: prepared.quotes.traceId,
            })
        }
        for (const [category, fee] of Object.entries(quote.cost.fees.breakdown))
          await record({
            stage: `quote-fee-${category}-${fee.sponsored ? 'sponsored' : 'user'}`,
            quotedAmount: fee.usd.toString(),
            intentId: quote.intentId,
          })
        stage = 'sign'
        const signed = await f.account.signTransaction(prepared)
        expect(signed.quote.intentId).toBe(quote.intentId)
        expect(signed.proofs).toHaveLength(quote.signingRequests.length)
        for (const [index, request] of quote.signingRequests.entries()) {
          const proof = signed.proofs[index]
          expect(proof?.kind).toBe(request.payload.kind)
          if (proof?.kind === 'personalSign')
            expect(proof.signature.length).toBeGreaterThan(2)
          if (proof?.kind === 'eip712') {
            if (typeof proof.signature === 'string')
              expect(proof.signature.length).toBeGreaterThan(2)
            else {
              expect(proof.signature.preClaim.length).toBeGreaterThan(2)
              expect(proof.signature.notarizedClaim.length).toBeGreaterThan(2)
            }
          }
        }
        stage = 'submitting'
        // This write must finish before the first state-changing submission call.
        await record({
          intentId: signed.quote.intentId,
          traceId: prepared.quotes.traceId,
        })
        safety.assertActive()
        const result = await f.account.submitTransaction(signed)
        expect(result.id).toBe(quote.intentId)
        stage = 'settlement'
        await record({ intentId: result.id, traceId: result.traceId })
        await f.account.waitForExecution(result)
        const status = await waitForTerminalIntent(
          f.sdk,
          result.id,
          'execution',
          { timeoutMs: 60_000 },
        )
        stage = 'receipts'
        const refs = await verifyIntentReceipts(
          status,
          r.connection,
          r.evmClient,
          cell.row.startsWith('SC-') ? [solChain] : [solChain, baseChain],
        )
        for (const ref of refs)
          await record({
            chain: ref.chainId,
            transaction: ref.vm === 'svm' ? ref.signature : ref.txHash,
            traceId: status.traceId,
          })
        if (cell.row === 'OUT-C') {
          let matched = false
          for (const ref of refs) {
            if (ref.vm !== 'evm') continue
            const receipt = await r.evmClient.getTransactionReceipt({
              hash: ref.txHash,
            })
            for (const log of receipt.logs) {
              if (log.address.toLowerCase() !== BASE_SEPOLIA_USDC.toLowerCase())
                continue
              try {
                const event = decodeEventLog({
                  abi: erc20Abi,
                  eventName: 'Transfer',
                  data: log.data,
                  topics: log.topics,
                })
                if (
                  event.args.from.toLowerCase() ===
                    f.evmAddress.toLowerCase() &&
                  event.args.to.toLowerCase() === evmRecipient.toLowerCase() &&
                  event.args.value === SOLANA_AMOUNTS.destinationCallUsdc
                )
                  matched = true
              } catch {
                /* Other USDC events are not transfer evidence. */
              }
            }
          }
          expect(matched).toBe(true)
        }
        stage = 'balance-visibility'
        const minimum =
          cell.row === 'OUT-C'
            ? SOLANA_AMOUNTS.destinationCallUsdc
            : requested(cell)
        const after = await pollSolana(
          balances,
          (value) =>
            recipientCredit(cell, before, value) >= minimum &&
            (cell.row === 'IN-D'
              ? value.base.usdc < before.base.usdc
              : cell.row === 'SC-I-SOL'
                ? value.wallet.lamports < before.wallet.lamports
                : value.wallet.usdc < before.wallet.usdc),
        )
        stage = 'effects'
        verifyBalances(cell, quote, before, after)
        for (const [asset, delta] of Object.entries({
          solUsdc: after.wallet.usdc - before.wallet.usdc,
          solLamports: after.wallet.lamports - before.wallet.lamports,
          baseUsdc: after.base.usdc - before.base.usdc,
          baseWei: after.base.wei - before.base.wei,
          recipientCredit: recipientCredit(cell, before, after),
        }))
          await record({
            stage: `effects-${asset}`,
            balanceDelta: delta.toString(),
          })
      }),
    )
  }

  afterAll(async () => {
    try {
      if (fixture && runtime) {
        stage = 'residue'
        const final = await balances()
        for (const [owner, assets] of Object.entries({
          wallet: {
            usdc: final.wallet.usdc,
            lamports: final.wallet.lamports,
            rent: final.wallet.rentExemptReserve,
          },
          recipient: {
            usdc: final.recipient.usdc,
            lamports: final.recipient.lamports,
          },
          base: final.base,
          baseRecipient: final.baseRecipient,
        })) {
          for (const [asset, value] of Object.entries(assets))
            await record({
              stage: `residue-${owner}-${asset}`,
              chain: owner.startsWith('base') ? baseChain : solChain,
              wallet:
                owner === 'base'
                  ? fixture.evmAddress
                  : owner === 'baseRecipient'
                    ? evmRecipient
                    : owner === 'recipient'
                      ? fixture.recipient.publicKey.toBase58()
                      : fixture.wallet.toBase58(),
              balanceDelta: value.toString(),
            })
        }
      }
    } catch {
      await record({
        stage: 'residue-unresolved',
        errorCode: 'RESIDUE_READ_FAILED',
      })
      throw new Error(
        'Final residue could not be read; reconcile public fixture balances before rerunning',
      )
    } finally {
      await report.write()
    }
  })
})
