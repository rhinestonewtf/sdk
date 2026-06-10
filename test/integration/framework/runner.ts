import type {
  PreparedTransactionData,
  RhinestoneAccount,
  SignedTransactionData,
  Transaction,
  TransactionResult,
} from '../../../src/index'

type ErrorPhase = 'prepare' | 'sign' | 'authorize' | 'submit' | 'execution'
type ErrorClass = (new (...args: any[]) => Error) & { name: string }

type SuccessfulIntent = {
  phase: 'success'
  label?: string
  durationMs: number
  prepared: PreparedTransactionData
  signed: SignedTransactionData
  result?: TransactionResult
  status?: unknown
}

// How far the pipeline runs:
//   - 'sign'    → prepare + sign only (encode-assert; inspect prepared/signed)
//   - 'dryRun'  → + submit with internal_dryRun (orchestrator validates without
//                 settlement or funds), no waitForExecution
//   - 'execute' → full end-to-end incl. waitForExecution (default)
export type ExecutionMode = 'sign' | 'dryRun' | 'execute'

type FailedIntent = {
  phase: ErrorPhase
  label?: string
  durationMs: number
  error: unknown
  prepared?: PreparedTransactionData
  signed?: SignedTransactionData
  result?: TransactionResult
}

export type IntentExecution = SuccessfulIntent | FailedIntent

type ExpectedOutcome =
  | { kind: 'success' }
  | {
      kind: `${ErrorPhase}-error`
      error?: ErrorClass
      code?: string
      message?: string | RegExp
    }

export async function executeIntent({
  account,
  transaction,
  label,
  signAuthorizations = false,
  mode = 'execute',
  transformSigned,
}: {
  account: RhinestoneAccount
  transaction: Transaction
  label?: string
  signAuthorizations?: boolean
  mode?: ExecutionMode
  // Mutate the signed payload before submit, e.g. to tamper with signature
  // bytes and assert the orchestrator rejects them.
  transformSigned?: (signed: SignedTransactionData) => SignedTransactionData
}): Promise<IntentExecution> {
  const startedAt = Date.now()
  let prepared: PreparedTransactionData | undefined
  let signed: SignedTransactionData | undefined
  let result: TransactionResult | undefined

  const elapsed = () => Date.now() - startedAt

  try {
    prepared = await account.prepareTransaction(transaction)
  } catch (error) {
    return { phase: 'prepare', label, durationMs: elapsed(), error }
  }

  try {
    signed = await account.signTransaction(prepared)
    if (transformSigned) signed = transformSigned(signed)
  } catch (error) {
    return { phase: 'sign', label, durationMs: elapsed(), error, prepared }
  }

  let authorizations:
    | Awaited<ReturnType<RhinestoneAccount['signAuthorizations']>>
    | undefined

  try {
    authorizations = signAuthorizations
      ? await account.signAuthorizations(prepared)
      : undefined
  } catch (error) {
    return {
      phase: 'authorize',
      label,
      durationMs: elapsed(),
      error,
      prepared,
      signed,
    }
  }

  if (mode === 'sign') {
    return {
      phase: 'success',
      label,
      durationMs: elapsed(),
      prepared,
      signed,
    }
  }

  try {
    result = await account.submitTransaction(signed, {
      ...(authorizations ? { authorizations } : {}),
      ...(mode === 'dryRun' ? { internal_dryRun: true } : {}),
    })
  } catch (error) {
    return {
      phase: 'submit',
      label,
      durationMs: elapsed(),
      error,
      prepared,
      signed,
    }
  }

  if (mode === 'dryRun') {
    return {
      phase: 'success',
      label,
      durationMs: elapsed(),
      prepared,
      signed,
      result,
    }
  }

  try {
    const status = await account.waitForExecution(result)
    const execution = {
      phase: 'success' as const,
      label,
      durationMs: elapsed(),
      prepared,
      signed,
      result,
      status,
    }
    logDebugDiagnostics(execution)
    return execution
  } catch (error) {
    return {
      phase: 'execution',
      label,
      durationMs: elapsed(),
      error,
      prepared,
      signed,
      result,
    }
  }
}

