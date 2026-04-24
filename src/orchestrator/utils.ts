import { fromCaip2, isCaip2, toCaip2 } from './caip2'
import type { OrchestratorApiVersion } from './consts'

const CHAIN_ID_SCALAR_FIELDS = new Set([
  'chainId',
  'sourceChainId',
  'destinationChainId',
])
const CHAIN_ID_ARRAY_FIELDS = new Set(['chainIds', 'allChainIds'])
const CHAIN_ID_MAP_FIELDS = new Set([
  'accountContext',
  'auxiliaryFunds',
  'chainTokens',
  'delegations',
  'gasPrices',
  'mockSignatures',
  'opGasParams',
  'preClaimExecutions',
  'requiredDelegations',
  'tokenRequirements',
  'tokensSpent',
])

/**
 * Stringifies bigint values so request payloads remain JSON-serializable.
 */
function convertBigIntFields(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj
  }

  if (typeof obj === 'bigint') {
    return obj.toString()
  }

  if (Array.isArray(obj)) {
    return obj.map(convertBigIntFields)
  }

  if (typeof obj === 'object') {
    const result: any = {}
    for (const key in obj) {
      if (Object.hasOwn(obj, key)) {
        result[key] = convertBigIntFields(obj[key])
      }
    }
    return result
  }

  return obj
}

/**
 * Applies the BLANC CAIP-2 transform only at the HTTP boundary so SDK types stay stable.
 */
function encodeChainIdsForWire<T>(
  value: T,
  apiVersion: OrchestratorApiVersion,
): T {
  if (apiVersion !== 'blanc') {
    return value
  }

  return transformChainIds(value, encodeChainIdValue, encodeChainIdMapKey) as T
}

/**
 * Converts BLANC responses back into the SDK's legacy decimal chain-id shape.
 */
function decodeChainIdsFromWire<T>(
  value: T,
  apiVersion: OrchestratorApiVersion,
): T {
  if (apiVersion !== 'blanc') {
    return value
  }

  return transformChainIds(value, decodeChainIdValue, decodeChainIdMapKey) as T
}

/**
 * `/chains` is a root-level chain-keyed map instead of a nested field, so it needs a dedicated decoder.
 */
function decodeChainIdRootMapFromWire<T>(
  value: T,
  apiVersion: OrchestratorApiVersion,
): T {
  if (apiVersion !== 'blanc' || !isPlainObject(value)) {
    return value
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      decodeChainIdMapKey(key),
      decodeChainIdsFromWire(nestedValue, apiVersion),
    ]),
  ) as T
}

/**
 * Normalizes either numeric or decimal-string chain ids into BLANC CAIP-2.
 */
function encodeChainIdValue(value: unknown): unknown {
  if (typeof value === 'number') {
    return toCaip2(value)
  }

  if (typeof value === 'string') {
    if (isCaip2(value)) {
      return value
    }
    if (/^\d+$/.test(value)) {
      return toCaip2(Number(value))
    }
  }

  return value
}

/**
 * Converts BLANC CAIP-2 values back to legacy decimal strings for downstream typed parsing.
 */
function decodeChainIdValue(value: unknown): unknown {
  if (typeof value === 'string' && isCaip2(value)) {
    return String(fromCaip2(value))
  }

  return value
}

/**
 * Map keys are always strings in JSON, so convert only keys that are known chain ids.
 */
function encodeChainIdMapKey(key: string): string {
  if (isCaip2(key)) {
    return key
  }

  return /^\d+$/.test(key) ? toCaip2(Number(key)) : key
}

/**
 * BLANC map keys come back as CAIP-2 and need to be restored to decimal-keyed objects.
 */
function decodeChainIdMapKey(key: string): string {
  return isCaip2(key) ? String(fromCaip2(key)) : key
}

/**
 * Keeps the field allowlist explicit so only orchestrator chain-id locations are rewritten.
 */
function transformChainIds(
  value: unknown,
  transformValue: (value: unknown) => unknown,
  transformMapKey: (key: string) => string,
): unknown {
  if (value === null || value === undefined) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((entry) =>
      transformChainIds(entry, transformValue, transformMapKey),
    )
  }

  if (!isPlainObject(value)) {
    return value
  }

  const result: Record<string, unknown> = {}
  for (const [key, nestedValue] of Object.entries(value)) {
    if (CHAIN_ID_SCALAR_FIELDS.has(key)) {
      result[key] = transformValue(nestedValue)
      continue
    }

    if (CHAIN_ID_ARRAY_FIELDS.has(key) && Array.isArray(nestedValue)) {
      result[key] = nestedValue.map(transformValue)
      continue
    }

    if (CHAIN_ID_MAP_FIELDS.has(key) && isPlainObject(nestedValue)) {
      result[key] = Object.fromEntries(
        Object.entries(nestedValue).map(([mapKey, mapValue]) => [
          transformMapKey(mapKey),
          transformChainIds(mapValue, transformValue, transformMapKey),
        ]),
      )
      continue
    }

    result[key] = transformChainIds(
      nestedValue,
      transformValue,
      transformMapKey,
    )
  }

  return result
}

/**
 * Restricts recursive transforms to JSON-like records and avoids mutating arrays or class instances.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  )
}

export {
  convertBigIntFields,
  decodeChainIdRootMapFromWire,
  decodeChainIdsFromWire,
  encodeChainIdsForWire,
}
