import { type Abi, type Address, type Hex, toFunctionSelector } from 'viem'
import type {
  Permission,
  ScopedAction,
  SessionPolicy,
  UniversalActionPolicyParamRule,
} from './types'

// RHI-6286 (POC): scope a smart session to a specific swap aggregator so a
// session key can only approve the sell token and route a swap through that
// aggregator — nothing else. Pairs with `restrictToActions` on the session
// (which drops the wildcard fallback) so these are the ONLY authorized ops.
//
// 0x (Swap API v2, AllowanceHolder flow). The account performs two calls:
//   1. approve(AllowanceHolder, amount) on the sell token
//   2. AllowanceHolder.exec(operator, token, amount, target, data) — pulls the
//      approved sell token and forwards `data` to the 0x Settler (`target`).
// exec's static words are pinnable: operator(0), token(1), amount(2), target(3).
// operator and target are pinned to the Settler so the pulled sell token can only
// be consumed by 0x's swap.
//
// Both src and dest tokens sit in the swap calldata as word-aligned ABI words, so
// the plain UniversalActionPolicy pins BOTH via `AggregatorSwap.swapRules` — no
// custom policy needed. Observed on the two Plasma aggregators:
//   - Tycho (fynd) router `swap` (selector 0xce25e49e): tokenIn @ offset 32,
//     tokenOut @ offset 64 (see TYCHO_TOKEN_IN_OFFSET / TYCHO_TOKEN_OUT_OFFSET).
//   - 0x AllowanceHolder.exec: sell token is exec.token(1); the buy token lives
//     inside exec.data, which is itself ABI-encoded, so it is word-aligned there
//     too and pins at a quote-derived offset.
// Offsets are function/route-specific — pin the selector too, and re-derive from a
// sample when the aggregator returns a different route shape.

// 0x AllowanceHolder on Cancun-hardfork chains (incl. Plasma). Verify per chain.
export const ZEROX_ALLOWANCE_HOLDER: Address =
  '0x0000000000001fF3684f28c67538d4D072C22734'

export const erc20ApproveAbi = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const satisfies Abi

export const allowanceHolderExecAbi = [
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
    outputs: [{ name: '', type: 'bytes' }],
  },
] as const satisfies Abi

export const ALLOWANCE_HOLDER_EXEC_SELECTOR = toFunctionSelector(
  'function exec(address,address,uint256,address,bytes)',
)

export interface ZeroExSwapScope {
  // The token the session may sell (e.g. USDC on Plasma).
  readonly sellToken: Address
  // The 0x Settler the AllowanceHolder forwards to. Pinned on BOTH exec.operator
  // and exec.target. Required: leaving them unpinned lets a session key set
  // operator/target to its own contract and pull the approved sell token (up to
  // the cap) instead of swapping through 0x. 0x rotates Settler versions, so this
  // binds the session to the current one — re-issue the session on a rotation.
  readonly settler: Address
  // Cumulative cap on TOTAL sell-token spend across the session (a spending-limit
  // on the approve sums approved amounts). Omit for no cap.
  readonly maxSellAmount?: bigint
  // Defaults to ZEROX_ALLOWANCE_HOLDER.
  readonly allowanceHolder?: Address
}

// The complete action set authorizing a 0x AllowanceHolder swap: the sell-token
// approval (spender pinned to AllowanceHolder) and the exec call (token + amount
// + forward-target pinned). Install via `permissions` with `restrictToActions`.
export function zeroExSwapActions(scope: ZeroExSwapScope): Permission[] {
  const allowanceHolder = scope.allowanceHolder ?? ZEROX_ALLOWANCE_HOLDER
  const approve = {
    abi: erc20ApproveAbi as unknown as Abi,
    address: scope.sellToken,
    functions: {
      approve: {
        // Cumulative cap: the spending-limit policy sums approved amounts across
        // the session, so maxSellAmount bounds TOTAL sell-token spend, not just a
        // single swap (which repeated swaps could otherwise drain past).
        ...(scope.maxSellAmount !== undefined
          ? {
              spendingLimit: {
                token: scope.sellToken,
                amount: scope.maxSellAmount,
              },
            }
          : {}),
        params: {
          spender: { condition: 'equal', value: allowanceHolder },
        },
      },
    },
  } as Permission
  const swap = {
    abi: allowanceHolderExecAbi as unknown as Abi,
    address: allowanceHolder,
    functions: {
      exec: {
        // exec is payable — cap native value so the session can't route value
        // through the router (the sell-token cap only bounds the ERC-20 pull).
        valueLimit: 0n,
        params: {
          // Pin both the permit consumer (operator) and the call target to the
          // Settler so the pulled sell token can only be spent by 0x's swap.
          operator: { condition: 'equal', value: scope.settler },
          token: { condition: 'equal', value: scope.sellToken },
          ...(scope.maxSellAmount !== undefined
            ? {
                amount: {
                  condition: 'lessThan',
                  value: scope.maxSellAmount + 1n,
                },
              }
            : {}),
          target: { condition: 'equal', value: scope.settler },
        },
      },
    },
  } as Permission
  return [approve, swap]
}