export function expectOutcome(
  execution: IntentExecution,
  expected: ExpectedOutcome,
): void {
  if (expected.kind === 'success') {
    if (execution.phase !== 'success') {
      throw new Error(formatIntentDiagnostics(execution), {
        cause: execution.error,
      })
    }
    return
  }

  const phase = expected.kind.replace('-error', '')
  if (execution.phase === 'success') {
    throw new Error(
      `Expected ${
        expected.kind
      }, but intent completed\n${formatIntentDiagnostics(execution)}`,
    )
  }

  if (execution.phase !== phase) {
    throw new Error(
      `Expected ${expected.kind}, got ${
        execution.phase
      }-error\n${formatIntentDiagnostics(execution)}`,
      { cause: execution.error },
    )
  }

  if (expected.error && !(execution.error instanceof expected.error)) {
    throw new Error(
      `Expected ${expected.error.name}, got ${getErrorName(
        execution.error,
      )}\n${formatIntentDiagnostics(execution)}`,
      { cause: execution.error },
    )
  }

  if (expected.code) {
    const code = getErrorField(execution.error, 'code')
    if (code !== expected.code) {
      throw new Error(
        `Expected error code ${expected.code}, got ${String(
          code,
        )}\n${formatIntentDiagnostics(execution)}`,
        { cause: execution.error },
      )
    }
  }

  if (expected.message) {
    const message =
      execution.error instanceof Error
        ? execution.error.message
        : String(execution.error)
    if (typeof expected.message === 'string') {
      if (!message.includes(expected.message)) {
        throw new Error(
          `Expected error message to contain ${JSON.stringify(
            expected.message,
          )}\n${formatIntentDiagnostics(execution)}`,
          { cause: execution.error },
        )
      }
    } else {
      if (!expected.message.test(message)) {
        throw new Error(
          `Expected error message to match ${
            expected.message
          }\n${formatIntentDiagnostics(execution)}`,
          { cause: execution.error },
        )
      }
    }
  }

  logDebugDiagnostics(execution)
}

function getErrorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error
}

export function getOperations(status: unknown) {
  const operations = (status as { operations?: unknown[] })?.operations
  return Array.isArray(operations) ? operations : []
}

export function expectCompletedOperation(
  status: unknown,
  chainId: number,
): void {
  const operations = getOperations(status)
  const found = operations.some((operation) => {
    const op = operation as { chain?: number; status?: string }
    return op.chain === chainId && op.status === 'COMPLETED'
  })
  if (!found) {
    const observed = formatOperations(operations)
    throw new Error(
      `Expected a COMPLETED operation on chain ${chainId}, but none was found.\nObserved operations:\n${observed}`,
    )
  }
}

export function expectNoOperationOnChain(
  status: unknown,
  chainId: number,
): void {
  const operations = getOperations(status)
  const found = operations.some((operation) => {
    const op = operation as { chain?: number }
    return op.chain === chainId
  })
  if (found) {
    const observed = formatOperations(operations)
    throw new Error(
      `Expected no operation on chain ${chainId}, but one was found.\nObserved operations:\n${observed}`,
    )
  }
}

export function expectNoFailedOperations(status: unknown): void {
  const operations = getOperations(status)
  const failed = operations.filter((operation) => {
    const op = operation as { status?: string }
    return op.status === 'FAILED'
  })
  if (failed.length > 0) {
    const observed = formatOperations(operations)
    throw new Error(
      `Expected no failed operations, but ${failed.length} failed.\nObserved operations:\n${observed}`,
    )
  }
}

function formatOperations(operations: unknown[]): string {
  if (operations.length === 0) return '  (none)'
  return operations
    .map((operation) => {
      const op = operation as {
        chain?: unknown
        status?: unknown
        type?: unknown
        txHash?: unknown
      }
      const parts = [
        typeof op.chain === 'number' ? `chain=${op.chain}` : undefined,
        typeof op.status === 'string' ? `status=${op.status}` : undefined,
        typeof op.type === 'string' ? `type=${op.type}` : undefined,
        typeof op.txHash === 'string' ? `tx=${op.txHash}` : undefined,
      ]
        .filter((part): part is string => Boolean(part))
        .join(' ')
      return `  - ${parts || '(unknown)'}`
    })
    .join('\n')
}

function logDebugDiagnostics(execution: IntentExecution): void {
  if (!['1', 'true'].includes(process.env.SDK_ITEST_DEBUG ?? '')) return
  console.info(formatIntentDiagnostics(execution))
}

export function formatIntentDiagnostics(execution: IntentExecution): string {
  const diagnostics = getIntentDiagnostics(execution)
  const lines = [
    `intent diagnostics: ${diagnostics.label ?? '(unlabeled)'}`,
    `  phase: ${diagnostics.phase}`,
    `  duration: ${diagnostics.durationMs}ms`,
  ]

  append(lines, 'intentId', diagnostics.intentId)
  append(lines, 'settlementLayer', diagnostics.settlementLayer)
  append(lines, 'traceId', diagnostics.traceId)
  append(lines, 'errorCode', diagnostics.errorCode)
  append(lines, 'statusCode', diagnostics.statusCode)
  append(lines, 'error', diagnostics.error)
  append(lines, 'result', diagnostics.result)

  if (diagnostics.operations.length > 0) {
    lines.push('  operations:')
    for (const operation of diagnostics.operations) {
      lines.push(`    - ${operation}`)
    }
  }

  if (diagnostics.urls.length > 0) {
    lines.push('  urls:')
    for (const url of diagnostics.urls) {
      lines.push(`    - ${url}`)
    }
  }

  if (diagnostics.quoteIntentIds.length > 1) {
    lines.push(`  quoteIntentIds: ${diagnostics.quoteIntentIds.join(', ')}`)
  }

  return lines.join('\n')
}

