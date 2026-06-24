import { type Address, type Chain, type Hex, isAddress } from 'viem'
import {
  getModuleInstallationCalls,
  getModuleUninstallationCalls,
} from '../accounts'
import {
  getEnableSessionCall,
  getSmartSessionValidator,
} from '../modules/validators/smart-sessions'
import { getTokenAddress } from '../orchestrator/registry'
import type {
  CrossChainPermit,
  CrossChainSettlementLayer,
  LazyCallInput,
  Session,
  TokenSymbol,
} from '../types'

/**
 * Enable smart sessions
 * @returns Calls to enable smart sessions
 */
function experimental_enable(): LazyCallInput {
  return {
    async resolve({ config }) {
      const module = getSmartSessionValidator(config)
      if (!module) {
        return []
      }
      return getModuleInstallationCalls(config, module)
    },
  }
}

/**
 * Disable smart sessions
 * @returns Calls to disable smart sessions
 */
function experimental_disable(): LazyCallInput {
  return {
    async resolve({ chain, config }) {
      const module = getSmartSessionValidator(config)
      if (!module) {
        return []
      }
      return getModuleUninstallationCalls(config, chain, module)
    },
  }
}

/**
 * Enable a smart session
 *
 * The `session` must be a resolved `Session` (the return value of
 * `toSession(...)`). Re-resolving it here would drop the explicit
 * `permissions` — a `Session` only carries the derived `actions`, not the
 * original `SessionDefinition.permissions` — which makes the on-chain digest
 * computed by `SmartSessionLens.getAndVerifyDigest` diverge from the one
 * signed in `getSessionDetails`, causing the emissary to reject the enable.
 *
 * @param session resolved session to enable
 * @returns Calls to enable the smart session
 */
function experimental_enableSession(
  session: Session,
  enableSessionSignature: Hex,
  hashesAndChainIds: {
    chainId: bigint
    sessionDigest: Hex
  }[],
  sessionToEnableIndex: number,
): LazyCallInput {
  return {
    async resolve({ accountAddress, config }) {
      return getEnableSessionCall(
        accountAddress,
        session,
        enableSessionSignature,
        hashesAndChainIds,
        sessionToEnableIndex,
        config.useDevContracts,
      )
    },
  }
}

// ---------------------------------------------------------------------------
// Cross-chain permits
// ---------------------------------------------------------------------------

interface FromLeg {
  chain: Chain
  token: Address | TokenSymbol
  maxAmount?: bigint
}

interface ToLeg {
  chain: Chain
  token: Address | TokenSymbol
  recipient?: Address | 'any'
}

interface CreateCrossChainPermissionInput {
  /**
   * Source chain + token (+ optional max amount cap). Pass a single leg
   * or an array for multi-leg permits. Omit for no source-token
   * restriction (any token on any chain may be pulled) — the arbiter
   * whitelist, deadline, and bridge-to-self flag still apply.
   */
  from?: FromLeg | FromLeg[]
  /**
   * Destination chain + token (+ optional recipient pin). Pass a single
   * leg or an array for fan-out destinations. Omit for no
   * destination-token restriction; `recipientIsAccount` still constrains
   * the recipient.
   */
  to?: ToLeg | ToLeg[]
  /** Upper bound on the permit deadline. Accepts unix-seconds bigint or `Date`. */
  validUntil?: bigint | Date
  /** Lower bound on the permit deadline. Accepts unix-seconds bigint or `Date`. */
  validAfter?: bigint | Date
  /** Per-destination fill-deadline windows (unix-seconds bigints). */
  fillDeadline?: { chain: Chain; min?: bigint; max?: bigint }[]
  /**
   * Allow the destination recipient to differ from the smart account
   * (the sponsor funding the cross-chain transfer). Defaults to
   * `false`, which enforces bridge-to-self on-chain — the safer default
   * since it prevents a compromised session key from routing funds to
   * an attacker-controlled address. Set to `true` to opt out explicitly.
   */
  allowRecipientNotAccount?: boolean
  /**
   * Settlement layers this session is permitted to use. Omit (or pass
   * `[]`) to allow **any of the supported settlement layers** — the SDK
   * resolves to the union of every known arbiter from
   * `@rhinestone/shared-configs`. Pass a subset (e.g. `['ECO']`) to
   * narrow.
   */
  settlementLayers?: CrossChainSettlementLayer[]
}

