import type { Abi, AbiFunction, AbiParameter } from 'abitype'
import { type Address, type Hex, isAddress, toFunctionSelector } from 'viem'
import type {
  ArgPolicyExpression,
  Policy,
  UniversalActionPolicyParamCondition,
} from '../types'

// ---------------------------------------------------------------------------
// Type-level utilities
// ---------------------------------------------------------------------------

type FunctionNames<TAbi extends Abi> = Extract<
  TAbi[number],
  { type: 'function' }
>['name']

type GetFunction<TAbi extends Abi, TName extends string> = Extract<
  TAbi[number],
  { type: 'function'; name: TName }
>

// Map a Solidity static type to the TS value type the developer supplies.
// Dynamic types collapse to `never`: rules on dynamic-length args can't be
// encoded into a fixed calldata offset.
type AbiTypeToValue<T extends string> = T extends 'address'
  ? Address
  : T extends 'bool'
    ? boolean
    : T extends `uint${string}`
      ? bigint
      : T extends `int${string}`
        ? bigint
        : T extends `bytes${infer N}`
          ? N extends ''
            ? never
            : Hex
          : never

type ParamValue<
  TFn extends AbiFunction,
  TParamName extends string,
> = AbiTypeToValue<Extract<TFn['inputs'][number], { name: TParamName }>['type']>

// A constraint on a single named parameter. Two shapes:
//   - { condition, value, usageLimit? } : single comparison (AND-conjunctive)
//   - { anyOf: [v1, v2, ...] }          : OR of EQUAL rules — forces arg-policy
type ParamConstraint<TValue> =
  | {
      condition: UniversalActionPolicyParamCondition
      value: TValue
      usageLimit?: bigint
      anyOf?: never
    }
  | {
      anyOf: readonly [TValue, ...TValue[]]
      condition?: never
      value?: never
      usageLimit?: never
    }

type NamedInputs<TFn extends AbiFunction> = Extract<
  TFn['inputs'][number],
  { name: string }
>

// Compile-time gates for sugar fields that only make sense on certain ABIs.
// We use structural `extends` on `inputs` so any extra fields (`name`,
// `internalType`) on the ABI entries don't prevent the match.
type IsERC20TransferLike<TFn extends AbiFunction> = TFn['inputs'] extends
  | readonly [{ type: 'address' }, { type: 'uint256' }]
  | readonly [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }]
  ? true
  : false

type IsPayable<TFn extends AbiFunction> =
  TFn['stateMutability'] extends 'payable' ? true : false

// `never` on the sugar field rejects any user-supplied value at the call site,
// turning a footgun (e.g. spendingLimit on vault.deposit) into a compile error.
type SpendingLimitField<TFn extends AbiFunction> =
  IsERC20TransferLike<TFn> extends true
    ? { spendingLimit?: { token: Address; amount: bigint } }
    : { spendingLimit?: never }

type ValueLimitField<TFn extends AbiFunction> = IsPayable<TFn> extends true
  ? { valueLimit?: bigint }
  : { valueLimit?: never }

type FunctionConfig<TFn extends AbiFunction> = {
  /** Escape hatch — raw `Policy` objects merged with sugar-emitted policies. */
  policies?: Policy[]
  /** `valueLimitPerUse` embedded in universal/arg-policy `ActionConfig`. */
  valueLimitPerUse?: bigint
  params?: {
    [K in NamedInputs<TFn>['name']]?: ParamConstraint<ParamValue<TFn, K>>
  }
  /**
   * Per-action call cap. Emits a standalone `usage-limit` policy.
   * Note: counters are scoped to this single action, not session-wide.
   * `transfer.maxUses=10` and `approve.maxUses=10` are independent counters.
   */
  maxUses?: bigint
  /**
   * Upper bound on `block.timestamp` (Date or ms-epoch). Pairs with
   * `validAfter` into one `time-frame` policy. If only one of the two is set,
   * the other defaults to "always passes" (validAfter=0 / validUntil=year-2100).
   */
  validUntil?: Date | number
  /** Lower bound on `block.timestamp` (Date or ms-epoch). See `validUntil`. */
  validAfter?: Date | number
} & SpendingLimitField<TFn> &
  ValueLimitField<TFn>

