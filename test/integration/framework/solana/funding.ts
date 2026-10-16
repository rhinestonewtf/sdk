import { base58 } from '@scure/base'
import {
  ACCOUNT_SIZE,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAccount,
} from '@solana/spl-token'
import {
  type Keypair,
  type PublicKey,
  SystemProgram,
  Transaction,
  type TransactionInstruction,
} from '@solana/web3.js'
import {
  type Address,
  encodeFunctionData,
  erc20Abi,
  keccak256,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { baseSepolia } from 'viem/chains'
import { estimateTotalFee } from 'viem/op-stack'
import { assertVerifiedSolanaFixture, type SolanaFixture } from './fixture'
import {
  assertSolanaTestNetworks,
  BASE_SEPOLIA_USDC,
  DEVNET_USDC,
  pollSolana,
  readBaseSepoliaBalances,
  readSolanaBalances,
  SOLANA_AMOUNTS,
  usdcAta,
  verifyDevnetMint,
  waitForSolanaBalances,
  waitForSolanaReceipt,
} from './rpc'

export type FundingAsset = 'solLamports' | 'solUsdc' | 'baseWei' | 'baseUsdc'
export const SOLANA_FUNDING_LIMITS = {
  solLamports: 100_000_000n,
  solUsdc: 5_000_000n,
  baseWei: 2_000_000_000_000_000n,
  baseUsdc: 5_000_000n,
} as const
export class SolanaFundingBudget {
  private readonly spent: Record<FundingAsset, bigint> = {
    solLamports: 0n,
    solUsdc: 0n,
    baseWei: 0n,
    baseUsdc: 0n,
  }
  reserve(costs: Partial<Record<FundingAsset, bigint>>) {
    for (const asset of Object.keys(costs) as FundingAsset[]) {
      const amount = costs[asset] ?? 0n
      if (
        amount < 0n ||
        this.spent[asset] + amount > SOLANA_FUNDING_LIMITS[asset]
      )
        throw new Error(`Funding budget exceeded: ${asset}`)
    }
    for (const asset of Object.keys(costs) as FundingAsset[])
      this.spent[asset] += costs[asset] ?? 0n
  }
  snapshot() {
    return { ...this.spent }
  }
}
export function fundingShortfall(balance: bigint, target: bigint) {
  if (balance < 0n || target < 0n)
    throw new Error('Negative funding target/balance')
  return target > balance ? target - balance : 0n
}
export function assertDeliveryCap(
  debit: bigint,
  cap: bigint = SOLANA_AMOUNTS.deliveryCap,
) {
  if (
    cap <= 0n ||
    cap > SOLANA_AMOUNTS.deliveryCap ||
    debit < 0n ||
    debit > cap
  )
    throw new Error('Delivery source cap exceeded')
}
export function usdcTransferInstruction(
  wallet: PublicKey,
  recipient: PublicKey,
  amount: bigint = SOLANA_AMOUNTS.sameChainUsdc,
) {
  if (amount <= 0n) throw new Error('Transfer amount must be positive')
  return createTransferCheckedInstruction(
    usdcAta(wallet),
    DEVNET_USDC,
    usdcAta(recipient),
    wallet,
    amount,
    6,
  )
}
export class SolanaFundingHarness {
  private busy = false
  private unresolved = false
  constructor(
    readonly fixture: SolanaFixture,
    private readonly funder: Keypair,
    readonly budget = new SolanaFundingBudget(),
    private readonly assertActive: () => void = () => {},
    private readonly persistTransaction: (
      signature: string,
    ) => Promise<void> = async () => {},
  ) {}
  private async guarded<T>(run: () => Promise<T>) {
    if (this.busy || this.unresolved)
      throw new Error('Funding blocked: concurrent or unresolved submission')
    this.busy = true
    try {
      assertVerifiedSolanaFixture(this.fixture)
      await assertSolanaTestNetworks(
        this.fixture.connection,
        this.fixture.evmClient,
      )
      await verifyDevnetMint(this.fixture.connection)
      return await run()
    } finally {
      this.busy = false
    }
  }
  private async send(
    instructions: TransactionInstruction[],
    rent: bigint,
    transferLamports = 0n,
    usdc = 0n,
  ) {
    const connection = this.fixture.connection
    const block = await connection.getLatestBlockhash('confirmed')
    const tx = new Transaction({
      feePayer: this.funder.publicKey,
      ...block,
    }).add(...instructions)
    const fee = (
      await connection.getFeeForMessage(tx.compileMessage(), 'confirmed')
    ).value
    if (fee === null) throw new Error('Unable to estimate Solana funding fee')
    const required = rent + transferLamports + BigInt(fee)
    if (
      BigInt(await connection.getBalance(this.funder.publicKey, 'confirmed')) <
      required
    )
      throw new Error('Insufficient Solana funder SOL (rent/fee headroom)')
    this.budget.reserve({ solLamports: required, solUsdc: usdc })
    tx.sign(this.funder)
    if (!tx.signature) throw new Error('Missing Solana funding signature')
    const signature = base58.encode(tx.signature)
    this.unresolved = true
    // Persist the signed reference even if broadcast times out ambiguously.
    this.assertActive()
    await this.persistTransaction(signature)
    this.assertActive()
    await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      maxRetries: 0,
    })
    await waitForSolanaReceipt(connection, signature)
    this.unresolved = false
    return signature
  }
  async setupTokenAccounts() {
    return this.guarded(async () => {
      const owners = [this.fixture.wallet, this.fixture.recipient.publicKey]
      const instructions: TransactionInstruction[] = []
      let rent = 0n
      for (const owner of owners) {
        if (
          !(await this.fixture.connection.getAccountInfo(
            usdcAta(owner),
            'confirmed',
          ))
        ) {
          rent += BigInt(
            await this.fixture.connection.getMinimumBalanceForRentExemption(
              ACCOUNT_SIZE,
              'confirmed',
            ),
          )
          instructions.push(
            createAssociatedTokenAccountIdempotentInstruction(
              this.funder.publicKey,
              usdcAta(owner),
              owner,
              DEVNET_USDC,
            ),
          )
        }
      }
      // Keep recipient rent separate from the native transfer being measured.
      const recipientReserve = BigInt(
        await this.fixture.connection.getMinimumBalanceForRentExemption(
          0,
          'confirmed',
        ),
      )
      const recipientShortfall = fundingShortfall(
        BigInt(
          await this.fixture.connection.getBalance(
            this.fixture.recipient.publicKey,
            'confirmed',
          ),
        ),
        recipientReserve,
      )
      if (recipientShortfall)
        instructions.push(
          SystemProgram.transfer({
            fromPubkey: this.funder.publicKey,
            toPubkey: this.fixture.recipient.publicKey,
            lamports: recipientShortfall,
          }),
        )
      const signature = instructions.length
        ? await this.send(instructions, rent, recipientShortfall)
        : undefined
      for (const owner of owners) {
        await pollSolana(
          () =>
            this.fixture.connection.getAccountInfo(usdcAta(owner), 'confirmed'),
          (value) => value !== null,
        )
        await readSolanaBalances(this.fixture.connection, owner)
      }
      await waitForSolanaBalances(
        this.fixture.connection,
        this.fixture.recipient.publicKey,
        { lamports: recipientReserve },
      )
      return signature
    })
  }
  async fundShortfall(target: { usdc: bigint; lamports: bigint }) {
    return this.guarded(async () => {
      const before = await readSolanaBalances(
        this.fixture.connection,
        this.fixture.wallet,
      )
      if (
        !(await this.fixture.connection.getAccountInfo(before.ata, 'confirmed'))
      )
        throw new Error('Set up fixture ATA before funding')
      const usdc = fundingShortfall(before.usdc, target.usdc)
      const lamports = fundingShortfall(before.lamports, target.lamports)
      const instructions: TransactionInstruction[] = []
      if (usdc) {
        const source = await getAccount(
          this.fixture.connection,
          usdcAta(this.funder.publicKey),
          'confirmed',
        )
        if (
          !source.owner.equals(this.funder.publicKey) ||
          !source.mint.equals(DEVNET_USDC) ||
          source.isFrozen ||
          source.amount < usdc
        )
          throw new Error('Insufficient/invalid Solana funder USDC')
        instructions.push(
          usdcTransferInstruction(
            this.funder.publicKey,
            this.fixture.wallet,
            usdc,
          ),
        )
      }
      if (lamports)
        instructions.push(
          SystemProgram.transfer({
            fromPubkey: this.funder.publicKey,
            toPubkey: this.fixture.wallet,
            lamports,
          }),
        )
      const signature = instructions.length
        ? await this.send(instructions, 0n, lamports, usdc)
        : undefined
      const after = await waitForSolanaBalances(
        this.fixture.connection,
        this.fixture.wallet,
        target,
      )
      return { before, after, signature }
    })
  }
}