function toUnixSecondsBigint(input: bigint | Date): bigint {
  if (typeof input === 'bigint') return input
  // Date.getTime() returns milliseconds since epoch; the on-chain policy
  // expects unix-seconds. Integer division matches the Permit2 deadline
  // convention.
  return BigInt(Math.floor(input.getTime() / 1000))
}

function resolveTokenForChain(
  token: Address | TokenSymbol,
  chainId: number,
): Address {
  return isAddress(token) ? token : getTokenAddress(token, chainId)
}

/**
 * Build a {@link CrossChainPermit} from an ergonomic input shape.
 *
 * Accepts:
 *   - a single `from`/`to` leg or arrays of legs
 *   - `TokenSymbol` ("USDC", "USDT", ...) which is resolved to the
 *     per-chain ERC-20 address via the shared token registry
 *   - `Date` or unix-seconds `bigint` for `validUntil`/`validAfter`
 *
 * Plug the returned object into `SessionDefinition.crossChainPermits`
 * to permission a session key for Permit2-backed cross-chain transfers.
 *
 * @example
 * ```ts
 * import { arbitrum, mainnet } from 'viem/chains'
 *
 * const permit = createCrossChainPermission({
 *   from: { chain: mainnet, token: 'USDC', maxAmount: 1_000_000_000n },
 *   to:   { chain: arbitrum, token: 'USDC' },
 *   validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
 * })
 *
 * const session = toSession({
 *   chain: mainnet,
 *   owners: { type: 'ecdsa', accounts: [sessionKey] },
 *   crossChainPermits: [permit],
 * })
 * ```
 */
function createCrossChainPermission(
  input: CreateCrossChainPermissionInput,
): CrossChainPermit {
  // Normalise the single-object / array / omitted shapes into arrays.
  // An omitted side stays `undefined` on the returned permit (no
  // restriction), mirroring how the underlying Permit2 policy treats an
  // absent token list.
  const normalizeLegs = <T>(legs: T | T[] | undefined): T[] | undefined => {
    if (legs === undefined) return undefined
    const arr = Array.isArray(legs) ? legs : [legs]
    return arr.length ? arr : undefined
  }
  const fromLegs = normalizeLegs(input.from)
  const toLegs = normalizeLegs(input.to)

  const from = fromLegs?.map((leg) => ({
    chain: leg.chain,
    token: resolveTokenForChain(leg.token, leg.chain.id),
    maxAmount: leg.maxAmount,
  }))
  const to = toLegs?.map((leg) => ({
    chain: leg.chain,
    token: resolveTokenForChain(leg.token, leg.chain.id),
    recipient: leg.recipient,
  }))

  const validUntil =
    input.validUntil !== undefined
      ? toUnixSecondsBigint(input.validUntil)
      : undefined
  const validAfter =
    input.validAfter !== undefined
      ? toUnixSecondsBigint(input.validAfter)
      : undefined

  // Detect an obviously-broken time window early. The on-chain policy
  // would reject any intent in this state anyway; surfacing it at build
  // time saves a round-trip to chain.
  if (
    validUntil !== undefined &&
    validAfter !== undefined &&
    validAfter > validUntil
  ) {
    throw new Error(
      `createCrossChainPermission: validAfter (${validAfter}) is greater than validUntil (${validUntil})`,
    )
  }

  return {
    from,
    to,
    validUntil,
    validAfter,
    fillDeadline: input.fillDeadline,
    // Inverted default: callers must opt out of bridge-to-self
    // explicitly. This stops a session key from quietly bridging to an
    // attacker-controlled recipient.
    recipientIsAccount: !input.allowRecipientNotAccount,
    // Passed through verbatim. `getArbitersForSettlementLayers` expands
    // undefined/empty to "all supported layers" at session-data build
    // time.
    settlementLayers: input.settlementLayers,
  }
}

export {
  experimental_disable,
  experimental_enable,
  experimental_enableSession,
  createCrossChainPermission,
}
