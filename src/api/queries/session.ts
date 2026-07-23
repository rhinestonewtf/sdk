import type { Address } from 'viem'
import type { ChainCatalogPort } from '../../clients/orchestrator/port'
import { toSession } from '../../modules/validators/smart-sessions/resolve'
import type {
  Session,
  SessionDefinition,
} from '../../modules/validators/smart-sessions/types'

export async function createSession(input: {
  readonly orchestrator: ChainCatalogPort
  readonly environment: 'production' | 'development'
  readonly definition: SessionDefinition
}): Promise<Session> {
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
  })
}
