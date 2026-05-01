import {
  type AbiFunction,
  type AbiParameter,
  type Hex,
  isAddress,
  isHex,
  size,
  toFunctionSelector,
} from 'viem'
import type {
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
      return value as Hex
    }
    throw new Error(`Expected ${expectedSize}-byte hex string for ${abiType}`)
  }
  throw new Error(`Unsupported ABI type: ${abiType}`)
}

function resolvePermission(permission: Permission): ScopedAction[] {
  const { abi, address, functions } = permission
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
          'Permission entries do not support overloaded functions. ' +
          'Pre-filter the ABI to a single overload before passing it.',
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
              'Permission rules only support static types ' +
              '(address, bool, uint*, int*, bytes1–bytes32).',
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

function resolvePermissions(permissions: Permission[]): ScopedAction[] {
  return permissions.flatMap(resolvePermission)
}

export { resolvePermissions, resolvePermission }
