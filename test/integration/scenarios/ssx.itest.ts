import type { Chain } from 'viem/chains'
import { describe, test } from 'vitest'
import { SimulationFailedError } from '../../../src/errors/index'
import type { RhinestoneAccount, Session } from '../../../src/index'
import { sourceChain, targetChain } from '../config/chains'
import { createIntegrationSDK } from '../config/environment'
import {
  expectDeployed,
  expectNotDeployed,
  expectSessionDisabled,
  expectSessionEnabled,
} from '../framework/assertions'
import {
  createMultiScopedSession,
  createNoopCall,
  createOutOfScopeCall,
  createOwner,
  createScopedSession,
  createUnscopedSession,
  createWrongTargetCall,
} from '../framework/fixtures'
import {
  executeIntent,
  expectCompletedOperation,
  expectNoFailedOperations,
  expectOutcome,
} from '../framework/runner'

type AccountState = 'fresh' | 'deployed' | 'enabled'
type ChainMode = 'same' | 'cross'
type Scope = 'unscoped' | 'scoped-single' | 'scoped-multi'

type MatrixCase = {
  accountState: AccountState
  chainMode: ChainMode
  scope: Scope
}

const matrixCases: MatrixCase[] = [
  ...flatMap(['fresh', 'deployed', 'enabled'] as const, (accountState) =>
    flatMap(['same', 'cross'] as const, (chainMode) =>
      (['unscoped', 'scoped-single', 'scoped-multi'] as const).map((scope) => ({
        accountState,
        chainMode,
        scope,
      })),
    ),
  ),
]

describe.sequential('SDK integration ssx', () => {
  for (const matrixCase of matrixCases) {
    const label = `ssx/${matrixCase.chainMode}/${matrixCase.accountState}/${matrixCase.scope}`

    test(`uses ${matrixCase.scope} session on ${matrixCase.accountState} ${matrixCase.chainMode}-chain account`, async () => {
      const sdk = createIntegrationSDK()
      const owner = createOwner()
      const sessionOwner = createOwner()
      const account = await sdk.createAccount({
        owners: { type: 'ecdsa', accounts: [owner] },
        experimental_sessions: { enabled: true },
      })
      const sessionChain = getExecutionChain(matrixCase.chainMode)
      const session = createSession(matrixCase.scope, {
        chain: sessionChain,
        owner: sessionOwner,
      })
      const transaction = createSessionTransaction(matrixCase.chainMode, {
        session,
      })

      if (matrixCase.accountState === 'deployed') {
        await deployAccount(account, matrixCase.chainMode, `${label}/deploy`)
      }

      if (matrixCase.accountState === 'enabled') {
        await enableSession(
          account,
          session,
          matrixCase.chainMode,
          `${label}/enable`,
        )
      } else {
        await expectSessionDisabled(account, session)
      }

      const execution = await executeIntent({
        account,
        label: `${label}/execute`,
        transaction:
          matrixCase.accountState === 'enabled'
            ? transaction
            : await addEnableData(account, session, transaction),
      })

      expectOutcome(execution, { kind: 'success' })
      if (execution.phase !== 'success') return

      expectNoFailedOperations(execution.status)
      expectCompletedOperation(execution.status, sessionChain.id)
      await expectDeployed(account, sessionChain)
      await expectSessionEnabled(account, session)
    })
  }

  test('rejects a session-signed call with wrong selector', async () => {
    const sdk = createIntegrationSDK()
    const owner = createOwner()
    const sessionOwner = createOwner()
    const account = await sdk.createAccount({
      owners: { type: 'ecdsa', accounts: [owner] },
      experimental_sessions: { enabled: true },
    })
    const session = createScopedSession({
      chain: sourceChain,
      owner: sessionOwner,
    })

    await expectSessionDisabled(account, session)

    const execution = await executeIntent({
      account,
      label: 'ssx/wrong-selector/submit-error',
      transaction: await addEnableData(account, session, {
        chain: sourceChain,
        sponsored: true,
        calls: [createOutOfScopeCall()],
        signers: {
          type: 'experimental_session',
          session,
        },
      }),
    })

    expectOutcome(execution, {
      kind: 'submit-error',
      error: SimulationFailedError,
      code: 'SIMULATION_FAILED',
    })
    await expectNotDeployed(account, sourceChain)
  })

  test('rejects a session-signed call with wrong target', async () => {
    const sdk = createIntegrationSDK()
    const owner = createOwner()
    const sessionOwner = createOwner()
    const account = await sdk.createAccount({
      owners: { type: 'ecdsa', accounts: [owner] },
      experimental_sessions: { enabled: true },
    })
    const session = createScopedSession({
      chain: sourceChain,
      owner: sessionOwner,
    })

    await expectSessionDisabled(account, session)

    const execution = await executeIntent({
      account,
      label: 'ssx/wrong-target/submit-error',
      transaction: await addEnableData(account, session, {
        chain: sourceChain,
        sponsored: true,
        calls: [createWrongTargetCall()],
        signers: {
          type: 'experimental_session',
          session,
        },
      }),
    })

    expectOutcome(execution, {
      kind: 'submit-error',
      error: SimulationFailedError,
      code: 'SIMULATION_FAILED',
    })
    await expectNotDeployed(account, sourceChain)
  })
})

