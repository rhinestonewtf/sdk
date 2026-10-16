import {
  getAssociatedTokenAddressSync,
  getMint,
  TOKEN_PROGRAM_ID,
  unpackAccount,
} from '@solana/spl-token'
import {
  type Connection,
  PublicKey,
  SystemProgram,
  type TransactionInstruction,
} from '@solana/web3.js'
import { type Address, erc20Abi, type PublicClient } from 'viem'
import type { TransactionStatus } from '../../../../src/transactions/intents/types'

export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'
export const DEVNET_USDC = new PublicKey(
  '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
)
export const SWIG_PROGRAM = new PublicKey(
  'swigypWHEksbC64pWKwah1WTeh9JXwx8H1rJHLdbQMB',
)
export const SOLANA_AMOUNTS = {
  sameChainUsdc: 10_000n,
  crossChainUsdc: 50_000n,
  // A fresh system-account recipient must receive at least its rent minimum.
  solTransfer: 1_000_000n,
  destinationCallUsdc: 10_000n,
  deliveryCap: 500_000n,
} as const
export const BASE_SEPOLIA_USDC =
  '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const

export interface PollOptions {
  timeoutMs?: number
  intervalMs?: number
}
export async function pollSolana<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  options: PollOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 60_000
  const intervalMs = options.intervalMs ?? 1_000
  if (
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    !Number.isFinite(intervalMs) ||
    intervalMs <= 0
  )
    throw new Error('Invalid polling deadline')
  const deadline = Date.now() + timeoutMs
  while (true) {
    const remaining = deadline - Date.now()
    if (remaining <= 0)
      throw new Error(
        'Solana visibility timeout; reconcile existing submission before spending again',
      )
    let timer: ReturnType<typeof setTimeout> | undefined
    const value = await Promise.race([
      read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error('Solana RPC timeout; reconcile existing submission'),
            ),
          remaining,
        )
      }),
    ]).finally(() => clearTimeout(timer))
    if (accept(value)) return value
    await new Promise((resolve) =>
      setTimeout(
        resolve,
        Math.min(intervalMs, Math.max(0, deadline - Date.now())),
      ),
    )
  }
}

export async function assertSolanaTestNetworks(
  connection: Pick<Connection, 'getGenesisHash'>,
  evmClient: Pick<PublicClient, 'getChainId'>,
) {
  const [genesis, chainId] = await Promise.all([
    connection.getGenesisHash(),
    evmClient.getChainId(),
  ])
  if (genesis !== DEVNET_GENESIS || chainId !== 84532)
    throw new Error(
      'Funding/signing refused: require Solana Devnet and Base Sepolia (84532)',
    )
}

