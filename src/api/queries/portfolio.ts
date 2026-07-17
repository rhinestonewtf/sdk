import type { AccountRuntimePort } from '../../accounts/adapter'
import { toEvmChainReference } from '../../chains/caip2'
import { isTestnet, sharedChainCatalog } from '../../chains/catalog'
import type { AccountQueryPort } from '../../clients/orchestrator/port'
import type { OrchestratorPortfolio } from '../../clients/orchestrator/types'

export async function getPortfolio(input: {
  readonly account: AccountRuntimePort
  readonly client: AccountQueryPort
  readonly onTestnets: boolean
}): Promise<OrchestratorPortfolio> {
  const chainIds = sharedChainCatalog
    .getSupportedChainIds()
    .filter((chainId) => {
      try {
        return isTestnet(sharedChainCatalog, chainId) === input.onTestnets
      } catch {
        return false
      }
    })
  const accountChainId = chainIds.find((chainId) => {
    try {
      toEvmChainReference(chainId)
      return true
    } catch {
      return false
    }
  })
  if (accountChainId === undefined) {
    throw new Error(
      'No EVM chain is available for portfolio account resolution',
    )
  }
  const runtime = await input.account.forChain(
    toEvmChainReference(accountChainId),
  )
  return input.client.getPortfolio({
    account: runtime.identity.address,
    chainIds,
  })
}
