import type { HttpRecord, RunRecords, StepRecord } from '../context'
import type { ApiVersion, Op } from '../routing'
import { alps } from './alps'
import { blanc } from './blanc'
import { asRecord, compact, lowerHex } from './common'
import { createTemplater, templateDeep, templateSignatures } from './signatures'
import type { CanonicalLayers, VersionAdapter } from './types'

const ADAPTERS: Record<ApiVersion, VersionAdapter> = { alps, blanc }

function adapterFor(apiVersion: ApiVersion): VersionAdapter {
  return ADAPTERS[apiVersion]
}

const READ_OPS = new Set<Op>([
  'status',
  'portfolio',
  'splits',
  'appFeeBalances',
])
const NO_STEP = '(no step)'

// Keys values by step name, suffixing repeats (`prepare`, `prepare#2`).
function byStep<T>(
  entries: { step: string | undefined; value: T }[],
): Record<string, T> {
  const out: Record<string, T> = {}
  for (const { step, value } of entries) {
    const base = step ?? NO_STEP
    let key = base
    for (let n = 2; key in out; n++) key = `${base}#${n}`
    out[key] = value
  }
  return out
}

function withoutTraceId(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutTraceId)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'traceId') continue
      out[key] = withoutTraceId(entry)
    }
    return out
  }
  return value
}

function typedDataEntry(value: unknown) {
  const input = asRecord(value)
  return lowerHex({
    domain: input.domain,
    primaryType: input.primaryType,
    types: input.types,
    message: input.message,
  })
}

function isOk(record: HttpRecord): boolean {
  return record.status >= 200 && record.status < 300
}

function projectTypedData(records: RunRecords, steps: StepRecord[]) {
  const templater = createTemplater(records.signer)
  const publicMessages = byStep(
    steps
      .filter((step) => step.kind === 'messages' && step.ok)
      .map((step) => {
        const value = asRecord(step.value)
        const origin = Array.isArray(value.origin) ? value.origin : []
        return {
          step: step.name,
          value: [
            ...origin.map((message, i) => ({
              role: `origin[${i}]`,
              ...typedDataEntry(message),
            })),
            { role: 'destination', ...typedDataEntry(value.destination) },
          ],
        }
      }),
  )
  const signed = records.signer
    .filter((record) => record.method === 'signTypedData')
    .map((record) => ({
      roleKey: templater.roleKeys.get(record),
      signer: record.signer,
      ...typedDataEntry(record.payload),
    }))
  const signedRaw = records.signer
    .filter((record) => record.method !== 'signTypedData')
    .map((record) => ({
      roleKey: templater.roleKeys.get(record),
      signer: record.signer,
      method: record.method,
      payload: templateDeep(lowerHex(record.payload), templater),
    }))
  return compact({
    public: publicMessages,
    signed,
    signedRaw: signedRaw.length > 0 ? signedRaw : undefined,
  })
}

function projectSignatures(records: RunRecords, steps: StepRecord[]) {
  const templater = createTemplater(records.signer)
  return byStep(
    steps
      .filter((step) => step.kind === 'sign' && step.ok)
      .map((step) => {
        const value = asRecord(step.value)
        return {
          step: step.name,
          value: templateSignatures(
            lowerHex(
              compact({
                origin: value.originSignatures,
                destination: value.destinationSignature,
                targetExecution: value.targetExecutionSignature,
                permits: value.permitSignatures,
                authorizations: value.authorizations,
              }),
            ),
            templater,
          ),
        }
      }),
  )
}

function projectReads(records: RunRecords, steps: StepRecord[]) {
  return byStep(
    steps
      .filter((step) => step.kind === 'read')
      .map((step) => {
        const wire = records.http.find(
          (r) => r.step === step.name && READ_OPS.has(r.op),
        )
        const params = wire
          ? adapterFor(wire.apiVersion).readParams(
              wire.op as 'status' | 'portfolio' | 'splits' | 'appFeeBalances',
              { path: wire.path, query: wire.query, body: wire.requestBody },
            )
          : undefined
        return {
          step: step.name,
          value: compact({
            op: wire?.op,
            params,
            result: step.ok ? lowerHex(step.value) : undefined,
          }),
        }
      }),
  )
}

function projectErrors(records: RunRecords, steps: StepRecord[]) {
  return byStep(
    steps
      .filter((step) => !step.ok && step.error)
      .map((step) => {
        const error = step.error!
        const failed = records.http.filter(
          (r) => r.step === step.name && r.status >= 400,
        )
        const last = failed[failed.length - 1]
        return {
          step: step.name,
          value: compact({
            ctor: error.ctor,
            name: error.name,
            errorType: error.errorType,
            statusCode: error.statusCode,
            message: error.message,
            context: withoutTraceId(error.context),
            wire: last
              ? adapterFor(last.apiVersion).wireError(
                  last.status,
                  last.responseBody,
                )
              : undefined,
          }),
        }
      }),
  )
}

function projectSteps(steps: StepRecord[]) {
  return byStep(
    steps.map((step) => {
      let value: unknown
      if (step.ok) {
        switch (step.kind) {
          case 'prepare':
            value = asRecord(step.value).transaction
            break
          case 'submit':
          case 'wait':
          case 'other':
            value = step.value
            break
        }
      }
      return {
        step: step.name,
        value: compact({
          kind: step.kind,
          ok: step.ok,
          value: lowerHex(value),
        }),
      }
    }),
  )
}

function projectTraffic(records: RunRecords) {
  const traffic: { step: string; ops: string[] }[] = []
  for (const record of records.http) {
    const step = record.step ?? NO_STEP
    let current = traffic[traffic.length - 1]
    if (!current || current.step !== step) {
      current = { step, ops: [] }
      traffic.push(current)
    }
    const op = record.captured ? `${record.op}(captured)` : record.op
    // Consecutive status polls collapse into one.
    if (op === 'status' && current.ops[current.ops.length - 1] === 'status')
      continue
    current.ops.push(op)
  }
  return traffic
}

function project(records: RunRecords): CanonicalLayers {
  const steps = records.steps
  const templater = createTemplater(records.signer)
  const quotes = records.http.filter((r) => r.op === 'quote')
  const submits = records.http.filter((r) => r.op === 'submit')
  return {
    quoteRequest: byStep(
      quotes.map((r) => ({
        step: r.step,
        value: adapterFor(r.apiVersion).quoteRequest(r.requestBody),
      })),
    ),
    typedData: projectTypedData(records, steps),
    signatures: projectSignatures(records, steps),
    submitRequest: byStep(
      submits.map((r) => ({
        step: r.step,
        value: templateDeep(
          adapterFor(r.apiVersion).submitRequest(r.requestBody),
          templater,
        ),
      })),
    ),
    reads: projectReads(records, steps),
    errors: projectErrors(records, steps),
    cost: byStep(
      quotes.filter(isOk).map((r) => ({
        step: r.step,
        value: adapterFor(r.apiVersion).cost(r.responseBody, r.requestBody),
      })),
    ),
    steps: projectSteps(steps),
    traffic: projectTraffic(records),
  }
}

export { adapterFor, project }