export function usdcAta(owner: PublicKey) {
  return getAssociatedTokenAddressSync(DEVNET_USDC, owner, true)
}
export async function verifyDevnetMint(connection: Connection) {
  const mint = await getMint(
    connection,
    DEVNET_USDC,
    'confirmed',
    TOKEN_PROGRAM_ID,
  )
  if (mint.decimals !== 6 || !mint.isInitialized)
    throw new Error('Devnet USDC mint mismatch')
  return mint
}
export async function readSolanaBalances(
  connection: Connection,
  owner: PublicKey,
) {
  const ata = usdcAta(owner)
  const [lamports, info, rentMinimum] = await Promise.all([
    connection.getBalance(owner, 'confirmed'),
    connection.getAccountInfo(ata, 'confirmed'),
    connection.getMinimumBalanceForRentExemption(0, 'confirmed'),
  ])
  let usdc = 0n
  if (info) {
    const token = unpackAccount(ata, info, TOKEN_PROGRAM_ID)
    if (
      !token.owner.equals(owner) ||
      !token.mint.equals(DEVNET_USDC) ||
      !token.isInitialized ||
      token.isFrozen
    )
      throw new Error('USDC token account ownership/state mismatch')
    usdc = token.amount
  }
  const rentExemptReserve = lamports === 0 ? 0n : BigInt(rentMinimum)
  const spendableLamports =
    BigInt(lamports) > rentExemptReserve
      ? BigInt(lamports) - rentExemptReserve
      : 0n
  return {
    lamports: BigInt(lamports),
    rentExemptReserve,
    spendableLamports,
    usdc,
    ata,
  }
}
export async function waitForSolanaReceipt(
  connection: Connection,
  signature: string,
  options?: PollOptions,
) {
  const receipt = await pollSolana(
    () =>
      connection.getTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      }),
    (value) => value !== null,
    options,
  )
  if (!receipt?.meta || receipt.meta.err !== null)
    throw new Error('Solana receipt failed or has no execution metadata')
  return receipt
}
export async function waitForSolanaBalances(
  connection: Connection,
  owner: PublicKey,
  minimum: { usdc?: bigint; lamports?: bigint },
  options?: PollOptions,
) {
  return pollSolana(
    () => readSolanaBalances(connection, owner),
    (balance) =>
      balance.usdc >= (minimum.usdc ?? 0n) &&
      balance.lamports >= (minimum.lamports ?? 0n),
    options,
  )
}
export async function waitForTerminalIntent(
  sdk: { getIntentStatus(id: string): Promise<TransactionStatus> },
  intentId: string,
  purpose: 'deployment' | 'execution',
  options?: PollOptions & {
    onStatus?: (status: TransactionStatus) => Promise<void>
  },
) {
  const status = await pollSolana(
    async () => {
      const status = await sdk.getIntentStatus(intentId)
      await options?.onStatus?.(status)
      return status
    },
    (value) => value.status !== 'PENDING',
    options,
  )
  if (
    status.status !== 'COMPLETED' ||
    status.purpose !== purpose ||
    status.operations.length === 0 ||
    status.operations.some(
      (group) =>
        group.items.length === 0 ||
        group.items.some((item) => item.status !== 'COMPLETED'),
    )
  )
    throw new Error(
      'Intent did not complete every operation with expected purpose',
    )
  return status
}
export async function readBaseSepoliaBalances(
  client: PublicClient,
  owner: Address,
) {
  if ((await client.getChainId()) !== 84532)
    throw new Error('Base balance read requires Base Sepolia')
  const [wei, usdc] = await Promise.all([
    client.getBalance({ address: owner }),
    client.readContract({
      address: BASE_SEPOLIA_USDC,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [owner],
    }),
  ])
  return { wei, usdc }
}

export async function verifyIntentReceipts(
  status: TransactionStatus,
  connection: Connection,
  evmClient: PublicClient,
  expectedChains: readonly string[],
) {
  await assertSolanaTestNetworks(connection, evmClient)
  if (status.status !== 'COMPLETED')
    throw new Error('Cannot verify unsettled intent receipts')
  const seen = new Set<string>()
  const references = []
  for (const group of status.operations) {
    for (const item of group.items) {
      if (item.status !== 'COMPLETED')
        throw new Error('Intent contains incomplete operations')
      if (!('transaction' in item) || !item.transaction) continue
      const ref = item.transaction
      if (
        ref.chainId !== group.chainId ||
        !expectedChains.includes(String(ref.chainId))
      )
        throw new Error('Unexpected receipt chain')
      if (ref.vm === 'svm') {
        if (ref.chainId !== 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1')
          throw new Error('Non-Devnet Solana receipt refused')
        await waitForSolanaReceipt(connection, ref.signature)
      } else if (ref.vm === 'evm') {
        if (ref.chainId !== 'eip155:84532')
          throw new Error('Non-Base-Sepolia receipt refused')
        const receipt = await evmClient.waitForTransactionReceipt({
          hash: ref.txHash,
          timeout: 60_000,
        })
        if (receipt.status !== 'success')
          throw new Error('EVM execution receipt failed')
      } else throw new Error('Unsupported receipt VM')
      seen.add(String(ref.chainId))
      references.push(ref)
    }
  }
  if (
    expectedChains.length === 0 ||
    expectedChains.some((chain) => !seen.has(chain))
  )
    throw new Error('Missing expected independent chain receipt')
  return references
}

export function solTransferInstruction(
  wallet: PublicKey,
  recipient: PublicKey,
  amount: bigint = SOLANA_AMOUNTS.solTransfer,
): TransactionInstruction {
  if (amount <= 0n) throw new Error('Transfer amount must be positive')
  return SystemProgram.transfer({
    fromPubkey: wallet,
    toPubkey: recipient,
    lamports: amount,
  })
}