// --- Multi-aggregator scoping (scope BOTH 0x and fynd in one session) ---------

export interface AggregatorSwap {
  // The swap entrypoint the account calls, and the one selector allowed on it.
  readonly swapTarget: Address
  readonly swapSelector: Hex
  // The approve spender for this aggregator's token pull. 0x pulls via the
  // AllowanceHolder; fynd's TychoRouter pulls via an allowance to itself. Defaults
  // to swapTarget.
  readonly approveSpender?: Address
  // Optional arg pins on the swap calldata (raw calldata offsets). Omit to bind
  // the swap by target+selector only. Use this to pin the BUY token and/or
  // recipient where the aggregator exposes them at a fixed offset (e.g. kyberswap
  // encodes the output token as an ABI word), binding "receive token Y", not just
  // "spend token X". The offset is aggregator- and route-shape-specific — derive
  // it from a sample of that aggregator's calldata for the pair.
  readonly swapRules?: UniversalActionPolicyParamRule[]
  // Max native value the swap may carry. Defaults to 0 — the approve cap only
  // bounds ERC-20 pulls, so without this a payable swap selector could still send
  // arbitrary native value through the router. Raise it only for native-in swaps.
  readonly maxValue?: bigint
  // Byte offset of the swap's own sell amount in its calldata. When set,
  // swapSessionActions caps it at the scope's maxSellAmount so the per-swap pull
  // is bounded even against a standing allowance (0x exec.amount@64, Tycho@0).
  readonly sellAmountOffset?: bigint
}

export interface SwapSessionScope {
  readonly sellToken: Address
  // Cumulative cap on TOTAL sell-token spend across the session (spending-limit
  // on the merged approve). Omit for no cap.
  readonly maxSellAmount?: bigint
  readonly aggregators: [AggregatorSwap, ...AggregatorSwap[]]
}

export interface SwapSessionActions {
  // The single merged approve (spender allowlist across all aggregators + cap).
  readonly permissions: Permission[]
  // One scoped swap action per aggregator.
  readonly actions: ScopedAction[]
}

// exec(operator, token, amount, target, data). exec's own words pin operator@0,
// sellToken@32, amount@64, target@96. The BUY side lives in `data` = the Settler's
// `execute((recipient, buyToken, minAmountOut) slippage, bytes[] actions, bytes32)`
// — the slippage fields sit BEFORE the variable `actions`, so their exec-calldata
// offsets are stable: recipient@196, buyToken@228 (data content @192, +4 inner
// selector, +32 recipient). Verify against a live 0x exec if 0x revs the Settler.
export const ZEROX_RECIPIENT_OFFSET = 196n
export const ZEROX_BUY_TOKEN_OFFSET = 228n

// 0x AllowanceHolder as an aggregator. Pins the sell side (token/operator/target/
// cap) and, when given, the BUY token + recipient inside the Settler `data`.
export function zeroExAggregator(scope: {
  sellToken: Address
  // Required — see ZeroExSwapScope.settler for why leaving it unpinned is unsafe.
  settler: Address
  maxSellAmount?: bigint
  buyToken?: Address
  // Bind the swap output recipient (e.g. the account) so 0x can't send it elsewhere.
  recipient?: Address
  allowanceHolder?: Address
}): AggregatorSwap {
  const allowanceHolder = scope.allowanceHolder ?? ZEROX_ALLOWANCE_HOLDER
  const swapRules: UniversalActionPolicyParamRule[] = [
    { condition: 'equal', calldataOffset: 0n, referenceValue: scope.settler }, // operator
    {
      condition: 'equal',
      calldataOffset: 32n,
      referenceValue: scope.sellToken,
    },
    { condition: 'equal', calldataOffset: 96n, referenceValue: scope.settler }, // target
  ]
  if (scope.maxSellAmount !== undefined) {
    swapRules.push({
      condition: 'lessThan',
      calldataOffset: 64n,
      referenceValue: scope.maxSellAmount + 1n,
    })
  }
  if (scope.buyToken !== undefined) {
    swapRules.push({
      condition: 'equal',
      calldataOffset: ZEROX_BUY_TOKEN_OFFSET,
      referenceValue: scope.buyToken,
    })
  }
  if (scope.recipient !== undefined) {
    swapRules.push({
      condition: 'equal',
      calldataOffset: ZEROX_RECIPIENT_OFFSET,
      referenceValue: scope.recipient,
    })
  }
  return {
    swapTarget: allowanceHolder,
    swapSelector: ALLOWANCE_HOLDER_EXEC_SELECTOR,
    approveSpender: allowanceHolder,
    swapRules,
    sellAmountOffset: 64n,
  }
}

// Tycho `swap` (selector 0xce25e49e) layout — verified against live fynd calldata:
// amountIn@0, tokenIn@32, tokenOut@64, minAmountOut@96, receiver@128. Offsets are
// past the 4-byte selector; re-derive if fynd returns a different swap function.
export const TYCHO_SWAP_SELECTOR: Hex = '0xce25e49e'
export const TYCHO_AMOUNT_IN_OFFSET = 0n
export const TYCHO_TOKEN_IN_OFFSET = 32n
export const TYCHO_TOKEN_OUT_OFFSET = 64n
export const TYCHO_RECIPIENT_OFFSET = 128n

