import {
  type AbiFunction,
  type AbiParameter,
  type Hex,
  isAddress,
  isHex,
  padHex,
  size,
  toFunctionSelector,
} from 'viem'
import type {
  ArgPolicyExpression,
  Permission,
  Policy,
  ScopedAction,
  UniversalActionPolicyParamCondition,
} from '../../types'

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
    const expectedSize = Number.parseInt(abiType.slice(5), 10)
    if (
      typeof value === 'string' &&
      isHex(value) &&
      size(value) === expectedSize
    ) {
      // Solidity calldata encodes bytesN (N<32) left-aligned + right-padded
      // inside its 32-byte word, whereas address/uint*/bool are right-aligned
      // + left-padded. Downstream `encodeActionParamRule` unconditionally
      // left-pads with `padHex`, which is correct for the right-aligned types
      // but wrong for bytesN. Pre-encode here to the full 32-byte hex with
      // the correct alignment so the policy's bytes32 == bytes32 comparison
      // matches what's actually in calldata.
      return padHex(value as Hex, { size: 32, dir: 'right' })
    }
    throw new Error(`Expected ${expectedSize}-byte hex string for ${abiType}`)
  }
  throw new Error(`Unsupported ABI type: ${abiType}`)
}

// Right-fold an array of leaves into a right-leaning OR chain:
//   [a, b, c]  →  OR(a, OR(b, c))
// Right-leaning is fine because ArgPolicy evaluates with short-circuit; any
// shape that uses every leaf and respects post-order produces the same result.
function orChain(leaves: readonly ArgPolicyExpression[]): ArgPolicyExpression {
  let acc = leaves[leaves.length - 1]
  for (let i = leaves.length - 2; i >= 0; i--) {
    acc = { type: 'or', left: leaves[i], right: acc }
  }
  return acc
}

