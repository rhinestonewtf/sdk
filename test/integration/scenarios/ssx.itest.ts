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

type ChainMode = 'same' | 'cross'
type Scope = 'unscoped' | 'scoped-single' | 'scoped-multi'

const chainModes: ChainMode[] = ['same', 'cross']
const scopes: Scope[] = ['unscoped', 'scoped-single', 'scoped-multi']

describe.sequential('SDK integration ssx', () => {
  // ENABLE mode on a fresh account: enable each session scope inline and use it
  // in one bundle. Exercises the enable payload, per-scope permission encoding,
  // dummy preclaim op, and dual signature end-to-end.
  for (const chainMode of chainModes) {
    for (const scope of scopes) {
      test(`enables a ${scope} session inline on a fresh ${chainMode}-chain account`, async () => {
        const account = await createSessionAccount()
        const sessionChain = getExecutionChain(chainMode)
        const session = createSession(scope, {
          chain: sessionChain,
          owner: createOwner(),
        })

        await expectSessionDisabled(account, session)

        const execution = await executeIntent({
          account,
          label: `ssx/${chainMode}/fresh/${scope}`,
          transaction: await addEnableData(
            account,
            session,
            createSessionTransaction(chainMode, { session }),
          ),
        })

        expectOutcome(execution, { kind: 'success' })
        if (execution.phase !== 'success') return

        expectNoFailedOperations(execution.status)
        expectCompletedOperation(execution.status, sessionChain.id)
        await expectDeployed(account, sessionChain)
        await expectSessionEnabled(account, session)
      })
    }
  }

  // USE mode: enable a session for real, then use it end-to-end. Proves the
  // enabled-session signing path settles on-chain.
  for (const chainMode of chainModes) {
    test(`uses a pre-enabled session on a ${chainMode}-chain account`, async () => {
      const account = await createSessionAccount()
      const sessionChain = getExecutionChain(chainMode)
      const session = createScopedSession({
        chain: sessionChain,
        owner: createOwner(),
      })

      await enableSession(
        account,
        session,
        chainMode,
        `ssx/${chainMode}/enable`,
      )

      const execution = await executeIntent({
        account,
        label: `ssx/${chainMode}/use`,
        transaction: createSessionTransaction(chainMode, { session }),
      })

      expectOutcome(execution, { kind: 'success' })
      if (execution.phase !== 'success') return

      expectNoFailedOperations(execution.status)
      expectCompletedOperation(execution.status, sessionChain.id)
      await expectSessionEnabled(account, session)
    })
  }

  test('rejects a session-signed call with wrong selector', async () => {
    await expectScopedCallRejected(createOutOfScopeCall(), 'wrong-selector')
  })

  test('rejects a session-signed call with wrong target', async () => {
    await expectScopedCallRejected(createWrongTargetCall(), 'wrong-target')
  })
})

async function expectScopedCallRejected(
  call: ReturnType<typeof createOutOfScopeCall>,
  label: string,
): Promise<void> {
  const account = await createSessionAccount()
  const session = createScopedSession({
    chain: sourceChain,
    owner: createOwner(),
  })

  await expectSessionDisabled(account, session)

  const execution = await executeIntent({
    account,
    label: `ssx/${label}/reject`,
    transaction: await addEnableData(account, session, {
      chain: sourceChain,
      sponsored: true,
      calls: [call],
      signers: { type: 'experimental_session', session },
    }),
  })

  expectOutcome(execution, {
    kind: 'submit-error',
    error: SimulationFailedError,
    code: 'SIMULATION_FAILED',
  })
  await expectNotDeployed(account, sourceChain)
}

function createSessionAccount() {
  return createIntegrationSDK().createAccount({
    owners: { type: 'ecdsa', accounts: [createOwner()] },
    experimental_sessions: { enabled: true },
  })
}

function createSession(
  scope: Scope,
  { chain, owner }: { chain: Chain; owner: ReturnType<typeof createOwner> },
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
    signers: { type: 'experimental_session' as const, session },
  }

  if (chainMode === 'cross') {
    return { ...base, sourceChains: [sourceChain], targetChain }
  }
  return { ...base, chain: sourceChain }
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
