import {
  decodeFunctionData,
  type Hex,
  parseAbi,
  toFunctionSelector,
} from 'viem'
import type { CanonicalLayers, Layer } from './canonical/types'
import { matchGlob } from './glob'
import { RULES, type Rule, type Tolerance } from './rules'

// Values compared within a tolerance are wrapped in a marker the comparer
// understands; goldens keep only the rule id.
interface TolerantValue {
  $tolerance: Tolerance & { rule: string; value: number | string }
}

type RuleHits = Record<string, number>

// Calls whose price-derived arguments are compared within the rule's
// tolerance; every other argument, and any other calldata, stays exact.
const KNOWN_CALLS = parseAbi([
  'function approve(address spender, uint256 amount)',
  'function transfer(address to, uint256 amount)',
  // CCTP v2 TokenMessenger: the burn amount includes the fast-transfer fee.
  'function depositForBurnWithHook(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold, bytes hookData)',
  // Session destination ops cap the spend at the approved amount.
  'function callbackAllowMaxAmount(address token, uint256 amount)',
])
const PRICE_DERIVED_ARGS: Record<string, readonly string[]> = {
  approve: ['amount'],
  transfer: ['amount'],
  depositForBurnWithHook: ['amount', 'maxFee'],
  callbackAllowMaxAmount: ['amount'],
}
const KNOWN_SELECTORS = new Set<string>(
  KNOWN_CALLS.map((item) => toFunctionSelector(item)),
)

function isTolerant(value: unknown): value is TolerantValue {
  return Boolean(value && typeof value === 'object' && '$tolerance' in value)
}

function tolerant(rule: Rule, value: unknown): TolerantValue {
  return {
    $tolerance: {
      rule: rule.id,
      value: value as number | string,
      relative: rule.relative,
      absolute: rule.absolute,
      presence: rule.presence,
    },
  }
}

function decodeCalldata(rule: Rule, value: unknown): unknown {
  if (
    typeof value !== 'string' ||
    !KNOWN_SELECTORS.has(value.slice(0, 10).toLowerCase())
  ) {
    return value
  }
  try {
    const { functionName, args } = decodeFunctionData({
      abi: KNOWN_CALLS,
      data: value as Hex,
    })
    const item = KNOWN_CALLS.find((entry) => entry.name === functionName)!
    const tolerantArgs = PRICE_DERIVED_ARGS[functionName] ?? []
    const decoded: Record<string, unknown> = {}
    item.inputs.forEach((input, i) => {
      const arg = args[i]
      const plain =
        typeof arg === 'bigint'
          ? arg.toString()
          : typeof arg === 'string'
            ? arg.toLowerCase()
            : arg
      decoded[input.name as string] = tolerantArgs.includes(
        input.name as string,
      )
        ? tolerant(rule, plain)
        : plain
    })
    return { $calldata: { function: functionName, args: decoded } }
  } catch {
    return value
  }
}

function applyRule(
  rule: Rule,
  value: unknown,
): { drop: boolean; value: unknown } {
  switch (rule.kind) {
    case 'ignore':
      return { drop: true, value: undefined }
    case 'mask':
      return { drop: false, value: `<${rule.label ?? rule.id}>` }
    case 'tolerance':
      return { drop: false, value: tolerant(rule, value) }
    case 'decodeCalldata':
      return { drop: false, value: decodeCalldata(rule, value) }
  }
}

function withOverrides(
  rules: Rule[],
  overrides: Record<string, Tolerance> | undefined,
): Rule[] {
  if (!overrides) return rules
  return rules.map((rule) =>
    overrides[rule.id] ? { ...rule, ...overrides[rule.id] } : rule,
  )
}

function normalizeLayer(
  layer: Layer,
  value: unknown,
  rules: Rule[],
  hits: RuleHits,
): unknown {
  const applicable = rules.filter(
    (rule) => rule.layer === '*' || rule.layer === layer,
  )

  function walk(
    node: unknown,
    path: string[],
  ): { drop: boolean; value: unknown } {
    if (path.length > 0) {
      const rule = applicable.find((candidate) =>
        matchGlob(candidate.path, path),
      )
      if (rule) {
        hits[rule.id] = (hits[rule.id] ?? 0) + 1
        return applyRule(rule, node)
      }
    }
    if (Array.isArray(node)) {
      return {
        drop: false,
        value: node.map((item, i) => walk(item, [...path, String(i)]).value),
      }
    }
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {}
      for (const [key, item] of Object.entries(node)) {
        const result = walk(item, [...path, key])
        if (!result.drop) out[key] = result.value
      }
      return { drop: false, value: out }
    }
    return { drop: false, value: node }
  }

  return walk(value, []).value
}

function normalize(
  layers: CanonicalLayers,
  options: { rules?: Rule[]; tolerances?: Record<string, Tolerance> } = {},
): { layers: CanonicalLayers; hits: RuleHits } {
  const rules = withOverrides(options.rules ?? RULES, options.tolerances)
  const hits: RuleHits = {}
  const out = {} as CanonicalLayers
  for (const [layer, value] of Object.entries(layers) as [Layer, unknown][]) {
    out[layer] = normalizeLayer(layer, value, rules, hits)
  }
  return { layers: out, hits }
}

export type { RuleHits, TolerantValue }
export { isTolerant, normalize, normalizeLayer }