function flatMap<T, U>(
  values: readonly T[],
  mapper: (value: T) => readonly U[],
): U[] {
  return values.flatMap((value) => mapper(value))
}

function createSession(
  scope: Scope,
  {
    chain,
    owner,
  }: {
    chain: Chain
    owner: ReturnType<typeof createOwner>
  },
): Session {
  if (scope === 'unscoped') return createUnscopedSession({ chain, owner })
  if (scope === 'scoped-multi')
    return createMultiScopedSession({ chain, owner })
  return createScopedSession({ chain, owner })
}

function getExecutionChain(chainMode: ChainMode): Chain {
  return chainMode === 'cross' ? targetChain : sourceChain
}

function createSessionTransaction(
  chainMode: ChainMode,
  { session }: { session: Session },
) {
  const base = {
    sponsored: true,
    calls: [createNoopCall()],
    signers: {
      type: 'experimental_session' as const,
      session,
    },
  }

  if (chainMode === 'cross') {
    return {
      ...base,
      sourceChains: [sourceChain],
      targetChain,
    }
  }

  return {
    ...base,
    chain: sourceChain,
  }
}

async function addEnableData(
  account: RhinestoneAccount,
  session: Session,
  transaction: ReturnType<typeof createSessionTransaction>,
): Promise<ReturnType<typeof createSessionTransaction>> {
  const sessionDetails = await account.experimental_getSessionDetails([session])
  const enableSignature =
    await account.experimental_signEnableSession(sessionDetails)

  return {
    ...transaction,
    signers: {
      ...transaction.signers,
      enableData: {
        userSignature: enableSignature,
        hashesAndChainIds: sessionDetails.hashesAndChainIds,
        sessionToEnableIndex: 0,
      },
    },
  }
}

async function deployAccount(
  account: RhinestoneAccount,
  chainMode: ChainMode,
  label: string,
): Promise<void> {
  const transaction =
    chainMode === 'cross'
      ? {
          sourceChains: [sourceChain],
          targetChain,
          sponsored: true,
          calls: [createNoopCall()],
        }
      : {
          chain: sourceChain,
          sponsored: true,
          calls: [createNoopCall()],
        }
  const execution = await executeIntent({ account, label, transaction })
  expectOutcome(execution, { kind: 'success' })
  if (execution.phase !== 'success') return

  expectNoFailedOperations(execution.status)
  expectCompletedOperation(execution.status, getExecutionChain(chainMode).id)
  await expectDeployed(account, getExecutionChain(chainMode))
}

async function enableSession(
  account: RhinestoneAccount,
  session: Session,
  chainMode: ChainMode,
  label: string,
): Promise<void> {
  await expectSessionDisabled(account, session)

  const execution = await executeIntent({
    account,
    label,
    transaction: await addEnableData(
      account,
      session,
      createSessionTransaction(chainMode, { session }),
    ),
  })

  expectOutcome(execution, { kind: 'success' })
  if (execution.phase !== 'success') return

  expectNoFailedOperations(execution.status)
  expectCompletedOperation(execution.status, getExecutionChain(chainMode).id)
  await expectSessionEnabled(account, session)
}
