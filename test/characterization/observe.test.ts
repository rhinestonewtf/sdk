import { describe, expect, it } from 'vitest'
import {
  createModeObservation,
  failedOutcome,
  observeError,
  successfulOutcome,
} from './observe'

describe('characterization observations', () => {
  it('captures stable error identity, phase, code, status, and cause', () => {
    class SignerUnavailableError extends Error {
      code = 'MISSING_SIGNER'
      statusCode = 422
    }
    const cause = new TypeError('owner was not registered')
    const error = new SignerUnavailableError('cannot sign', { cause })

    expect(observeError(error, 'sign')).toEqual({
      phase: 'sign',
      class: 'SignerUnavailableError',
      name: 'Error',
      message: 'cannot sign',
      code: 'MISSING_SIGNER',
      status: 422,
      cause: {
        phase: 'sign',
        class: 'TypeError',
        name: 'TypeError',
        message: 'owner was not registered',
      },
    })
  })

  it('structures non-Error throws rather than dropping their identity', () => {
    expect(observeError('transport unavailable', 'submit')).toEqual({
      phase: 'submit',
      class: 'string',
      name: 'NonErrorThrow',
      message: 'transport unavailable',
    })
  })

  it('creates discriminated observations for each execution mode', () => {
    const context = {
      scenarioId: 'intent.safe.sign',
      workflow: 'intent' as const,
      subject: 'legacy' as const,
      runId: 'run-1',
      comparisonGroup: 'group-1',
    }

    const sign = createModeObservation(
      context,
      {
        mode: 'sign',
        sign: { prepared: { kind: 'intent' }, artifacts: ['0x1234'] },
      },
      successfulOutcome(),
    )
    const dryRun = createModeObservation(
      context,
      {
        mode: 'dryRun',
        sign: { prepared: { kind: 'intent' } },
        simulation: { success: true },
      },
      successfulOutcome(),
    )
    const execute = createModeObservation(
      context,
      {
        mode: 'execute',
        sign: { prepared: { kind: 'intent' } },
        execution: { terminalState: 'completed' },
      },
      failedOutcome(new Error('receipt timed out'), 'wait'),
    )

    expect(sign).toMatchObject({ schemaVersion: 1, mode: 'sign' })
    expect(dryRun).toMatchObject({
      schemaVersion: 1,
      mode: 'dryRun',
      simulation: { success: true },
    })
    expect(execute).toMatchObject({
      schemaVersion: 1,
      mode: 'execute',
      outcome: { status: 'failure', error: { phase: 'wait' } },
    })
  })
})
