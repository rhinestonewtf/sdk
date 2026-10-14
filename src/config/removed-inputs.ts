export function assertNoRemovedApiKey(input: object): void {
  if ('apiKey' in input) {
    throw new Error(
      "Top-level `apiKey` was removed; use auth: { mode: 'apiKey', apiKey } instead",
    )
  }
}

export function assertSdkAuthInput(input: object & { auth?: unknown }): void {
  assertNoRemovedApiKey(input)
  if (!input.auth) {
    throw new Error('RhinestoneSDK requires `auth` in config')
  }
}
