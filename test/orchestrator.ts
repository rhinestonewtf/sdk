import { vi } from 'vitest'

export function createOrchestratorMock() {
  const mockOrchestrator = {
    getPortfolio: vi.fn().mockResolvedValue([]),
    getMaxTokenAmount: vi.fn().mockResolvedValue(1000000n),
    // TODO add mocks
  }

  return mockOrchestrator
}

// Setup the mock for the orchestrator module
export function setupOrchestratorMock() {
  vi.mock('../src/orchestrator', async (importOriginal) => {
    const actual = await importOriginal()

    return {
      // @ts-ignore
      ...actual,
      getOrchestrator: vi.fn().mockReturnValue(createOrchestratorMock()),
    }
  })
}
