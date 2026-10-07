import type { Address } from 'viem'
import { toEvmChainReference } from '../../chains/caip2'
import type { ChainCatalogPort } from '../../clients/orchestrator/port'
import type { RpcPort } from '../../clients/rpc/port'
import { resolvePolicyAddresses } from '../../modules/validators/smart-sessions/policies/addresses'
import { toSession } from '../../modules/validators/smart-sessions/resolve'
import type {
  Session,
  SessionDefinition,
} from '../../modules/validators/smart-sessions/types'

export async function createSession(input: {
  readonly orchestrator: ChainCatalogPort
  readonly rpc: RpcPort
  readonly environment: 'production' | 'development'
  readonly definition: SessionDefinition
}): Promise<Session> {
  await assertUniversalActionCopies(input.rpc, input.definition)
  const catalog = await input.orchestrator.getChainCatalog()
  const wrappedNativeToken = catalog.getWrappedNativeToken(
    input.definition.chain.id,
  )?.address as Address | undefined
  // Fail fast: without the wrapped-native address we can't add the native-wrap
  // `deposit()` permission, and a silently under-scoped session would
  // sign/enable fine but break native-wrap intents later.
  if (!wrappedNativeToken) {
    throw new Error(
      `createSession: the orchestrator's /chains has no wrapped-native token for chain ${input.definition.chain.id}. The chain must be supported and advertise its wrappedNativeToken.`,
    )
  }
  return toSession(input.definition, {
    wrappedNativeToken,
    environment: input.environment,
    settlement: catalog.getSettlementCatalog(),
  })
}

/**
 * Every configured UniversalActionPolicy copy must hold the same code as
 * `universalAction` on the session's chain: a split installs argument rules
 * there.
 */
async function assertUniversalActionCopies(
  rpc: RpcPort,
  definition: SessionDefinition,
): Promise<void> {
  const addresses = resolvePolicyAddresses(definition.policyAddresses)
  const copies = addresses.universalActionCopies
  if (!copies) return
  const chain = toEvmChainReference(definition.chain.id)
  const port = rpc.forChain(chain)
  const [canonical, ...codes] = await Promise.all(
    [addresses.universalAction, ...copies].map(
      async (address) => (await port.getCode({ chain }, address)).code,
    ),
  )
  if (!canonical || canonical === '0x') {
    throw new Error(
      `createSession: universalAction ${addresses.universalAction} has no code on chain ${chain.id}`,
    )
  }
  copies.forEach((copy, i) => {
    if (codes[i] !== canonical) {
      throw new Error(
        `createSession: universalActionCopies ${copy} does not hold the code of universalAction ${addresses.universalAction} on chain ${chain.id}`,
      )
    }
  })
}