// fynd (Tycho router) as an aggregator. Pins the sell + buy token, caps the swap's
// own amountIn (so a standing allowance can't be used to pull more than the cap),
// and binds the receiver. The TychoRouter pulls via an allowance to itself, so
// approveSpender defaults to the router.
export function fyndAggregator(scope: {
  router: Address
  // Defaults to the Tycho `swap` selector; override for a different route shape.
  swapSelector?: Hex
  sellToken?: Address
  buyToken?: Address
  // Upper bound on the swap's amountIn (caps the per-swap pull independent of the
  // approve, closing a standing-allowance bypass).
  maxSellAmount?: bigint
  // Bind the swap receiver (e.g. the account) so the output can't be sent elsewhere.
  recipient?: Address
  // Override offsets for a non-default Tycho swap function.
  tokenInOffset?: bigint
  tokenOutOffset?: bigint
}): AggregatorSwap {
  const swapRules: UniversalActionPolicyParamRule[] = []
  if (scope.maxSellAmount !== undefined) {
    swapRules.push({
      condition: 'lessThan',
      calldataOffset: TYCHO_AMOUNT_IN_OFFSET,
      referenceValue: scope.maxSellAmount + 1n,
    })
  }
  if (scope.sellToken !== undefined) {
    swapRules.push({
      condition: 'equal',
      calldataOffset: scope.tokenInOffset ?? TYCHO_TOKEN_IN_OFFSET,
      referenceValue: scope.sellToken,
    })
  }
  if (scope.buyToken !== undefined) {
    swapRules.push({
      condition: 'equal',
      calldataOffset: scope.tokenOutOffset ?? TYCHO_TOKEN_OUT_OFFSET,
      referenceValue: scope.buyToken,
    })
  }
  if (scope.recipient !== undefined) {
    swapRules.push({
      condition: 'equal',
      calldataOffset: TYCHO_RECIPIENT_OFFSET,
      referenceValue: scope.recipient,
    })
  }
  return {
    swapTarget: scope.router,
    swapSelector: scope.swapSelector ?? TYCHO_SWAP_SELECTOR,
    ...(swapRules.length ? { swapRules } : {}),
    sellAmountOffset: TYCHO_AMOUNT_IN_OFFSET,
  }
}

// Builds one merged approve (sell token, spender ∈ every aggregator's spender,
// amount ≤ cap) plus one scoped swap action per aggregator. Install the approve
// via `permissions` and the swaps via `actions`, with `restrictToActions: true`,
// so the session key can ONLY approve the sell token to a listed aggregator and
// call that aggregator's swap — nothing else (RHI-6286).
export function swapSessionActions(
  scope: SwapSessionScope,
): SwapSessionActions {
  const spenders = [
    ...new Set(
      scope.aggregators.map((a) =>
        (a.approveSpender ?? a.swapTarget).toLowerCase(),
      ),
    ),
  ].map((s) => s as Address)
  const approve = {
    abi: erc20ApproveAbi as unknown as Abi,
    address: scope.sellToken,
    functions: {
      approve: {
        // Cumulative session cap across all aggregators (see zeroExSwapActions).
        ...(scope.maxSellAmount !== undefined
          ? {
              spendingLimit: {
                token: scope.sellToken,
                amount: scope.maxSellAmount,
              },
            }
          : {}),
        params: {
          spender:
            spenders.length === 1
              ? { condition: 'equal', value: spenders[0] }
              : { anyOf: spenders },
        },
      },
    },
  } as Permission
  const actions: ScopedAction[] = scope.aggregators.map((a) => {
    const maxValue = a.maxValue ?? 0n
    // Cap the swap's OWN sell amount at the session cap (independent of the
    // approve), so a standing allowance can't be used to pull more than maxSellAmount.
    const rules = [...(a.swapRules ?? [])]
    if (
      scope.maxSellAmount !== undefined &&
      a.sellAmountOffset !== undefined &&
      !rules.some((r) => r.calldataOffset === a.sellAmountOffset)
    ) {
      rules.push({
        condition: 'lessThan',
        calldataOffset: a.sellAmountOffset,
        referenceValue: scope.maxSellAmount + 1n,
      })
    }
    const policies: SessionPolicy[] = rules.length
      ? [
          {
            type: 'universal-action',
            valueLimitPerUse: maxValue,
            rules: rules as [
              UniversalActionPolicyParamRule,
              ...UniversalActionPolicyParamRule[],
            ],
          },
        ]
      : // No arg pins: bind (target, selector) and cap native value (a plain sudo
        // would let the swap carry arbitrary value through the router).
        [{ type: 'value-limit', limit: maxValue }]
    return { target: a.swapTarget, selector: a.swapSelector, policies }
  })
  return { permissions: [approve], actions }
}
