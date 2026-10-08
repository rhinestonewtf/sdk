import type { Address } from 'viem'
import type { ChainCatalogPort } from '../../clients/orchestrator/port'
import {
  type CrossChainPermitRefusal,
  collectRefusals,
  refusal,
} from '../../modules/validators/smart-sessions/refusals'
import {
  collectSessionRefusals,
  toSession,
} from '../../modules/validators/smart-sessions/resolve'
import type {
  Session,
  SessionDefinition,
} from '../../modules/validators/smart-sessions/types'

type ChainCatalog = Awaited<ReturnType<ChainCatalogPort['getChainCatalog']>>

function servedWrappedNativeToken(
  catalog: ChainCatalog,
  chainId: number,
): Address {
  const wrappedNativeToken = catalog.getWrappedNativeToken(chainId)?.address as
    | Address
    | undefined
  // Fail fast: without the wrapped-native address we can't add the native-wrap
  // `deposit()` permission, and a silently under-scoped session would
  // sign/enable fine but break native-wrap intents later.
  if (!wrappedNativeToken) {
    throw refusal(
      'WRAPPED_NATIVE_TOKEN_UNSERVED',
      `createSession: the orchestrator's /chains has no wrapped-native token for chain ${chainId}. The chain must be supported and advertise its wrappedNativeToken.`,
    )
  }
  return wrappedNativeToken
}

export async function createSession(input: {
  readonly orchestrator: ChainCatalogPort
  readonly environment: 'production' | 'development'
  readonly definition: SessionDefinition
}): Promise<Session> {
  const catalog = await input.orchestrator.getChainCatalog()
  return toSession(input.definition, {
    wrappedNativeToken: servedWrappedNativeToken(
      catalog,
      input.definition.chain.id,
    ),
    environment: input.environment,
    settlement: catalog.getSettlementCatalog(),
  })
}

/** Every refusal `createSession` would throw for `definition`, from the same `/chains` inputs. */
export async function validateCrossChainPermits(input: {
  readonly orchestrator: ChainCatalogPort
  readonly environment: 'production' | 'development'
  readonly definition: SessionDefinition
}): Promise<CrossChainPermitRefusal[]> {
  const catalog = await input.orchestrator.getChainCatalog()
  let wrappedNativeToken: Address | undefined
  // The token only adds an unrestricted session's `deposit()`, so the session
  // checks still run without it.
  const unserved = collectRefusals(() => {
    wrappedNativeToken = servedWrappedNativeToken(
      catalog,
      input.definition.chain.id,
    )
  })
  return [
    ...unserved,
    ...collectSessionRefusals(input.definition, {
      environment: input.environment,
      settlement: catalog.getSettlementCatalog(),
      ...(wrappedNativeToken ? { wrappedNativeToken } : {}),
    }),
  ]
}
