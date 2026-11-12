import { AsyncLocalStorage } from 'node:async_hooks'
import type { Fault } from './faults'
import type { ApiVersion, Op } from './routing'
import type { Plain } from './serialize'

type StepKind =
  | 'prepare'
  | 'messages'
  | 'sign'
  | 'submit'
  | 'wait'
  | 'read'
  | 'other'

type SubmitMode = 'capture' | 'live'

interface HttpRecord {
  seq: number
  step: string | undefined
  method: string
  path: string
  query: Record<string, string>
  apiVersion: ApiVersion
  op: Op
  apiVersionHeader: string | undefined
  sdkVersionHeader: string | undefined
  authHeadersPresent: {
    'x-api-key': boolean
    authorization: boolean
    'x-intent-extension': boolean
  }
  requestBody: unknown
  status: number
  responseHeaders: { 'x-trace-id'?: string; 'retry-after'?: string }
  responseBody: unknown
  captured: boolean
  faulted: boolean
  error?: string
}

interface SignerRecord {
  seq: number
  step: string | undefined
  signer: string
  method: 'sign' | 'signMessage' | 'signTypedData' | 'signAuthorization'
  payload: Plain
  // The 32-byte hash the signature commits to.
  digest: string | undefined
  output: Plain
}

interface StepError {
  name: string
  ctor: string
  message: string
  errorType?: string
  statusCode?: number
  context?: Plain
}

interface StepRecord {
  seq: number
  name: string
  kind: StepKind
  ok: boolean
  value?: Plain
  error?: StepError
}

interface RunRecords {
  http: HttpRecord[]
  signer: SignerRecord[]
  steps: StepRecord[]
}

interface RunContext {
  role: 'baseline' | 'candidate'
  step: string | undefined
  submitMode: SubmitMode
  fault: Fault | undefined
  origins: string[]
  seq: number
  records: RunRecords
}

const als = new AsyncLocalStorage<RunContext>()

function currentContext(): RunContext | undefined {
  return als.getStore()
}

function nextSeq(ctx: RunContext): number {
  ctx.seq += 1
  return ctx.seq
}

function createRunContext(
  init: Omit<RunContext, 'step' | 'seq' | 'records'>,
): RunContext {
  return {
    ...init,
    step: undefined,
    seq: 0,
    records: { http: [], signer: [], steps: [] },
  }
}

export type {
  HttpRecord,
  RunContext,
  RunRecords,
  SignerRecord,
  StepError,
  StepKind,
  StepRecord,
  SubmitMode,
}
export { als, createRunContext, currentContext, nextSeq }
