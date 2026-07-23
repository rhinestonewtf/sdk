import type { AccountRuntimePort } from '../../accounts/adapter'
import { toEvmChainReference } from '../../chains/caip2'
import type {
  AccountQueryPort,
  ChainCatalogPort,
} from '../../clients/orchestrator/port'
import type { OrchestratorPortfolio } from '../../clients/orchestrator/types'

export async function getPortfolio(input: {
  readonly account: AccountRuntimePort
  readonly client: AccountQueryPort & ChainCatalogPort
  readonly onTestnets: boolean
}): Promise<OrchestratorPortfolio> {
  // Filter on the catalog's own `testnet` flag — authoritative for every chain
  // the orchestrator supports (incl. non-EVM and chains newer than the SDK's
  // viem). Filtering through viem would silently drop unknown chains, so their
  // balances would disappear until an SDK/viem bump.
  const catalog = await input.client.getChainCatalog()
  const chainIds = catalog
    .getSupportedChainIds()
    .filter((chainId) => catalog.isTestnet(chainId) === input.onTestnets)
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