function getIntentDiagnostics(execution: IntentExecution) {
  const error = execution.phase === 'success' ? undefined : execution.error
  const bestQuote = getBestQuote(execution.prepared)
  const result = summarizeResult(execution.result)
  const operations =
    execution.phase === 'success' ? summarizeOperations(execution.status) : []

  return {
    label: execution.label,
    phase: execution.phase,
    durationMs: execution.durationMs,
    intentId: bestQuote?.intentId,
    settlementLayer: bestQuote?.settlementLayer,
    quoteIntentIds: getQuoteIntentIds(execution.prepared),
    traceId: getTraceId(error),
    errorCode: getErrorField(error, 'code'),
    statusCode: getErrorField(error, 'statusCode'),
    error: formatError(error),
    result,
    operations,
    urls: extractUrls(error),
  }
}

function append(lines: string[], label: string, value: unknown): void {
  if (value === undefined || value === null || value === '') return
  lines.push(`  ${label}: ${String(value)}`)
}

function getBestQuote(prepared: PreparedTransactionData | undefined):
  | {
      intentId?: string
      settlementLayer?: string
    }
  | undefined {
  return (
    prepared as
      | {
          quotes?: {
            best?: {
              intentId?: string
              settlementLayer?: string
            }
          }
        }
      | undefined
  )?.quotes?.best
}

function getQuoteIntentIds(
  prepared: PreparedTransactionData | undefined,
): string[] {
  const quotes = (
    prepared as
      | {
          quotes?: {
            all?: unknown[]
          }
        }
      | undefined
  )?.quotes?.all
  if (!Array.isArray(quotes)) return []
  return quotes
    .map((quote) => (quote as { intentId?: unknown }).intentId)
    .filter((intentId): intentId is string => typeof intentId === 'string')
}

function getTraceId(error: unknown): string | undefined {
  const traceId = findField(error, 'traceId')
  return typeof traceId === 'string' && traceId.length > 0 ? traceId : undefined
}

function getErrorField(
  error: unknown,
  field: string,
): string | number | undefined {
  const value = findField(error, field)
  if (typeof value === 'string' || typeof value === 'number') return value
  return undefined
}

function formatError(error: unknown): string | undefined {
  if (!error) return undefined
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`
  }
  return String(error)
}

function summarizeResult(
  result: TransactionResult | undefined,
): string | undefined {
  if (!result) return undefined
  const summary = result as {
    type?: unknown
    id?: unknown
    targetChain?: unknown
    sourceChains?: unknown
  }
  const parts = [
    typeof summary.type === 'string' ? `type=${summary.type}` : undefined,
    typeof summary.id === 'string' ? `id=${summary.id}` : undefined,
    typeof summary.targetChain === 'number'
      ? `target=${summary.targetChain}`
      : undefined,
    Array.isArray(summary.sourceChains)
      ? `sources=${summary.sourceChains.join(',')}`
      : undefined,
  ].filter((part): part is string => Boolean(part))
  return parts.length > 0 ? parts.join(' ') : undefined
}

function summarizeOperations(status: unknown): string[] {
  return getOperations(status).map((operation) => {
    const op = operation as {
      chain?: unknown
      status?: unknown
      txHash?: unknown
      type?: unknown
    }
    return [
      typeof op.chain === 'number' ? `chain=${op.chain}` : undefined,
      typeof op.status === 'string' ? `status=${op.status}` : undefined,
      typeof op.type === 'string' ? `type=${op.type}` : undefined,
      typeof op.txHash === 'string' ? `tx=${op.txHash}` : undefined,
    ]
      .filter((part): part is string => Boolean(part))
      .join(' ')
  })
}

function extractUrls(value: unknown): string[] {
  const urls = new Set<string>()
  const seen = new Set<unknown>()

  function visit(current: unknown, depth: number): void {
    if (depth > 6 || current === null || current === undefined) return
    if (typeof current === 'string') {
      for (const match of current.matchAll(/https?:\/\/[^\s"'<>]+/g)) {
        urls.add(match[0].replace(/[),.;\]]+$/, ''))
      }
      return
    }
    if (typeof current !== 'object' || seen.has(current)) return
    seen.add(current)

    if (current instanceof Error) {
      visit(current.message, depth + 1)
      visit(current.cause, depth + 1)
    }

    for (const nested of Object.values(current as Record<string, unknown>)) {
      visit(nested, depth + 1)
    }
  }

  visit(value, 0)
  return [...urls]
}

function findField(value: unknown, field: string): unknown {
  const seen = new Set<unknown>()

  function visit(current: unknown, depth: number): unknown {
    if (depth > 6 || current === null || current === undefined) return undefined
    if (typeof current !== 'object' || seen.has(current)) return undefined
    seen.add(current)

    const record = current as Record<string, unknown>
    if (field in record) return record[field]

    if (current instanceof Error) {
      const causeValue = visit(current.cause, depth + 1)
      if (causeValue !== undefined) return causeValue
    }

    for (const nested of Object.values(record)) {
      const nestedValue = visit(nested, depth + 1)
      if (nestedValue !== undefined) return nestedValue
    }

    return undefined
  }

  return visit(value, 0)
}
