import {
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  http,
  maxUint256,
  type PublicClient,
  parseAbi,
} from 'viem'
import {
  FIXTURE_SIGNERS,
  FUNDED_CHAINS,
  type FundedChainId,
  PERMIT2,
  TOKENS,
} from './fixtures'

// On-chain reads and the EOA fixture's own transactions. None of this goes
// through the orchestrator, so nothing here is recorded.

const WETH_ABI = parseAbi([
  'function deposit() payable',
  'function withdraw(uint256 amount)',
])

function chainOf(chainId: FundedChainId): Chain {
  const chain = FUNDED_CHAINS.find((entry) => entry.id === chainId)
  if (!chain) throw new Error(`No funded chain ${chainId}`)
  return chain
}

// `PARITY_RPC_URL_<chainId>` overrides viem's default public RPC.
function rpcUrl(
  chainId: number,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  return env[`PARITY_RPC_URL_${chainId}`] || undefined
}

const clients = new Map<number, PublicClient>()

function publicClient(chainId: FundedChainId): PublicClient {
  let client = clients.get(chainId)
  if (!client) {
    client = createPublicClient({
      chain: chainOf(chainId),
      transport: http(rpcUrl(chainId), { retryCount: 5, retryDelay: 500 }),
    }) as PublicClient
    clients.set(chainId, client)
  }
  return client
}

interface ChainReader {
  balance(
    chainId: FundedChainId,
    owner: Address,
    token: Address | 'ETH',
  ): Promise<bigint>
  allowance(
    chainId: FundedChainId,
    owner: Address,
    token: Address,
    spender: Address,
  ): Promise<bigint>
  hasCode(chainId: FundedChainId, address: Address): Promise<boolean>
}

const chainReader: ChainReader = {
  balance(chainId, owner, token) {
    const client = publicClient(chainId)
    if (token === 'ETH') return client.getBalance({ address: owner })
    return client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [owner],
    })
  },
  allowance(chainId, owner, token, spender) {
    return publicClient(chainId).readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [owner, spender],
    })
  },
  async hasCode(chainId, address) {
    const code = await publicClient(chainId).getCode({ address })
    return code !== undefined && code !== '0x'
  },
}

async function eoaTransaction(
  chainId: FundedChainId,
  request: { to: Address; data?: Hex; value?: bigint },
): Promise<Hex> {
  const wallet = createWalletClient({
    account: FIXTURE_SIGNERS.eoa,
    chain: chainOf(chainId),
    transport: http(rpcUrl(chainId), { retryCount: 5, retryDelay: 500 }),
  })
  const client = publicClient(chainId)
  const hash = await wallet.sendTransaction(request)
  const receipt = await client.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') {
    throw new Error(`EOA transaction ${hash} reverted on chain ${chainId}`)
  }
  return hash
}

// The EOA fixture's resets between builds; each waits for its receipt.
const eoaActions = {
  async setPermit2Allowance(
    chainId: FundedChainId,
    token: Address,
    amount: bigint,
  ) {
    return eoaTransaction(chainId, {
      to: token,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [PERMIT2, amount],
      }),
    })
  },
  async ensureMaxPermit2Allowance(chainId: FundedChainId, token: Address) {
    const current = await chainReader.allowance(
      chainId,
      FIXTURE_SIGNERS.eoa.address,
      token,
      PERMIT2,
    )
    if (current >= maxUint256 / 2n) return undefined
    return eoaActions.setPermit2Allowance(chainId, token, maxUint256)
  },
  async wrap(chainId: FundedChainId, amount: bigint) {
    return eoaTransaction(chainId, {
      to: TOKENS[chainId].WETH,
      data: encodeFunctionData({ abi: WETH_ABI, functionName: 'deposit' }),
      value: amount,
    })
  },
  async unwrapAll(chainId: FundedChainId) {
    const weth = TOKENS[chainId].WETH
    const balance = await chainReader.balance(
      chainId,
      FIXTURE_SIGNERS.eoa.address,
      weth,
    )
    if (balance === 0n) return undefined
    return eoaTransaction(chainId, {
      to: weth,
      data: encodeFunctionData({
        abi: WETH_ABI,
        functionName: 'withdraw',
        args: [balance],
      }),
    })
  },
}

// Passed to both builds when set, so SDK reads use the same RPC as the harness.
function providerOverride(
  env: Record<string, string | undefined> = process.env,
): { type: 'custom'; urls: Record<number, string> } | undefined {
  const urls: Record<number, string> = {}
  for (const chain of FUNDED_CHAINS) {
    const url = rpcUrl(chain.id, env)
    if (url) urls[chain.id] = url
  }
  return Object.keys(urls).length > 0 ? { type: 'custom', urls } : undefined
}

export type { ChainReader }
export { chainReader, eoaActions, providerOverride, publicClient, rpcUrl }
