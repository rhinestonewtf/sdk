import { describe, expect, test } from 'vitest'
import { Orchestrator } from './client'
import { OrchestratorError, UnsupportedChainError } from './error'

const orchestrator = new Orchestrator('https://orchestrator.example', {
  getHeaders: async () => ({}),
  getSubmitHeaders: async () => ({}),
})

const parseErrorMessage = (message: string): never =>
  (
    orchestrator as unknown as {
      parseErrorMessage: (message: string, params: unknown) => never
    }
  ).parseErrorMessage(message, {})

describe('Orchestrator error parsing', () => {
  test('does not partially parse malformed unsupported chain ids', () => {
    expect(() => parseErrorMessage('Unsupported chain 8453abc')).toThrow(
      OrchestratorError,
    )
    expect(() => parseErrorMessage('Unsupported chain 8453abc')).not.toThrow(
      UnsupportedChainError,
    )
  })

  test('keeps parsing valid unsupported chain ids', () => {
    expect(() => parseErrorMessage('Unsupported chain 8453')).toThrow(
      'Unsupported chain 8453',
    )
    expect(() => parseErrorMessage('Unsupported chain 8453')).toThrow(
      UnsupportedChainError,
    )
  })
})
