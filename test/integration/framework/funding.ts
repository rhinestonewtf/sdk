import {
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  erc20Abi,
  formatUnits,
  http,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sharedChainCatalog } from '../../../src/chains/catalog'
import { getTokenAddress } from '../../../src/chains/tokens'
import type { RhinestoneAccount } from '../../../src/index'
import { getIntegrationFunderPrivateKey } from '../config/environment'

// Optional per-chain RPC override, e.g. INTEGRATION_RPC_URL_84532=https://...
// Falls back to the viem chain's default public RPC.
function getRpcUrl(chain: Chain): string | undefined {
  return process.env[`INTEGRATION_RPC_URL_${chain.id}`]
}

let funderAccount: ReturnType<typeof privateKeyToAccount> | undefined
function getFunder() {
  if (!funderAccount) {
    funderAccount = privateKeyToAccount(getIntegrationFunderPrivateKey())
  }
  return funderAccount
}

const publicClients = new Map<number, PublicClient>()
function getPublicClient(chain: Chain): PublicClient {
  let client = publicClients.get(chain.id)
  if (!client) {
    client = createPublicClient({ chain, transport: http(getRpcUrl(chain)) })
    publicClients.set(chain.id, client)
  }
  return client
}

const walletClients = new Map<number, WalletClient>()
function getWalletClient(chain: Chain): WalletClient {
  let client = walletClients.get(chain.id)
  if (!client) {
    client = createWalletClient({
      account: getFunder(),
      chain,
      transport: http(getRpcUrl(chain)),
    })
    walletClients.set(chain.id, client)
  }
  return client
}

// Raised when the funder can't cover a top-up. Distinct type so a suite can
// fail fast with a single actionable message instead of N cascading reverts.
export class FunderInsufficientBalanceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FunderInsufficientBalanceError'
  }
}

interface FundingRequest {
  // Minimum balances the target must hold after funding (raw base units).
  native?: bigint
  usdc?: bigint
}

// Tops up `target` on `chain` so it holds at least the requested balances.
// Idempotent: transfers only the shortfall, skips when already funded.
// Throws FunderInsufficientBalanceError (run-blocking) if the funder can't
// cover a needed transfer.
export async function ensureFunded(
  target: Address,
  chain: Chain,
  request: FundingRequest,
): Promise<void> {
  if (request.native !== undefined) {
    await ensureNative(target, chain, request.native)
  }
  if (request.usdc !== undefined) {
    await ensureUsdc(target, chain, request.usdc)
  }
}

async function ensureNative(
  target: Address,
  chain: Chain,
  required: bigint,
): Promise<void> {
  const publicClient = getPublicClient(chain)
  const balance = await publicClient.getBalance({ address: target })
  if (balance >= required) return

  const shortfall = required - balance
  const funder = getFunder()
  const funderBalance = await publicClient.getBalance({
    address: funder.address,
  })
  if (funderBalance < shortfall) {
    throw new FunderInsufficientBalanceError(
      `Funder ${funder.address} has insufficient native balance on ${chain.name}: ` +
        `need ${formatEther(shortfall)} more, has ${formatEther(funderBalance)}. ` +
        `Top up at the ${chain.name} faucet.`,
    )
  }

  const walletClient = getWalletClient(chain)
  const hash = await walletClient.sendTransaction({
    account: funder,
    chain,
    to: target,
    value: shortfall,
  })
  await publicClient.waitForTransactionReceipt({ hash })
}

async function ensureUsdc(
  target: Address,
  chain: Chain,
  required: bigint,
): Promise<void> {
  const usdc = getTokenAddress(sharedChainCatalog, 'USDC', chain.id)
  const publicClient = getPublicClient(chain)
  const balance = await publicClient.readContract({
    address: usdc,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [target],
  })
  if (balance >= required) return

  const shortfall = required - balance
  const funder = getFunder()
  const [funderBalance, decimals] = await Promise.all([
    publicClient.readContract({
      address: usdc,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [funder.address],
    }),
    publicClient.readContract({
      address: usdc,
      abi: erc20Abi,
      functionName: 'decimals',
    }),
  ])
  if (funderBalance < shortfall) {
    throw new FunderInsufficientBalanceError(
      `Funder ${funder.address} has insufficient USDC on ${chain.name}: ` +
        `need ${formatUnits(shortfall, decimals)} more, ` +
        `has ${formatUnits(funderBalance, decimals)} (${usdc}). ` +
        `Top up the funder with USDC on ${chain.name}.`,
    )
  }

  const walletClient = getWalletClient(chain)
  const hash = await walletClient.writeContract({
    account: funder,
    chain,
    address: usdc,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [target, shortfall],
  })
  await publicClient.waitForTransactionReceipt({ hash })
}

function formatEther(wei: bigint): string {
  return formatUnits(wei, 18)
}

export function usdcBalanceOf(address: Address, chain: Chain): Promise<bigint> {
  return getPublicClient(chain).readContract({
    address: getTokenAddress(sharedChainCatalog, 'USDC', chain.id),
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address],
  })
}

// On-chain funding is only useful once the orchestrator's node sees it. Its
// simulation lags the funding RPC by a few seconds, so poll the orchestrator's
// own portfolio view until the balance shows up — otherwise a freshly-funded
// transfer simulates against a stale zero balance and reverts intermittently.
export async function waitForOrchestratorUsdc(
  account: RhinestoneAccount,
  chain: Chain,
  min: bigint,
): Promise<void> {
  return waitForOrchestratorBalance(account, chain, 'USDC', min)
}

export async function waitForOrchestratorNative(
  account: RhinestoneAccount,
  chain: Chain,
  min: bigint,
): Promise<void> {
  return waitForOrchestratorBalance(
    account,
    chain,
    chain.nativeCurrency.symbol,
    min,
  )
}

async function waitForOrchestratorBalance(
  account: RhinestoneAccount,
  chain: Chain,
  symbol: string,
  min: bigint,
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const portfolio = await account.getPortfolio(true)
    const token = portfolio.find((entry) => entry.symbol === symbol)
    const onChain = token?.chains.find((entry) => entry.chain === chain.id)
    if (onChain && onChain.amount >= min) return
    await sleep(2_000)
  }
  throw new Error(
    `Orchestrator portfolio for ${account.getAddress()} never showed >= ${min} ` +
      `${symbol} on ${chain.name} after funding`,
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
