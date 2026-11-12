import type { LocalAccount } from 'viem'
import * as chains from 'viem/chains'
import type { AcceptedDifference } from './accepted'
import type { LoadedBuild, SdkInstance } from './builds'
import type { Layer } from './canonical/types'
import type { ParityConfig, ParityEnv } from './config'
import {
  nextSeq,
  type RunContext,
  type StepError,
  type StepKind,
  type SubmitMode,
} from './context'
import { type SignerLabel, signer } from './fixtures'
import type { Tolerance } from './rules'
import { toPlain } from './serialize'

interface ScenarioContext {
  build: LoadedBuild
  env: ParityEnv
  run: RunContext
  chains: typeof chains
  sdk(overrides?: {
    apiKey?: string
    headers?: Record<string, string>
  }): SdkInstance
  signer(label: SignerLabel): LocalAccount
  step<T>(name: string, kind: StepKind, fn: () => Promise<T> | T): Promise<T>
}

interface Scenario {
  id: string
  description: string
  funded: boolean
  submitMode: SubmitMode
  goldenLayers: Layer[]
  // Pointer globs (`/<layer>/...`) left out of the golden.
  goldenIgnore?: string[]
  tolerances?: Record<string, Tolerance>
  accepted?: AcceptedDifference[]
  run(ctx: ScenarioContext): Promise<void>
}

type ScenarioInput = Omit<Scenario, 'funded' | 'submitMode'> & {
  funded?: boolean
  submitMode?: SubmitMode
}

function defineScenario(input: ScenarioInput): Scenario {
  const funded = input.funded ?? false
  return {
    ...input,
    funded,
    submitMode: input.submitMode ?? (funded ? 'live' : 'capture'),
  }
}

const recordedErrors = new WeakSet<object>()

function wasRecorded(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && recordedErrors.has(error)
  )
}

// Compared by constructor and name, never `instanceof`: the builds have
// distinct classes.
function describeError(error: unknown): StepError {
  if (!(error instanceof Object)) {
    return { name: 'NonError', ctor: typeof error, message: String(error) }
  }
  const value = error as Record<string, unknown>
  return {
    name: String(value.name ?? 'Error'),
    ctor: error.constructor?.name ?? 'Object',
    message: String(value.message ?? ''),
    errorType:
      typeof value.errorType === 'string' ? value.errorType : undefined,
    statusCode:
      typeof value.statusCode === 'number' ? value.statusCode : undefined,
    context: value.context === undefined ? undefined : toPlain(value.context),
  }
}

function createScenarioContext(
  build: LoadedBuild,
  run: RunContext,
  config: Pick<ParityConfig, 'apiKey' | 'env' | 'endpointUrl'>,
): ScenarioContext {
  return {
    build,
    env: config.env,
    run,
    chains,
    sdk(overrides) {
      return new build.root.RhinestoneSDK({
        apiKey: overrides?.apiKey ?? config.apiKey,
        ...(config.endpointUrl ? { endpointUrl: config.endpointUrl } : {}),
        ...(overrides?.headers ? { headers: overrides.headers } : {}),
      })
    },
    signer,
    async step(name, kind, fn) {
      const seq = nextSeq(run)
      run.step = name
      try {
        if (kind === 'wait' && run.submitMode === 'capture') {
          throw new Error(
            `Step "${name}" waits for execution, but submits are captured`,
          )
        }
        const value = await fn()
        run.records.steps.push({
          seq,
          name,
          kind,
          ok: true,
          value: toPlain(value),
        })
        return value
      } catch (error) {
        run.records.steps.push({
          seq,
          name,
          kind,
          ok: false,
          error: describeError(error),
        })
        if (typeof error === 'object' && error !== null)
          recordedErrors.add(error)
        throw error
      } finally {
        run.step = undefined
      }
    },
  }
}

export type { Scenario, ScenarioContext }
export { createScenarioContext, defineScenario, describeError, wasRecorded }
