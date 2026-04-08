import type { Abi, AbiFunction, AbiParameter } from 'abitype'
import { type Address, type Hex, isAddress, toFunctionSelector } from 'viem'
import type { Policy, UniversalActionPolicyParamCondition } from '../types'

// ---------------------------------------------------------------------------
// Type-level utilities
// ---------------------------------------------------------------------------

/** Extract all `function` names from an ABI. */
type FunctionNames<TAbi extends Abi> = Extract<
  TAbi[number],
  { type: 'function' }
>['name']

/** Pull the AbiFunction entry for a given name (union if overloaded). */
type GetFunction<TAbi extends Abi, TName extends string> = Extract<
  TAbi[number],
  { type: 'function'; name: TName }
>

/** Map a Solidity type string to the TypeScript type a developer provides as
 *  `value` in a param constraint. Dynamic types resolve to `never` so the
 *  compiler prevents rules on params the on-chain policy cannot compare. */
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
            ? never // bare `bytes` is dynamic
            : Hex
          : never // arrays, tuples, string, etc.

/** Resolve the TS value type for a named parameter of a function. */
type ParamValue<
  TFn extends AbiFunction,
  TParamName extends string,
> = AbiTypeToValue<Extract<TFn['inputs'][number], { name: TParamName }>['type']>

/** A single parameter constraint – autocomplete-friendly. */
interface ParamConstraint<TValue> {
  condition: UniversalActionPolicyParamCondition
  value: TValue
  usageLimit?: bigint
}

/** Only named inputs (excludes unnamed ABI params). */
type NamedInputs<TFn extends AbiFunction> = Extract<
  TFn['inputs'][number],
  { name: string }
>

/** Per-function configuration inside `definePermissions`. */
type FunctionConfig<TFn extends AbiFunction> = {
  policies?: Policy[]
  valueLimitPerUse?: bigint
  params?: {
    [K in NamedInputs<TFn>['name']]?: ParamConstraint<ParamValue<TFn, K>>
  }
}

/** Top-level input to `definePermissions`. */
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

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

interface ScopedAction {
  target: Address
  selector: Hex
  policies?: Policy[]
}

/**
 * Build typed, ABI-aware `ScopedAction[]` for session-key permissions.
 *
 * Accepts a contract ABI (as `const`), an address, and a map of function
 * names to permission configs. Returns actions that can be spread directly
 * into `Session.actions`.
 *
 * @example
 * ```ts
 * import { erc20Abi } from 'viem'
 *
 * const actions = definePermissions({
 *   abi: erc20Abi,
 *   address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
 *   functions: {
 *     transfer: {
 *       policies: [{ type: 'usage-limit', limit: 10n }],
 *       params: {
 *         to: { condition: 'equal', value: '0x...' },
 *         value: { condition: 'lessThan', value: 1000n },
 *       },
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
    const config = fnConfig as {
      policies?: Policy[]
      valueLimitPerUse?: bigint
      params?: Record<
        string,
        { condition: string; value: unknown; usageLimit?: bigint }
      >
    }

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
    const params = config.params ?? {}
    const paramEntries = Object.entries(params).filter(
      ([, v]) => v !== undefined,
    )

    if (paramEntries.length > 0) {
      const rules = paramEntries.map(([paramName, rule]) => {
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
        const referenceValue = toReferenceValue(rule.value, param.type)

        return {
          condition: rule.condition as UniversalActionPolicyParamCondition,
          calldataOffset,
          referenceValue,
          ...(rule.usageLimit !== undefined
            ? { usageLimit: rule.usageLimit }
            : {}),
        }
      })

      policies.push({
        type: 'universal-action' as const,
        valueLimitPerUse: config.valueLimitPerUse ?? 0n,
        rules: rules as [(typeof rules)[number], ...(typeof rules)[number][]],
      })
    } else if (config.valueLimitPerUse !== undefined) {
      policies.push({
        type: 'value-limit' as const,
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
