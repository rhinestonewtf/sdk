import type { AccountRuntimePort } from '../../accounts/adapter'
import {
  formatCaip2,
  isEvmCaip2,
  toEvmChainReference,
} from '../../chains/caip2'
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
  // The catalog's `testnet` flag is authoritative even for chains newer than
  // the SDK's viem version, while the portfolio endpoint accepts only EIP-155.
  const catalog = await input.client.getChainCatalog()
  const chainIds = catalog
    .getSupportedChainIds()
    .filter(
      (chainId) =>
        catalog.isTestnet(chainId) === input.onTestnets &&
        isEvmCaip2(formatCaip2(chainId)),
    )
  const accountChainId = chainIds[0]
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