function andChain(leaves: readonly ArgPolicyExpression[]): ArgPolicyExpression {
  let acc = leaves[leaves.length - 1]
  for (let i = leaves.length - 2; i >= 0; i--) {
    acc = { type: 'and', left: leaves[i], right: acc }
  }
  return acc
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

type RawParamConstraint = {
  condition?: UniversalActionPolicyParamCondition
  value?: unknown
  usageLimit?: bigint
  anyOf?: readonly unknown[]
}

type RawFunctionConfig = {
  valueLimitPerUse?: bigint
  params?: Record<string, RawParamConstraint | undefined>
  maxUses?: bigint
  validUntil?: Date
  validAfter?: Date
  valueLimit?: bigint
  spendingLimit?: { token: `0x${string}`; amount: bigint }
}

// On-chain ERC20SpendingLimitPolicy._isTokenTransferOrApprove matches by
// 4-byte selector, accepting only these four. Selector-gating here keeps the
// SDK's accepted set congruent with the contract's — a same-shaped function
// like `mint(address,uint256)` would otherwise pass argument-type checks and
// fail every call on-chain.
const ERC20_SPENDING_LIMIT_SELECTORS = new Set<Hex>([
  '0x095ea7b3', // approve(address,uint256)
  '0x39509351', // increaseAllowance(address,uint256)
  '0xa9059cbb', // transfer(address,uint256)
  '0x23b872dd', // transferFrom(address,address,uint256)
])

// Year 2100 in ms — well within uint128 after the encoder's ms→s conversion.
// Used as the one-sided default for `validUntil` when only `validAfter` is set.
// Exported so the cross-chain permit expansion (smart-sessions.ts) applies the
// same always-passing upper bound instead of defaulting to 0 (already expired).
export const FAR_FUTURE_MS = 4_102_444_800_000

function resolvePermission(permission: Permission): ScopedAction[] {
  const { abi, address, functions } = permission
  const actions: ScopedAction[] = []

  for (const [fnName, fnConfig] of Object.entries(functions)) {
    if (!fnConfig) continue
    const config = fnConfig as RawFunctionConfig

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
          'Permission entries do not support overloaded functions. ' +
          'Pre-filter the ABI to a single overload before passing it.',
      )
    }

    const abiEntry = abiEntries[0]
    const selector = toFunctionSelector(abiEntry)

    if (Object.hasOwn(config, 'policies')) {
      throw new Error(
        `Function "${fnName}": \`policies\` was removed from permission configs. ` +
          'Use params, maxUses, validUntil/validAfter, valueLimit, or spendingLimit instead.',
      )
    }

    const policies: Policy[] = []

    // --- Sugar field expansion -----------------------------------------------

    if (config.maxUses !== undefined) {
      policies.push({ type: 'usage-limit', limit: config.maxUses })
    }

    if (config.validUntil !== undefined || config.validAfter !== undefined) {
      const validUntil =
        config.validUntil !== undefined
          ? config.validUntil.getTime()
          : FAR_FUTURE_MS
      const validAfter =
        config.validAfter !== undefined ? config.validAfter.getTime() : 0
      if (validUntil < validAfter) {
        throw new Error(
          `Function "${fnName}": validUntil (${validUntil}) is before validAfter (${validAfter}).`,
        )
      }
      policies.push({ type: 'time-frame', validUntil, validAfter })
    }

    if (config.valueLimit !== undefined) {
      // Runtime backstop: payable-gating is enforced at the type level, but
      // users can bypass with `as` casts. valueLimit on a non-payable function
      // is harmless on-chain (msg.value is always 0, the cap always passes)
      // but it leaks intent — throw rather than encode dead weight.
      if (abiEntry.stateMutability !== 'payable') {
        throw new Error(
          `Function "${fnName}" is not payable — \`valueLimit\` only constrains native ETH ` +
            'attached to the call, which is always zero for non-payable functions. ' +
            'Remove `valueLimit`.',
        )
      }
      policies.push({ type: 'value-limit', limit: config.valueLimit })
    }

    if (config.spendingLimit !== undefined) {
      // Runtime backstop: type-level gate restricts shape, but ERC20SpendingLimitPolicy
      // dispatches by selector on-chain — a same-shaped function like
      // mint(address,uint256) would encode successfully and fail every call.
      if (!ERC20_SPENDING_LIMIT_SELECTORS.has(selector)) {
        throw new Error(
          `Function "${fnName}" (selector ${selector}) is not an ERC-20 transfer/approve ` +
            'selector; `spendingLimit` only works on approve, increaseAllowance, ' +
            'transfer, or transferFrom. The on-chain policy dispatches by selector ' +
            'and would fail every call for other functions.',
        )
      }
      policies.push({
        type: 'spending-limits',
        limits: [config.spendingLimit],
      })
    }
    // --- End sugar field expansion -------------------------------------------

    const rawParams = config.params ?? {}
    const paramEntries = Object.entries(rawParams).filter(
      ([, v]) => v !== undefined,
    ) as [string, RawParamConstraint][]

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
                'Permission rules only support static types ' +
                '(address, bool, uint*, int*, bytes1–bytes32).',
            )
          }

          const calldataOffset = BigInt(paramIndex) * 32n

          if (rule.anyOf !== undefined) {
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

      // UniActionPolicy/ArgPolicy reject `msg.value > valueLimitPerUse`, so a
      // default of 0 would block any non-zero msg.value before the standalone
      // value-limit policy (sugar) could allow it. Inherit the sugar's cap so
      // the per-use gate matches user intent; value-limit still enforces the
      // cumulative cap on top.
      const embeddedValueLimit =
        config.valueLimitPerUse ?? config.valueLimit ?? 0n

      if (usesArgPolicy) {
        // One sub-expression per param, then AND across params.
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
            return leaves.length === 1 ? leaves[0] : orChain(leaves)
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
          valueLimitPerUse: embeddedValueLimit,
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
          type: 'universal-action' as const,
          valueLimitPerUse: embeddedValueLimit,
          rules: rules as [(typeof rules)[number], ...(typeof rules)[number][]],
        })
      }
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

function resolvePermissions(
  permissions: readonly Permission[],
): ScopedAction[] {
  return permissions.flatMap(resolvePermission)
}

export { resolvePermissions, resolvePermission }
