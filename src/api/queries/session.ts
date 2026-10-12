import type { Address } from 'viem'
import { toEvmChainReference } from '../../chains/caip2'
import type { ChainCatalogPort } from '../../clients/orchestrator/port'
import type { RpcPort } from '../../clients/rpc/port'
import { resolvePolicyAddresses } from '../../modules/validators/smart-sessions/policies/addresses'
import {
  isCodedRefusal,
  type Refuse,
  recover,
  refusal,
  refusalLog,
  refuser,
  type SessionValidation,
} from '../../modules/validators/smart-sessions/refusals'
import {
  type ResolveSessionOptions,
  sessionPolicyAddresses,
  toSession,
  validateSessionDefinition,
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

interface SessionInput {
  readonly orchestrator: ChainCatalogPort
  readonly rpc: RpcPort
  readonly environment: 'production' | 'development'
  readonly definition: SessionDefinition
}

/**
 * createSession's reads before it resolves: the UniversalActionPolicy copies'
 * code, then `/chains`. A coded refusal goes to `refuse`; anything else, such
 * as a failed read, throws.
 */
async function sessionOptions(
  input: SessionInput,
  refuse: Refuse,
): Promise<ResolveSessionOptions> {
  await assertUniversalActionCopies(input.rpc, input.definition).catch(
    (error: unknown) => {
      if (!isCodedRefusal(error)) throw error
      refuse(error)
    },
  )
  const catalog = await input.orchestrator.getChainCatalog()
  // The token only adds an unrestricted session's `deposit()`, so a dry run
  // still resolves the session without it.
  const wrappedNativeToken = recover(refuse, () =>
    servedWrappedNativeToken(catalog, input.definition.chain.id),
  )
  return {
    environment: input.environment,
    settlement: catalog.getSettlementCatalog(),
    ...(wrappedNativeToken ? { wrappedNativeToken } : {}),
  }
}

export async function createSession(input: SessionInput): Promise<Session> {
  return toSession(input.definition, await sessionOptions(input, refuser()))
}

/** The dry run of `createSession`: the same reads and resolution, every refusal recorded. */
export async function validateSession(
  input: SessionInput,
): Promise<SessionValidation> {
  // One log, so a refusal met before resolving stays first, as createSession throws it.
  const log = refusalLog()
  const options = await sessionOptions(input, refuser(log.collect))
  return validateSessionDefinition(input.definition, options, log)
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
  const addresses = resolvePolicyAddresses(sessionPolicyAddresses(definition))
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
    throw refusal(
      'UNIVERSAL_ACTION_POLICY_NO_CODE',
      `createSession: universalAction ${addresses.universalAction} has no code on chain ${chain.id}`,
    )
  }
  copies.forEach((copy, i) => {
    if (codes[i] !== canonical) {
      throw refusal(
        'UNIVERSAL_ACTION_COPY_CODE_MISMATCH',
        `createSession: universalActionCopies ${copy} does not hold the code of universalAction ${addresses.universalAction} on chain ${chain.id}`,
      )
    }
  })
}