type ContractPermissions<TAbi extends Abi> = {
  abi: TAbi
  address: Address
  functions: {
    [K in FunctionNames<TAbi>]?: FunctionConfig<
      GetFunction<TAbi, K> & AbiFunction
    >
  }
}

// ---------------------------------------------------------------------------
// Runtime helpers
// ---------------------------------------------------------------------------

function isStaticAbiType(type: string): boolean {
  if (type === 'address' || type === 'bool') return true
  if (/^u?int\d*$/.test(type)) return true
  if (/^bytes\d+$/.test(type)) {
    const n = Number.parseInt(type.slice(5), 10)
    return n >= 1 && n <= 32
  }
  return false
}

function toReferenceValue(value: unknown, abiType: string): Hex | bigint {
  if (abiType === 'address') {
    if (typeof value === 'string' && isAddress(value)) return value
    throw new Error(`Expected address value, got: ${typeof value}`)
  }
  if (abiType === 'bool') {
    if (typeof value === 'boolean') return value ? 1n : 0n
    throw new Error(`Expected boolean value, got: ${typeof value}`)
  }
  if (abiType.startsWith('uint') || abiType.startsWith('int')) {
    if (typeof value === 'bigint') return value
    if (typeof value === 'number') return BigInt(value)
    throw new Error(
      `Expected bigint value for ${abiType}, got: ${typeof value}`,
    )
  }
  if (/^bytes\d+$/.test(abiType)) {
    if (typeof value === 'string') return value as Hex
    throw new Error(`Expected hex string for ${abiType}, got: ${typeof value}`)
  }
  throw new Error(`Unsupported ABI type: ${abiType}`)
}

// Right-fold an array of leaves into a right-leaning OR chain:
//   [a, b, c]  →  OR(a, OR(b, c))
// Right-leaning is fine because ArgPolicy evaluates with short-circuit; any
// shape that uses every leaf and respects post-order produces the same result.
function orChain(leaves: readonly ArgPolicyExpression[]): ArgPolicyExpression {
  if (leaves.length === 0) {
    throw new Error('orChain requires at least one leaf')
  }
  let acc = leaves[leaves.length - 1]
  for (let i = leaves.length - 2; i >= 0; i--) {
    acc = { type: 'or', left: leaves[i], right: acc }
  }
  return acc
}

