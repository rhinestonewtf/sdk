// Property suites run on a fixed seed so a counterexample reproduces on any
// host. `SDK_PROPERTY_SEED` and `SDK_PROPERTY_RUNS` are exploration overrides —
// never commit a configuration that depends on them.
const DEFAULT_SEED = 0x5d4c3b2a
const DEFAULT_RUNS = 100

interface PropertyParameters {
  readonly seed: number
  readonly numRuns: number
  readonly verbose: boolean
}

function propertyParameters(
  overrides: Partial<PropertyParameters> = {},
): PropertyParameters {
  return {
    seed: Number(process.env.SDK_PROPERTY_SEED ?? DEFAULT_SEED),
    numRuns: Number(process.env.SDK_PROPERTY_RUNS ?? DEFAULT_RUNS),
    verbose: true,
    ...overrides,
  }
}

export { propertyParameters }
