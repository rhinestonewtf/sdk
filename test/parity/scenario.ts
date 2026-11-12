import type { LocalAccount } from 'viem'
import type { WebAuthnAccount } from 'viem/account-abstraction'
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
import { passkey, type SignerLabel, signer } from './fixtures'
import type { Tolerance } from './rules'
import { toPlain } from './serialize'

interface ScenarioContext {
  build: LoadedBuild
  env: ParityEnv
  chains: typeof chains
  // `auth` replaces the API key; an empty `apiKey` stays empty.
  sdk(overrides?: { apiKey?: string; auth?: unknown }): SdkInstance
  signer(label: SignerLabel): LocalAccount
  passkey(): WebAuthnAccount
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

// A defect in the scenario or harness rather than an SDK outcome; it fails the
// run even when both sides record it identically.
class HarnessError extends Error {
  override name = 'HarnessError'
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
    chains,
    sdk(overrides) {
      const endpoint = config.endpointUrl
        ? { endpointUrl: config.endpointUrl }
        : {}
      if (overrides?.auth !== undefined) {
        return new build.root.RhinestoneSDK({
          auth: overrides.auth,
          ...endpoint,
        })
      }
      return new build.root.RhinestoneSDK({
        apiKey: overrides?.apiKey ?? config.apiKey,
        ...endpoint,
      })
    },
    signer,
    passkey,
    async step(name, kind, fn) {
      const seq = nextSeq(run)
      run.step = name
      try {
        if (kind === 'wait' && run.submitMode === 'capture') {
          throw new HarnessError(
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
          ...(error instanceof HarnessError ? { harness: true as const } : {}),
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
export {
  createScenarioContext,
  defineScenario,
  describeError,
  HarnessError,
  wasRecorded,
}
