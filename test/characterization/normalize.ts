export type NormalizationKind =
  | 'generated-id'
  | 'transaction-hash'
  | 'block-number'
  | 'timestamp'
  | 'duration'
  | 'gas-estimate'
  | 'fee-value'
  | 'market-amount'
  | 'trace-url'
  | 'infrastructure-hostname'
  | 'case-insensitive'

export interface NormalizationRule {
  path: string
  kind: NormalizationKind
  reason: string
}

export interface IdentityMapping {
  path: string
  identity: string
  values: readonly string[]
  reason: string
}

export interface AppliedNormalization {
  path: string
  kind: NormalizationKind
  reason: string
}

export interface AppliedIdentityMapping {
  path: string
  identity: string
  original: string
  reason: string
}

export interface NormalizationResult {
  value: unknown
  appliedRules: AppliedNormalization[]
  appliedIdentities: AppliedIdentityMapping[]
}

export interface NormalizeOptions {
  rules?: readonly NormalizationRule[]
  identityMappings?: readonly IdentityMapping[]
  requireMatches?: boolean
}

interface CompiledRule<T> {
  definition: T
  segments: string[]
  matches: number
}

const NORMALIZED_MARKER = '$characterizationNormalized'
const IDENTITY_MARKER = '$characterizationIdentity'

function decodePointerSegment(segment: string): string {
  if (/~(?![01])/u.test(segment)) {
    throw new Error(
      `Invalid JSON pointer escape in segment ${JSON.stringify(segment)}`,
    )
  }
  return segment.replace(/~1/g, '/').replace(/~0/g, '~')
}

function encodePointerSegment(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1')
}

function childPath(path: string, segment: string | number): string {
  return `${path}/${encodePointerSegment(String(segment))}`
}

function compilePath(path: string): string[] {
  if (!path.startsWith('/') || path === '/') {
    throw new Error(
      `Normalization path must be a non-root JSON pointer, received ${JSON.stringify(path)}`,
    )
  }
  return path.slice(1).split('/').map(decodePointerSegment)
}

function pathMatches(
  pattern: readonly string[],
  actual: readonly string[],
): boolean {
  return (
    pattern.length === actual.length &&
    pattern.every(
      (segment, index) => segment === '*' || segment === actual[index],
    )
  )
}

function normalizedSegment(segment: string): string {
  return segment.replace(/[^a-z0-9]/gi, '').toLowerCase()
}

function isProtectedSemanticPath(
  segments: readonly string[],
  kind: NormalizationKind,
): boolean {
  if (kind === 'case-insensitive') return false

  const normalized = segments.map(normalizedSegment)
  const leaf = normalized.at(-1) ?? ''
  const joined = normalized.join('.')

  if (
    normalized.some(
      (segment) =>
        segment.includes('signature') ||
        segment.endsWith('chainid') ||
        segment.endsWith('address') ||
        segment.includes('threshold'),
    )
  ) {
    return true
  }

  if (leaf === 'amount' || leaf.endsWith('amount')) {
    const isMarketValue =
      kind === 'market-amount' &&
      /(?:market|quote|route|estimate)/u.test(joined)
    const isFeeValue = kind === 'fee-value' && joined.includes('fee')
    if (!isMarketValue && !isFeeValue) return true
  }

  if (
    ['to', 'target', 'data', 'calldata'].includes(leaf) &&
    /(?:call|operation)/u.test(joined)
  ) {
    return true
  }

  const belongsToError =
    normalized.includes('error') || joined.includes('error')
  const belongsToTerminalState = /(?:execution|outcome|terminal)/u.test(joined)
  if (
    leaf === 'order' ||
    leaf === 'operationorder' ||
    (belongsToError && ['phase', 'class', 'name', 'code'].includes(leaf)) ||
    /error(?:phase|class|code)$/u.test(joined) ||
    ['terminalstate', 'success', 'completedchains'].includes(leaf) ||
    (leaf === 'status' && belongsToTerminalState)
  ) {
    return true
  }

  return false
}

function isCompatibleVolatilePath(
  segments: readonly string[],
  kind: NormalizationKind,
): boolean {
  if (kind === 'case-insensitive') return true

  const normalized = segments.map(normalizedSegment)
  const leaf = normalized.at(-1) ?? ''
  const joined = normalized.join('.')
  switch (kind) {
    case 'generated-id':
      return (
        leaf.endsWith('id') &&
        /(?:request|intent|operation|quote|trace)/u.test(joined)
      )
    case 'transaction-hash':
      return ['transactionhash', 'txhash'].includes(leaf)
    case 'block-number':
      return leaf === 'blocknumber'
    case 'timestamp':
      return ['timestamp', 'createdat', 'updatedat', 'observedat'].includes(
        leaf,
      )
    case 'duration':
      return /(?:duration|durationms|elapsed|elapsedms)$/u.test(leaf)
    case 'gas-estimate':
      return leaf.includes('gas') && leaf.includes('estimate')
    case 'fee-value':
      return leaf.includes('fee') && !/(?:input|request|config)/u.test(joined)
    case 'market-amount':
      return (
        leaf.endsWith('amount') &&
        /(?:market|quote|route|estimate)/u.test(joined)
      )
    case 'trace-url':
      return leaf === 'traceurl'
    case 'infrastructure-hostname':
      return (
        ['host', 'hostname', 'traceurl', 'url'].includes(leaf) &&
        /(?:diagnostic|infrastructure|trace)/u.test(joined)
      )
  }
}