const unresolvedBaseBudgets = new WeakSet<SolanaFundingBudget>()
const busyBaseBudgets = new WeakSet<SolanaFundingBudget>()
export async function fundBaseSepoliaShortfall(
  input: Parameters<typeof fundBaseSepoliaShortfallInner>[0],
) {
  if (busyBaseBudgets.has(input.budget))
    throw new Error('Concurrent Base funding refused')
  busyBaseBudgets.add(input.budget)
  try {
    return await fundBaseSepoliaShortfallInner(input)
  } finally {
    busyBaseBudgets.delete(input.budget)
  }
}
async function fundBaseSepoliaShortfallInner({
  fixture,
  publicClient,
  walletClient,
  budget,
  target,
  assertActive = () => {},
  persistTransaction = async () => {},
}: {
  fixture: SolanaFixture
  publicClient: PublicClient
  walletClient: WalletClient
  budget: SolanaFundingBudget
  target: { usdc: bigint; wei: bigint }
  assertActive?: () => void
  persistTransaction?: (hash: string) => Promise<void>
}) {
  assertVerifiedSolanaFixture(fixture)
  await assertSolanaTestNetworks(fixture.connection, publicClient)
  if (unresolvedBaseBudgets.has(budget))
    throw new Error('Base funding blocked: unresolved or concurrent submission')
  const account = walletClient.account
  if (
    !account ||
    account.type !== 'local' ||
    (await walletClient.getChainId()) !== 84532
  )
    throw new Error('Base Sepolia funding local signer/network missing')
  if (account.address.toLowerCase() === fixture.evmAddress.toLowerCase())
    throw new Error('Funder must differ from fixture')
  const recipient = fixture.evmAddress as Address
  const [balance, usdcBalance] = await Promise.all([
    publicClient.getBalance({ address: recipient }),
    publicClient.readContract({
      address: BASE_SEPOLIA_USDC,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [recipient],
    }),
  ])
  const wei = fundingShortfall(balance, target.wei)
  const usdc = fundingShortfall(usdcBalance, target.usdc)
  const calls = [
    ...(wei ? [{ to: recipient, value: wei, data: '0x' as const }] : []),
    ...(usdc
      ? [
          {
            to: BASE_SEPOLIA_USDC,
            value: 0n,
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: 'transfer',
              args: [recipient, usdc],
            }),
          },
        ]
      : []),
  ]
  if (
    usdc &&
    (await publicClient.readContract({
      address: BASE_SEPOLIA_USDC,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account.address],
    })) < usdc
  )
    throw new Error('Insufficient Base funder USDC')
  const gasPrice = await publicClient.getGasPrice()
  const prepared = await Promise.all(
    calls.map(async (call) => ({
      ...call,
      gas: await publicClient.estimateGas({ account, ...call }),
    })),
  )
  const feeReservations = await Promise.all(
    prepared.map(async (call) => {
      const l2Fee = call.gas * gasPrice
      const total = await estimateTotalFee(publicClient, {
        account,
        chain: baseSepolia,
        ...call,
        maxFeePerGas: gasPrice,
        maxPriorityFeePerGas: 0n,
        type: 'eip1559',
      })
      if (total < l2Fee || total <= 0n)
        throw new Error('Unable to estimate full Base funding fee')
      // Fixed 2x headroom covers fee movement without an unbounded allowance.
      // Keep the full reservation charged even when the receipt costs less.
      return total * 2n
    }),
  )
  const gasCost = feeReservations.reduce((sum, fee) => sum + fee, 0n)
  if (
    (await publicClient.getBalance({ address: account.address })) <
    wei + gasCost
  )
    throw new Error('Insufficient Base funder ETH fee headroom')
  budget.reserve({ baseWei: wei + gasCost, baseUsdc: usdc })
  unresolvedBaseBudgets.add(budget)
  const hashes = []
  for (const call of prepared) {
    assertActive()
    const request = await walletClient.prepareTransactionRequest({
      account,
      chain: baseSepolia,
      ...call,
      gasPrice,
      type: 'legacy',
    })
    const serializedTransaction = await walletClient.signTransaction(request)
    const hash = keccak256(serializedTransaction)
    await persistTransaction(hash)
    assertActive()
    await walletClient.sendRawTransaction({ serializedTransaction })
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      timeout: 60_000,
    })
    if (receipt.status !== 'success')
      throw new Error('Base funding receipt failed')
    hashes.push(hash)
  }
  await pollSolana(
    () => readBaseSepoliaBalances(publicClient, recipient),
    (balance) => balance.wei >= target.wei && balance.usdc >= target.usdc,
  )
  unresolvedBaseBudgets.delete(budget)
  return { wei, usdc, hashes }
}
