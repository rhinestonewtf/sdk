import type { CoreDependencies } from '../../src/api/compose'

export interface PendingCompositionHarness {
  readonly status: 'contracts-only'
  readonly dependencies: CoreDependencies
  readonly factory?: never
}

const pending = async (): Promise<never> => {
  throw new Error('Rewrite composition is not runnable before Commit 6')
}

export function createPendingCompositionHarness(): PendingCompositionHarness {
  return {
    status: 'contracts-only',
    dependencies: {
      orchestrator: {
        createQuote: pending,
        submitIntent: pending,
        getIntentStatus: pending,
        splitIntents: pending,
        getPortfolio: pending,
        getAppFeeBalances: pending,
      },
      rpc: {
        forChain: () => ({
          getCode: pending,
          readContract: pending,
          multicall: pending,
        }),
      },
      bundler: {
        send: pending,
        getReceipt: pending,
      },
      paymaster: { sponsor: pending },
      signerInvoker: { invoke: pending },
      clock: {
        now: () => 0,
        sleep: pending,
      },
    },
  }
}
