import { type Hex, type LocalAccount, toHex } from 'viem'
import type { WebAuthnAccount } from 'viem/account-abstraction'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
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
import { providerOverride } from './funded/chain'
import type { FixtureUse, SteadyCheck } from './funded/preflight'
import { usesFor } from './funded/spend'
import type { Tolerance } from './rules'
import { toPlain } from './serialize'
import { recordingAccount } from './signers'

interface ScenarioContext {
  build: LoadedBuild
  env: ParityEnv
  chains: typeof chains
  // `auth` replaces the API key; an empty `apiKey` stays empty.
  sdk(overrides?: { apiKey?: string; auth?: unknown }): SdkInstance
  signer(label: SignerLabel): LocalAccount
  passkey(): WebAuthnAccount
  step<T>(name: string, kind: StepKind, fn: () => Promise<T> | T): Promise<T>
  // Unix seconds at the start of the iteration, shared by both sides.
  clock: number
  // Registers a value that differs per side by construction; every layer
  // shows it as `<id:label>`.
  identity(label: string, value: Hex): void
  // A fresh key per side, registered as an identity by its address.
  ephemeralSigner(label: string): LocalAccount
  // A fresh 32-byte value per side, registered as an identity.
  ephemeralSalt(label: string): Hex
}

// What a funded scenario expects of its live submits: every intent completes,
// every submit is refused or its intent fails, or there is nothing to submit.
type ExecutionExpectation = 'complete' | 'reject' | 'none'

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
  // Funded only: per-side spend (default: funded/spend.ts), the steady state
  // a warm-up settles, a reset run before every side, and what the live
  // submits must achieve.
  fixtures?: FixtureUse[]
  steady?: SteadyCheck[]
  beforeSide?(env: { sdk: SdkInstance }): Promise<void>
  execution?: ExecutionExpectation
  // A different first warm-up, for state `run` itself cannot settle; `run`
  // follows as a second warm-up if the fixture is still not steady.
  warmUp?(ctx: ScenarioContext): Promise<void>
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
    execution: input.execution ?? (funded ? 'complete' : undefined),
    fixtures: input.fixtures ?? (funded ? usesFor(input.id) : undefined),
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
  clock: number = Math.floor(Date.now() / 1000),
): ScenarioContext {
  const identities = (run.records.identities ??= [])
  const identity = (label: string, value: Hex) => {
    identities.push({ label, value: value.toLowerCase() })
  }
  return {
    build,
    env: config.env,
    chains,
    sdk(overrides) {
      const provider = providerOverride()
      const shared = {
        ...(config.endpointUrl ? { endpointUrl: config.endpointUrl } : {}),
        ...(provider ? { provider } : {}),
      }
      if (overrides?.auth !== undefined) {
        return new build.root.RhinestoneSDK({
          auth: overrides.auth,
          ...shared,
        })
      }
      return new build.root.RhinestoneSDK({
        apiKey: overrides?.apiKey ?? config.apiKey,
        ...shared,
      })
    },
    signer,
    passkey,
    clock,
    identity,
    ephemeralSigner(label) {
      const account = privateKeyToAccount(generatePrivateKey())
      identities.push({
        label,
        value: account.address.toLowerCase(),
        signer: true,
      })
      return recordingAccount(account, label)
    },
    ephemeralSalt(label) {
      const salt = toHex(crypto.getRandomValues(new Uint8Array(32)))
      identity(label, salt)
      return salt
    },
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

export type { ExecutionExpectation, Scenario, ScenarioContext }
export {
  createScenarioContext,
  defineScenario,
  describeError,
  HarnessError,
  wasRecorded,
}