function andChain(leaves: readonly ArgPolicyExpression[]): ArgPolicyExpression {
  if (leaves.length === 0) {
    throw new Error('andChain requires at least one leaf')
  }
  let acc = leaves[leaves.length - 1]
  for (let i = leaves.length - 2; i >= 0; i--) {
    acc = { type: 'and', left: leaves[i], right: acc }
  }
  return acc
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

interface ScopedAction {
  target: Address
  selector: Hex
  policies?: Policy[]
}

interface NormalizedConstraint {
  paramName: string
  calldataOffset: bigint
  abiType: string
  /** undefined → `anyOf` form, otherwise single-condition form */
  condition?: UniversalActionPolicyParamCondition
  value?: unknown
  usageLimit?: bigint
  anyOf?: readonly unknown[]
}

/**
 * Build typed, ABI-aware `ScopedAction[]` for session-key permissions.
 *
 * Param constraint forms (under `params`):
 *   - `{ condition, value, usageLimit? }` — single comparison rule
 *   - `{ anyOf: [v1, v2, ...] }`          — OR of EQUAL rules (allowlist)
 *
 * Sugar fields (compose with `params` and any raw `policies`):
 *   - `maxUses`         → `usage-limit` policy (per-action counter)
 *   - `validUntil` / `validAfter` → `time-frame` policy
 *   - `valueLimit`      → `value-limit` policy (payable functions only)
 *   - `spendingLimit`   → `spending-limits` policy (ERC-20-transfer-shaped functions only)
 *
 * Action policy selection: every-param-single-condition → `universal-action`
 * (cheaper init); any param uses `anyOf` → `arg-policy`. The sugar policies
 * stack independently — smart-sessions AND-composes them on-chain.
 *
 * @example ERC-20 session: allowlist recipients, cap amount + total spend + uses
 * ```ts
 * definePermissions({
 *   abi: erc20Abi,
 *   address: USDC,
 *   functions: {
 *     transfer: {
 *       params: {
 *         recipient: { anyOf: [alice, bob] },
 *         amount:    { condition: 'lessThan', value: 1000n },
 *       },
 *       maxUses: 10n,
 *       validUntil: new Date('2027-01-01'),
 *       spendingLimit: { token: USDC, amount: 5000n },
 *     },
 *   },
 * })
 * ```
 */
function definePermissions<const TAbi extends Abi>(
  input: ContractPermissions<TAbi>,
): ScopedAction[] {
  const { abi, address, functions } = input
  const actions: ScopedAction[] = []

  for (const [fnName, fnConfig] of Object.entries(functions)) {
    if (!fnConfig) continue
    const config = fnConfig as FunctionConfig<AbiFunction>

    const abiEntries = (abi as readonly AbiParameter[]).filter(
      (entry): entry is AbiFunction =>
        (entry as { type: string }).type === 'function' &&
        (entry as { name: string }).name === fnName,
    )
    if (abiEntries.length === 0) {
      throw new Error(`Function "${fnName}" not found in the provided ABI.`)
    }
    if (abiEntries.length > 1) {
      throw new Error(
        `Function "${fnName}" is overloaded (${abiEntries.length} variants). ` +
          'definePermissions does not support overloaded functions. ' +
          'Use the raw Action API with manual selector and calldataOffset instead.',
      )
    }

    const abiEntry = abiEntries[0]
    const selector = toFunctionSelector(abiEntry)

    const policies: Policy[] = config.policies ? [...config.policies] : []

    // --- Sugar field expansion -----------------------------------------------
    // Each top-level field maps 1:1 to a known policy. Smart-sessions
    // AND-composes every action policy on-chain, so duplicates (e.g. raw
    // `policies: [{ type: 'usage-limit', ... }]` + sugar `maxUses`) are
    // accepted but redundant; we don't dedupe.

    if (config.maxUses !== undefined) {
      policies.push({ type: 'usage-limit', limit: config.maxUses })
    }

    if (config.validUntil !== undefined || config.validAfter !== undefined) {
      const toMs = (v: Date | number): number =>
        v instanceof Date ? v.getTime() : v
      // Defaults: validAfter=0 → "always after epoch"; validUntil far-future
      // → "always before". Year 2100 in ms is well within uint128 after the
      // ms→s conversion the encoder applies.
      const FAR_FUTURE_MS = 4_102_444_800_000 // 2100-01-01
      const validUntil =
        config.validUntil !== undefined
          ? toMs(config.validUntil)
          : FAR_FUTURE_MS
      const validAfter =
        config.validAfter !== undefined ? toMs(config.validAfter) : 0
      if (validUntil < validAfter) {
        throw new Error(
          `Function "${fnName}": validUntil (${validUntil}) is before validAfter (${validAfter}).`,
        )
      }
      policies.push({ type: 'time-frame', validUntil, validAfter })
    }

    if (config.valueLimit !== undefined) {
      // Runtime backstop: payable-gating is enforced at the type level, but
      // users can bypass with `as` casts. ValueLimitPolicy on a non-payable
      // function is harmless (msg.value is always 0, the cap always passes)
      // but it leaks intent — we'd rather throw than encode dead weight.
      if (abiEntry.stateMutability !== 'payable') {
        throw new Error(
          `Function "${fnName}" is not payable — \`valueLimit\` only constrains native ETH ` +
            'attached to the call, which is always zero for non-payable functions. ' +
            'Remove `valueLimit`, or use the raw `policies` field if this is intentional.',
        )
      }
      policies.push({ type: 'value-limit', limit: config.valueLimit })
    }

    if (config.spendingLimit !== undefined) {
      // Runtime backstop: ERC20SpendingLimitPolicy decodes the amount from a
      // fixed offset that only makes sense for transfer(address,uint256),
      // transferFrom(address,address,uint256), or approve(address,uint256).
      // Attaching it to anything else reads garbage and is silently wrong.
      const inputTypes = abiEntry.inputs.map((i) => i.type).join(',')
      const ERC20_SHAPES = new Set([
        'address,uint256',
        'address,address,uint256',
      ])
      if (!ERC20_SHAPES.has(inputTypes)) {
        throw new Error(
          `Function "${fnName}" has signature (${inputTypes}); \`spendingLimit\` only ` +
            'works on ERC-20 transfer-shaped functions: (address,uint256) or ' +
            '(address,address,uint256). The policy decodes the amount from a fixed ' +
            'calldata offset and would read garbage on other shapes.',
        )
      }
      policies.push({
        type: 'spending-limits',
        limits: [config.spendingLimit],
      })
    }
    // --- End sugar field expansion -------------------------------------------
    const rawParams = (config.params ?? {}) as Record<
      string,
      ParamConstraint<unknown> | undefined
    >
    const paramEntries = Object.entries(rawParams).filter(
      ([, v]) => v !== undefined,
    ) as [string, ParamConstraint<unknown>][]

    if (paramEntries.length > 0) {
      const normalized = paramEntries.map<NormalizedConstraint>(
        ([paramName, rule]) => {
          const paramIndex = abiEntry.inputs.findIndex(
            (p) => p.name === paramName,
          )
          if (paramIndex === -1) {
            throw new Error(
              `Parameter "${paramName}" not found in function "${fnName}". ` +
                `Available: ${abiEntry.inputs.map((i) => i.name).join(', ')}`,
            )
          }
          const param = abiEntry.inputs[paramIndex]
          if (!isStaticAbiType(param.type)) {
            throw new Error(
              `Parameter "${paramName}" has dynamic type "${param.type}". ` +
                'definePermissions only supports rules on static types ' +
                '(address, bool, uint*, int*, bytes1–bytes32). ' +
                'Use the raw Action API with manual calldataOffset for dynamic types.',
            )
          }
          const calldataOffset = BigInt(paramIndex) * 32n

          if ('anyOf' in rule && rule.anyOf !== undefined) {
            if (rule.anyOf.length === 0) {
              throw new Error(
                `Parameter "${paramName}" has empty anyOf — provide at least one value.`,
              )
            }
            return {
              paramName,
              calldataOffset,
              abiType: param.type,
              anyOf: rule.anyOf,
            }
          }

          return {
            paramName,
            calldataOffset,
            abiType: param.type,
            condition: rule.condition,
            value: rule.value,
            usageLimit: rule.usageLimit,
          }
        },
      )

      const usesArgPolicy = normalized.some((n) => n.anyOf !== undefined)

      if (usesArgPolicy) {
        // Build one sub-expression per param, then AND them all together.
        const perParam: ArgPolicyExpression[] = normalized.map((n) => {
          if (n.anyOf !== undefined) {
            const leaves: ArgPolicyExpression[] = n.anyOf.map((v) => ({
              type: 'rule',
              rule: {
                condition: 'equal',
                calldataOffset: n.calldataOffset,
                referenceValue: toReferenceValue(v, n.abiType),
              },
            }))
            return orChain(leaves)
          }
          return {
            type: 'rule',
            rule: {
              condition: n.condition as UniversalActionPolicyParamCondition,
              calldataOffset: n.calldataOffset,
              referenceValue: toReferenceValue(n.value, n.abiType),
              ...(n.usageLimit !== undefined
                ? { usageLimit: n.usageLimit }
                : {}),
            },
          }
        })

        policies.push({
          type: 'arg-policy',
          valueLimitPerUse: config.valueLimitPerUse ?? 0n,
          expression: perParam.length === 1 ? perParam[0] : andChain(perParam),
        })
      } else {
        // Flat AND-of-rules — cheaper to init via UniActionPolicy.
        const rules = normalized.map((n) => ({
          condition: n.condition as UniversalActionPolicyParamCondition,
          calldataOffset: n.calldataOffset,
          referenceValue: toReferenceValue(n.value, n.abiType),
          ...(n.usageLimit !== undefined ? { usageLimit: n.usageLimit } : {}),
        }))
        policies.push({
          type: 'universal-action',
          valueLimitPerUse: config.valueLimitPerUse ?? 0n,
          rules: rules as [(typeof rules)[number], ...(typeof rules)[number][]],
        })
      }
    } else if (config.valueLimitPerUse !== undefined) {
      policies.push({
        type: 'value-limit',
        limit: config.valueLimitPerUse,
      })
    }

    actions.push({
      target: address,
      selector,
      ...(policies.length > 0 ? { policies } : {}),
    })
  }

  return actions
}

export { definePermissions }
export type { ContractPermissions, ParamConstraint }
