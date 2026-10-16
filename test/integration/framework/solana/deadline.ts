import { pollSolana } from './rpc'

// A raced SDK deployment can still resume after the caller times out. Revoke
// its transport permanently so neither late responses nor later writes escape.
export class SolanaRequestScope {
  private readonly controller = new AbortController()

  fetch(fetcher: typeof fetch): typeof fetch {
    return (async (input, init) => {
      const signal = AbortSignal.any([
        this.controller.signal,
        ...(input instanceof Request ? [input.signal] : []),
        ...(init?.signal ? [init.signal] : []),
      ])
      signal.throwIfAborted()
      const response = await fetcher(input, { ...init, signal })
      signal.throwIfAborted()
      return response
    }) as typeof fetch
  }

  assertActive() {
    this.controller.signal.throwIfAborted()
  }

  async wait<T>(run: () => Promise<T>, timeoutMs = 60_000): Promise<T> {
    this.assertActive()
    try {
      return await pollSolana(run, () => true, { timeoutMs })
    } catch (error) {
      this.controller.abort(new Error('Solana fixture requests revoked'))
      throw error
    }
  }
}
