// Mirrors the published `IntentFailedError` identity (constructor name and
// static message) so error observations stay stable across the cutover.
export class IntentFailedError extends Error {
  readonly intentId: string
  readonly operations: readonly unknown[]

  constructor(intentId: string, operations: readonly unknown[]) {
    super('Intent failed')
    this.intentId = intentId
    this.operations = operations
  }
}
