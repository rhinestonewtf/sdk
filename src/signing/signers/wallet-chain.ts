import { type Account, createWalletClient, custom } from 'viem'
import type { EvmChainReference } from '../../chains/types'
import type { ChainResolver } from './types'

export async function selectSignerChain(input: {
  readonly account: Account
  readonly chain?: EvmChainReference
  readonly resolveChain?: ChainResolver
}): Promise<void> {
  if (!input.chain || !input.resolveChain) return
  const transport = input.account.client?.transport
  if (!transport) return
  const chain = input.resolveChain(input.chain)
  const walletClient = createWalletClient({
    account: input.account,
    chain,
    transport: custom(transport),
  })
  await walletClient.switchChain({ id: chain.id })
}
