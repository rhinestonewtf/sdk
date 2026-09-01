import { type Abi, type Address, toFunctionSelector } from 'viem'
import { namedParamOffsets } from '../../permissions'
import type { UniversalActionPolicyParamRule, ZeroExVenue } from '../types'
import type { VenueContext, VenueScoping } from './rules'
import { cumulativeCap, pin, swapAction } from './rules'

/**
 * 0x — Swap API v2, AllowanceHolder flow.
 *
 * Two calls per swap:
 *   1. `approve(AllowanceHolder, amount)` on the sell token
 *   2. `AllowanceHolder.exec(operator, token, amount, target, data)` — pulls the
 *      approved sell token and forwards `data` to the Settler.
 *
 * The split matters for scoping. `token` and `amount` are consumed by the
 * AllowanceHolder itself, so pinning them is meaningful no matter what `target`
 * is. `operator` and `target` decide who receives the pulled funds, and nothing
 * on-chain requires them to be a Settler — leave them free and a compromised
 * session key names its own contract.
 */

/** Permanent across chains — 0x never rotates this. Verified deployed on Plasma. */
export const ZEROX_ALLOWANCE_HOLDER: Address =
  '0x0000000000001fF3684f28c67538d4D072C22734'

/** Chains where 0x is an enabled quoter with a whitelisted Settler. */
export const ZEROX_CHAIN_IDS = [
  1, 10, 56, 130, 137, 143, 146, 999, 4663, 8453, 9745, 42161, 43114, 57073,
] as const

export type ZeroExChainId = (typeof ZEROX_CHAIN_IDS)[number]

