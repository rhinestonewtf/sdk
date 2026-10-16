import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  erc20Abi,
  http,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { OrchestratorError } from '../../../src/errors/index'
import type { SignedTransactionData } from '../../../src/index'
import { solanaDevnet } from '../../../src/solana/index'
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
  assertEvmCallExecution,
  assertGasSponsorship,
  assertUserDebit,
  DEVNET_MINT,
  isEvmCallAuthorization,
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
  const preflight = await preflightSolanaIntegration(config, async (error) => {
    await record({
      stage: `${stage}-rpc-${error.rpcMethod ?? 'write-or-unknown'}-${error.httpStatus ?? error.category}`,
      errorCode: `SOLANA_RPC_${error.category.toUpperCase()}`,
    })
  })
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
let currentCase = 'setup'
let stage = 'config'
const solChain = solanaDevnet.caip2
const baseChain = 'eip155:84532'

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
  return safety.guard(
    caseId,
    async () => {
      const scoped = async () => {
        currentCase = caseId
        stage = 'start'
        await record()
        await run()
        stage = 'verified'
        await record()
      }
      if (fixture) await fixture.withRequests(scoped, 240_000)
      else await scoped()
    },
    async (error) => {
      // Only allow known error codes and our own primitive assertion values into logs.
      const code =
        error instanceof OrchestratorError ? error.code : 'LIVE_CHECK_FAILED'
      const errorCode = /^[A-Z_]{1,80}$/.test(code) ? code : 'LIVE_CHECK_FAILED'
      await record({ errorCode })
      let detail = ''
      const harnessMessages = [
        'Deployment must expose exactly one submitted intent',
        'Deployment submission/quoted rent evidence missing',
        'Deployment has no Devnet receipt',
        'Idempotent deployment submitted a second intent',
        'Swig program ownership mismatch',
        'Onchain Swig identity/wallet mismatch',
        'Swig asset wallet ownership mismatch',
        'Swig root identity/permissions mismatch',
        'Insufficient Solana funder SOL (rent/fee headroom)',
        'Insufficient/invalid Solana funder USDC',
        'Insufficient Base funder USDC',
        'Insufficient Base funder ETH fee headroom',
        'Intent did not complete every operation with expected purpose',
        'Solana visibility timeout; reconcile existing submission before spending again',
        'Solana RPC timeout; reconcile existing submission',
      ]
      if (error instanceof Error && harnessMessages.includes(error.message))
        detail = `; ${error.message}`
      if (error instanceof Error && error.name === 'AssertionError') {
        const safeValue = (key: string) => {
          const value = Object.getOwnPropertyDescriptor(error, key)?.value
          return typeof value === 'bigint' ||
            (typeof value === 'number' && Number.isFinite(value)) ||
            typeof value === 'boolean'
            ? String(value)
            : 'redacted'
        }
        detail = `; expected=${safeValue('expected')} actual=${safeValue('actual')}`
      }
      // Config/preflight messages are constructed locally and never interpolate credentials.
      if (
        error instanceof Error &&
        (stage === 'config' || stage === 'network-preflight')
      )
        throw new Error(error.message)
      throw new Error(
        `${caseId} failed at ${stage} (${errorCode})${detail}; inspect sanitized report and reconcile before rerunning`,
      )
    },
  )
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
  expect(quote.requirements.length).toBe(0)
  expect(quote.signingRequests.length).toBeGreaterThan(0)
  expect(quote.expiresAt * 1000).toBeGreaterThan(Date.now())
  for (const fee of [
    quote.cost.fees.total,
    ...Object.values(quote.cost.fees.breakdown),
  ]) {
    expect(Number.isFinite(fee.usd)).toBe(true)
    expect(fee.usd).toBeGreaterThanOrEqual(0)
  }
  assertGasSponsorship(cell, quote.cost.fees)
  for (const leg of [...quote.cost.input, ...quote.cost.output]) {
    expect(leg.amount).toBeGreaterThanOrEqual(0n)
    if (leg.chainId === solChain) {
      expect(
        leg.tokenAddress === DEVNET_MINT || leg.tokenAddress === NATIVE_SOL,
      ).toBe(true)
      expect(leg.decimals).toBe(leg.tokenAddress === NATIVE_SOL ? 9 : 6)
    } else {
      expect(leg.chainId).toBe(baseChain)
      expect(leg.tokenAddress.toLowerCase()).toBe(
        BASE_SEPOLIA_USDC.toLowerCase(),
      )
      expect(leg.decimals).toBe(6)
    }
  }
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
      // Instructions have no source maxAmount: independently cap quoted fees before signing.
      expect(net).toBeLessThanOrEqual(
        token === DEVNET_MINT ? SOLANA_AMOUNTS.deliveryCap : 5_000_000n,
      )
      expect(transfer + net).toBeLessThanOrEqual(
        token === DEVNET_MINT
          ? before.wallet.usdc
          : before.wallet.spendableLamports,
      )
    }
  } else {
    const inbound = cell.row === 'IN-D'
    const input = amount(
      quote.cost.input,
      inbound ? baseChain : solChain,
      inbound ? BASE_SEPOLIA_USDC : DEVNET_MINT,
    )
    expect(quote.cost.input.length).toBe(1)
    expect(quote.cost.output.length).toBe(1)
    expect(input).toBeGreaterThan(0n)
    assertDeliveryCap(input)
    expect(input).toBeLessThanOrEqual(
      inbound ? before.base.usdc : before.wallet.usdc,
    )
    const outgoing = cell.row === 'OUT-C'
    expect(
      amount(
        quote.cost.output,
        outgoing ? baseChain : solChain,
        outgoing ? BASE_SEPOLIA_USDC : DEVNET_MINT,
      ),
    ).toBeGreaterThanOrEqual(requested(cell))
  }
  if (cell.row === 'OUT-C') {
    const { fixture: f } = ready()
    expect(quote.plan.destination.vm).toBe('evm')
    assertEvmCallExecution(quote.plan.destination.execution, f.evmAddress)
    expect(
      quote.signingRequests.some(
        (r) => r.account.vm === 'svm' && r.purpose === 'originAuthorization',
      ),
    ).toBe(true)
    expect(
      quote.signingRequests.some((r) =>
        isEvmCallAuthorization(r, f.evmAddress, baseChain),
      ),
    ).toBe(true)
  }
}
function recipientCredit(cell: SolanaCell, before: Balances, after: Balances) {
  return cell.row === 'SC-I-SOL'
    ? after.recipient.lamports - before.recipient.lamports
    : cell.row === 'OUT-C'
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
  else
    expect(credit).toBeGreaterThanOrEqual(
      amount(quote.cost.output, solChain, DEVNET_MINT),
    )
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
      assertUserDebit(
        debit,
        transfer,
        amount(quote.cost.input, solChain, token) -
          amount(quote.cost.output, solChain, token),
      )
    }
  }
  if (cell.row !== 'SC-I-SOL')
    expect(after.recipient.lamports).toBe(before.recipient.lamports)
  if (cell.row === 'SC-I-SOL' || cell.row === 'OUT-C')
    expect(after.recipient.usdc).toBe(before.recipient.usdc)
  if (inbound) expect(after.wallet.usdc).toBe(before.wallet.usdc)
  if (cell.row !== 'OUT-C')
    expect(after.baseRecipient.usdc).toBe(before.baseRecipient.usdc)
  expect(after.baseRecipient.wei).toBe(before.baseRecipient.wei)
  expect(after.wallet.rentExemptReserve).toBe(before.wallet.rentExemptReserve)
  if (!instruction) expect(after.wallet.lamports).toBe(before.wallet.lamports)
  expect(after.base.wei).toBe(before.base.wei)
  if (cell.row === 'OUT-C')
    expect(after.base.usdc - before.base.usdc + credit).toBeGreaterThanOrEqual(
      amount(quote.cost.output, baseChain, BASE_SEPOLIA_USDC),
    )
  else if (!inbound) expect(after.base.usdc).toBe(before.base.usdc)
}

