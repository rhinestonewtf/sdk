import { loadBuild, type SdkInstance } from '../builds'
import type { ParityConfig } from '../config'
import { chainReader, providerOverride } from './chain'
import { FIXTURES, sessionConfig } from './fixtures'
import {
  checkSteady,
  type FixtureBalance,
  type FixtureUse,
  readBalances,
  requiredBalances,
  type SteadyCheck,
} from './preflight'

// The on-chain and status reads the runner needs around funded scenarios.
// Everything here runs outside a run context, so nothing is recorded.
interface FundedEnv {
  balances(
    uses: readonly FixtureUse[],
    sides: number,
  ): Promise<FixtureBalance[]>
  steady(checks: readonly SteadyCheck[]): Promise<string[]>
  intentStatus(intentId: string): Promise<string>
  // A published-build SDK for unrecorded reads in hooks.
  sdk(): Promise<SdkInstance>
  settleIntervalMs?: number
}

function liveFundedEnv(
  config: Pick<ParityConfig, 'apiKey' | 'endpointUrl'>,
): FundedEnv {
  let sdk: Promise<SdkInstance> | undefined
  // The published build reads status and session state for either side.
  const published = () => {
    sdk ??= loadBuild('published').then((build) => {
      const provider = providerOverride()
      return new build.root.RhinestoneSDK({
        apiKey: config.apiKey,
        ...(config.endpointUrl ? { endpointUrl: config.endpointUrl } : {}),
        ...(provider ? { provider } : {}),
      })
    })
    return sdk
  }
  return {
    sdk: published,
    balances(uses, sides) {
      return readBalances(requiredBalances(uses, sides), chainReader)
    },
    steady(checks) {
      return checkSteady(checks, {
        hasCode: chainReader.hasCode,
        allowance: chainReader.allowance,
        async sessionEnabled(fixture, session) {
          const account = await (await published()).createAccount(
            FIXTURES[fixture].config(),
          )
          return account.experimental_isSessionEnabled(sessionConfig(session))
        },
      })
    },
    async intentStatus(intentId) {
      const status = (await (
        await published()
      ).getIntentStatus(BigInt(intentId))) as { status?: string }
      return String(status?.status ?? 'UNKNOWN')
    },
  }
}

export type { FundedEnv }
export { liveFundedEnv }