export const allowanceHolderAbi = [
  {
    type: 'function',
    name: 'exec',
    stateMutability: 'payable',
    inputs: [
      { name: 'operator', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'target', type: 'address' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [{ name: 'result', type: 'bytes' }],
  },
] as const satisfies Abi

export const ALLOWANCE_HOLDER_EXEC_SELECTOR = toFunctionSelector(
  allowanceHolderAbi[0],
)

/** exec's own head offsets, derived from the ABI. */
const EXEC = namedParamOffsets(allowanceHolderAbi as unknown as Abi, 'exec')

/**
 * Offsets of the Settler's slippage fields, measured in EXEC's calldata.
 *
 * These cannot come from an ABI: they live inside `exec.data`, which is opaque
 * `bytes` as far as exec's own signature is concerned. They are stable anyway
 * because the Settler's
 * `execute((recipient, buyToken, minAmountOut) slippage, bytes[] actions, bytes32)`
 * places the fixed-size slippage struct BEFORE the variable-length `actions`.
 *
 * Derivation: exec's `data` content begins at 192 (five head words + the length
 * word), +4 for the inner selector = 196 for `recipient`, +32 = 228 for
 * `buyToken`. Re-derive against a live 0x exec if 0x revs the Settler ABI.
 */
const SETTLER_RECIPIENT_OFFSET = 196n
const SETTLER_BUY_TOKEN_OFFSET = 228n

/**
 * 0x's Settler registry — an ERC-721 whose token owner IS the current Settler
 * for that feature slot. Slot 2 is the taker-submitted Settler used by ordinary
 * swaps.
 *
 * 0x redeploys the Settler every few weeks and moves the token, so there is no
 * safe constant to bundle: any address baked into a release is correct only
 * until the next rotation. Resolve with {@link resolveZeroExSettler} and pin the
 * result, or use `anySettler` to trade the pin for longevity.
 */
export const ZEROX_SETTLER_REGISTRY: Address =
  '0x00000000000004533Fe15556B1E086BB1A72cEae'

export const ZEROX_SETTLER_FEATURE_ID = 2n

export const zeroExSettlerRegistryAbi = [
  {
    type: 'function',
    name: 'ownerOf',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const satisfies Abi

/** Minimal structural client — avoids coupling this module to a viem client type. */
interface SettlerRegistryReader {
  readContract(args: {
    address: Address
    abi: typeof zeroExSettlerRegistryAbi
    functionName: 'ownerOf'
    args: readonly [bigint]
  }): Promise<Address>
}

/**
 * Read 0x's current Settler for this chain from the on-chain registry.
 *
 * Pin the result at session-enable time; do NOT re-resolve per swap. A session
 * that looked the address up at use time would follow 0x's registry wherever it
 * points, so a compromise of 0x's upgrade multisig could redirect every live
 * session's approved funds. Pinned, the worst case of a rotation is that the
 * session stops working until it is re-enabled.
 *
 * @param client - Any viem public client for the target chain.
 */
export async function resolveZeroExSettler(
  client: SettlerRegistryReader,
): Promise<Address> {
  return client.readContract({
    address: ZEROX_SETTLER_REGISTRY,
    abi: zeroExSettlerRegistryAbi,
    functionName: 'ownerOf',
    args: [ZEROX_SETTLER_FEATURE_ID],
  })
}

/**
 * Pin 0x's Settler to a specific address.
 *
 * Pinning the inner `buyToken` / `recipient` is not a substitute for pinning
 * `target`: those bytes only mean what their names say when the callee is
 * genuinely a Settler.
 */
export interface ZeroExPinnedOptions {
  /** The Settler to pin. Get the current one with {@link resolveZeroExSettler}. */
  settler: Address
  anySettler?: never
  maxSpend?: never
}

/**
 * Leave 0x's Settler unpinned so the session survives 0x's rotations.
 *
 * A deliberate security downgrade, which is why `maxSpend` is mandatory here:
 * with `target` free, a compromised session key can redirect the AllowanceHolder
 * pull to its own contract, and `maxSpend` is then the ONLY bound on what it
 * takes. The blast radius becomes exactly `maxSpend`, never the account's whole
 * balance.
 *
 * Prefer {@link ZeroExPinnedOptions} unless the session must outlive 0x's
 * upgrade cadence (roughly every few weeks).
 */
export interface ZeroExAnySettlerOptions {
  anySettler: true
  /** Cumulative cap on sell-token spend across every swap in this session. */
  maxSpend: bigint
  settler?: never
}

/**
 * Scope a session to 0x swaps.
 *
 * Takes either a pinned `settler` or `anySettler` + `maxSpend`. There is
 * deliberately no zero-argument form: a bundled Settler constant would be stale
 * within weeks of the release that shipped it.
 */
export function zeroEx(
  options: ZeroExPinnedOptions | ZeroExAnySettlerOptions,
): ZeroExVenue {
  return {
    id: '0x',
    ...(options.settler !== undefined ? { settler: options.settler } : {}),
    ...(options.anySettler ? { anySettler: true } : {}),
    ...(options.maxSpend !== undefined ? { maxSpend: options.maxSpend } : {}),
  }
}

export function scopeZeroEx(
  venue: ZeroExVenue,
  ctx: VenueContext,
): VenueScoping {
  if (venue.anySettler && ctx.cap === undefined) {
    throw new Error(
      'zeroEx({ anySettler: true }) requires maxSpend: with the Settler ' +
        'unpinned it is the only bound on what a compromised session key can pull',
    )
  }
  // Pinned from the scope, never from venue options — the sell token is a
  // scope-level guarantee and must not depend on the caller restating it.
  const rules: UniversalActionPolicyParamRule[] = [
    pin(EXEC.token, ctx.sellToken),
  ]
  if (venue.settler !== undefined) {
    rules.push(pin(EXEC.operator, venue.settler))
    rules.push(pin(EXEC.target, venue.settler))
    rules.push(pin(SETTLER_BUY_TOKEN_OFFSET, ctx.buyToken))
    rules.push(pin(SETTLER_RECIPIENT_OFFSET, ctx.recipient))
  }
  if (ctx.cap !== undefined) {
    rules.push(cumulativeCap(EXEC.amount, ctx.cap))
  }
  return {
    approveSpender: ZEROX_ALLOWANCE_HOLDER,
    action: swapAction(
      ZEROX_ALLOWANCE_HOLDER,
      ALLOWANCE_HOLDER_EXEC_SELECTOR,
      rules,
    ),
  }
}