describe.sequential(
  'Solana Devnet / Base Sepolia focused live flows',
  { retry: 0 },
  () => {
    beforeAll(async () =>
      guarded('setup', async () => {
        runtime = await liveRuntime()
        const r = runtime
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
              await record({ stage: `${stage}-before-submit` })
              safety.assertActive()
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
          sdkConfig: r.config.sdkConfig,
          connection: r.connection,
          evmClient: r.evmClient,
          fetcher,
          onDeploymentEvidence: async (evidence) =>
            record({
              intentId: evidence.intentId,
              quotedAmount: evidence.quotedAmounts.join(' '),
              stage: evidence.submissions
                ? 'deployment-submitting'
                : 'deployment-quoted',
            }),
        })
        const f = fixture
        await f.withRequests(async () => {
          stage = 'deploy-and-verify'
          await record({
            chain: baseChain,
            wallet: f.evmAddress,
            recipient: evmRecipient,
          })
          safety.assertActive()
          const deployment = await deployAndVerifySolanaFixture(f)
          for (const group of deployment.status.operations)
            for (const operation of group.items)
              if (
                'transaction' in operation &&
                operation.transaction?.vm === 'svm'
              )
                await record({
                  intentId: deployment.evidence.intentId,
                  traceId: deployment.status.traceId,
                  chain: operation.transaction.chainId,
                  transaction: operation.transaction.signature,
                })
          stage = 'setup-token-accounts'
          await record({
            chain: solChain,
            wallet: r.config.funder.publicKey.toBase58(),
          })
          await record({
            chain: baseChain,
            wallet: privateKeyToAccount(r.config.evmFunderPrivateKey).address,
          })
          const funding = new SolanaFundingHarness(
            f,
            r.config.funder,
            undefined,
            () => safety.assertActive(),
            (signature) => record({ chain: solChain, transaction: signature }),
          )
          safety.assertActive()
          await funding.setupTokenAccounts()
          const reserve = BigInt(
            await r.connection.getMinimumBalanceForRentExemption(0),
          )
          expect(SOLANA_AMOUNTS.solTransfer).toBeGreaterThanOrEqual(reserve)
          safety.assertActive()
          // Provision once for three Solana USDC debits and one native transfer; never refill.
          stage = 'fund-solana'
          await funding.fundShortfall({
            usdc: 2_000_000n,
            lamports: reserve + 10_000_000n,
          })
          safety.assertActive()
          stage = 'fund-base-sepolia'
          await fundBaseSepoliaShortfall({
            fixture: f,
            publicClient: r.evmClient,
            walletClient: createWalletClient({
              account: privateKeyToAccount(r.config.evmFunderPrivateKey),
              chain: baseSepolia,
              transport: http(r.config.baseSepoliaRpcUrl, {
                retryCount: 0,
                timeout: 30_000,
              }),
            }),
            budget: funding.budget,
            assertActive: () => safety.assertActive(),
            persistTransaction: (hash) =>
              record({ chain: baseChain, transaction: hash }),
            target: { usdc: 500_000n, wei: 0n },
          })
          for (const [asset, spent] of Object.entries(
            funding.budget.snapshot(),
          ))
            await record({
              stage: `funded-${asset}`,
              balanceDelta: spent.toString(),
            })
        }, 240_000)
      }),
    )

    for (const cell of SOLANA_MATRIX) {
      it(cell.id, { retry: 0 }, async () =>
        guarded(cell.row, async () => {
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
          for (const direction of ['input', 'output'] as const)
            for (const leg of quote.cost[direction])
              await record({
                stage: `quote-${direction}`,
                chain: leg.chainId,
                mint: leg.tokenAddress,
                quotedAmount: leg.amount.toString(),
                intentId: quote.intentId,
                traceId: prepared.quotes.traceId,
              })
          for (const [category, fee] of Object.entries(
            quote.cost.fees.breakdown,
          ))
            await record({
              stage: `quote-fee-${category}-${fee.sponsored ? 'sponsored' : 'user'}`,
              quotedAmount: fee.usd.toString(),
              intentId: quote.intentId,
            })
          stage = 'sign'
          const signed = await f.account.signTransaction(prepared)
          expect(signed.quote.intentId).toBe(quote.intentId)
          expect(signed.proofs.length).toBe(quote.signingRequests.length)
          stage = 'submitting'
          // Persist the recovery identifier before any ambiguous network write.
          await record({
            intentId: signed.quote.intentId,
            traceId: prepared.quotes.traceId,
          })
          safety.assertActive()
          const result = await f.account.submitTransaction(signed)
          expect(result.id).toBe(quote.intentId)
          stage = 'settlement'
          await record({ intentId: result.id, traceId: result.traceId })
          const observedOperations = new Set<string>()
          const status = await waitForTerminalIntent(
            f.sdk,
            result.id,
            'execution',
            {
              timeoutMs: 60_000,
              onStatus: async (status) => {
                for (const group of status.operations) {
                  for (const operation of group.items) {
                    const ref =
                      'transaction' in operation
                        ? operation.transaction
                        : undefined
                    const transaction =
                      ref?.vm === 'svm'
                        ? ref.signature
                        : ref?.vm === 'evm'
                          ? ref.txHash
                          : undefined
                    const key = `${status.status}-${group.chainId}-${operation.type}-${operation.status}-${transaction}`
                    if (observedOperations.has(key)) continue
                    observedOperations.add(key)
                    await record({
                      stage: `status-${status.status}-${operation.type}-${operation.status}`,
                      chain: String(group.chainId),
                      intentId: result.id,
                      traceId: status.traceId,
                      transaction,
                    })
                  }
                }
              },
            },
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
                if (
                  log.address.toLowerCase() !== BASE_SEPOLIA_USDC.toLowerCase()
                )
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
                    event.args.to.toLowerCase() ===
                      evmRecipient.toLowerCase() &&
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
          const owners = [
            'wallet',
            'recipient',
            'base',
            'baseRecipient',
          ] as const
          const results = await Promise.allSettled([
            readSolanaBalances(runtime.connection, fixture.wallet),
            readSolanaBalances(runtime.connection, fixture.recipient.publicKey),
            readBaseSepoliaBalances(runtime.evmClient, fixture.evmAddress),
            readBaseSepoliaBalances(runtime.evmClient, evmRecipient),
          ])
          for (const [index, result] of results.entries()) {
            const owner = owners[index]
            const identity = {
              chain: owner.startsWith('base') ? baseChain : solChain,
              wallet:
                owner === 'base'
                  ? fixture.evmAddress
                  : owner === 'baseRecipient'
                    ? evmRecipient
                    : owner === 'recipient'
                      ? fixture.recipient.publicKey.toBase58()
                      : fixture.wallet.toBase58(),
            }
            if (result.status === 'rejected') {
              await record({
                ...identity,
                stage: `residue-${owner}-unresolved`,
                errorCode: 'RESIDUE_READ_FAILED',
              })
              continue
            }
            for (const [asset, value] of Object.entries(result.value)) {
              if (typeof value !== 'bigint') continue
              await record({
                ...identity,
                stage: `residue-${owner}-${asset}`,
                balanceDelta: value.toString(),
              })
            }
          }
          if (results.some((result) => result.status === 'rejected'))
            throw new Error('Incomplete residue reads')
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
  },
)