function assertDefinition(
  definition: NormalizationRule | IdentityMapping,
  type: 'normalization' | 'identity',
): void {
  compilePath(definition.path)
  if (definition.reason.trim().length === 0) {
    throw new Error(`${type} rule at ${definition.path} must state a reason`)
  }
  if (type === 'identity') {
    const identity = definition as IdentityMapping
    if (identity.identity.trim().length === 0) {
      throw new Error(
        `Identity mapping at ${identity.path} must name an identity`,
      )
    }
    if (
      identity.values.length < 2 ||
      new Set(identity.values).size !== identity.values.length
    ) {
      throw new Error(
        `Identity mapping at ${identity.path} requires at least two unique subject values`,
      )
    }
  }
}

function applyRule(
  value: unknown,
  rule: NormalizationRule,
  path: string,
): unknown {
  const segments = path.slice(1).split('/').map(decodePointerSegment)
  if (isProtectedSemanticPath(segments, rule.kind)) {
    throw new Error(
      `Normalization rule ${JSON.stringify(rule.kind)} cannot remove semantic field ${path}`,
    )
  }
  if (!isCompatibleVolatilePath(segments, rule.kind)) {
    throw new Error(
      `Normalization kind ${JSON.stringify(rule.kind)} is not approved for ${path}`,
    )
  }

  if (rule.kind === 'case-insensitive') {
    if (typeof value !== 'string') {
      throw new Error(`Case normalization at ${path} requires a string`)
    }
    return value.toLowerCase()
  }

  if (rule.kind === 'infrastructure-hostname') {
    if (typeof value !== 'string') {
      throw new Error(`Hostname normalization at ${path} requires a string`)
    }
    try {
      const url = new URL(value)
      url.hostname = 'infrastructure.invalid'
      return url.toString()
    } catch {
      return '<infrastructure-hostname>'
    }
  }

  if (typeof value === 'object' && value !== null && !(value instanceof Date)) {
    throw new Error(
      `Normalization rule ${JSON.stringify(rule.kind)} at ${path} may only replace a volatile leaf`,
    )
  }

  return { [NORMALIZED_MARKER]: rule.kind }
}

export function normalizeObservation(
  value: unknown,
  options: NormalizeOptions = {},
): NormalizationResult {
  const compiledRules: CompiledRule<NormalizationRule>[] = (
    options.rules ?? []
  ).map((definition) => {
    assertDefinition(definition, 'normalization')
    return { definition, segments: compilePath(definition.path), matches: 0 }
  })
  const compiledIdentities: CompiledRule<IdentityMapping>[] = (
    options.identityMappings ?? []
  ).map((definition) => {
    assertDefinition(definition, 'identity')
    return { definition, segments: compilePath(definition.path), matches: 0 }
  })
  const appliedRules: AppliedNormalization[] = []
  const appliedIdentities: AppliedIdentityMapping[] = []
  const active = new WeakSet<object>()

  function normalize(
    current: unknown,
    segments: string[],
    path: string,
  ): unknown {
    const ruleMatches = compiledRules.filter((rule) =>
      pathMatches(rule.segments, segments),
    )
    const identityMatches = compiledIdentities.filter((mapping) =>
      pathMatches(mapping.segments, segments),
    )
    if (ruleMatches.length + identityMatches.length > 1) {
      throw new Error(`Multiple normalization definitions match ${path || '/'}`)
    }

    const identity = identityMatches[0]
    if (identity) {
      if (
        typeof current !== 'string' ||
        !identity.definition.values.includes(current)
      ) {
        throw new Error(
          `Identity mapping ${JSON.stringify(identity.definition.identity)} at ${path} received an unknown subject value`,
        )
      }
      identity.matches += 1
      appliedIdentities.push({
        path,
        identity: identity.definition.identity,
        original: current,
        reason: identity.definition.reason,
      })
      return { [IDENTITY_MARKER]: identity.definition.identity }
    }

    const rule = ruleMatches[0]
    if (rule) {
      rule.matches += 1
      appliedRules.push({
        path,
        kind: rule.definition.kind,
        reason: rule.definition.reason,
      })
      return applyRule(current, rule.definition, path)
    }

    if (typeof current !== 'object' || current === null) return current
    if (active.has(current)) {
      throw new TypeError(`Cannot normalize cyclic value at ${path || '/'}`)
    }
    active.add(current)

    try {
      if (current instanceof Date) return new Date(current.getTime())
      if (current instanceof Map) {
        const output = new Map<unknown, unknown>()
        let index = 0
        for (const [key, mapValue] of current.entries()) {
          const entrySegments = [...segments, String(index)]
          const entryPath = childPath(path, index)
          output.set(
            normalize(
              key,
              [...entrySegments, 'key'],
              childPath(entryPath, 'key'),
            ),
            normalize(
              mapValue,
              [...entrySegments, 'value'],
              childPath(entryPath, 'value'),
            ),
          )
          index += 1
        }
        return output
      }
      if (Array.isArray(current)) {
        return Array.from(current, (item, index) =>
          normalize(item, [...segments, String(index)], childPath(path, index)),
        )
      }

      const output: Record<string, unknown> = {}
      for (const [key, child] of Object.entries(current)) {
        output[key] = normalize(child, [...segments, key], childPath(path, key))
      }
      return output
    } finally {
      active.delete(current)
    }
  }

  const normalized = normalize(value, [], '')
  if (options.requireMatches !== false) {
    for (const rule of [...compiledRules, ...compiledIdentities]) {
      if (rule.matches === 0) {
        throw new Error(
          `Normalization definition did not match ${rule.definition.path}`,
        )
      }
    }
  }

  return {
    value: normalized,
    appliedRules,
    appliedIdentities,
  }
}
