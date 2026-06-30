# Testing

The SDK has three test layers: fast unit tests, compile-time type tests, and
live integration tests that exercise real flows against the orchestrator on
testnets.

## Layers

| Layer       | Files                          | Runs against | Command                       |
| ----------- | ------------------------------ | ------------ | ----------------------------- |
| Unit        | `src/**/*.test.ts`             | nothing live | `bun run test`                |
| Type        | `test/types/**`                | `tsc` only   | `bun run test:types`          |
| Integration | `test/integration/**/*.itest.ts` | live orchestrator + testnets | `bun run test:integration` |

Unit tests live next to the source they cover. Type tests assert the public
surface compiles as intended (`tsconfig.type-tests.json`). Run a single file
with `bun run test -- path/to/file.test.ts`.

## Integration tests

Live SDK flows against the production orchestrator on testnets. Manual for now —
not in CI. Specs are `*.itest.ts` under `test/integration/scenarios/` and run
via `vitest.config.integration.ts` (180s timeouts, no file parallelism).

### Environment

| Var                            | Purpose                                                    | Required           |
| ------------------------------ | ---------------------------------------------------------- | ------------------ |
| `INTEGRATION_RHINESTONE_API_KEY` | Orchestrator API key                                     | always             |
| `INTEGRATION_FUNDER_PRIVATE_KEY` | Key whose address holds testnet native + USDC             | funded specs only  |
| `INTEGRATION_ORCHESTRATOR_URL`   | Override the orchestrator endpoint (omit → SDK default, prod) | no             |
| `INTEGRATION_USE_DEV_CONTRACTS`  | Force dev contracts (`true`); otherwise inferred from the URL | no             |

Funded specs (smart-session policies, on-chain source-call execution) fail fast
with an actionable message when `INTEGRATION_FUNDER_PRIVATE_KEY` is missing.

### Running

```bash
# Smoke suite (no funder needed)
INTEGRATION_RHINESTONE_API_KEY=... bun run test:integration:smoke

# Every scenario (needs a funder)
INTEGRATION_RHINESTONE_API_KEY=... INTEGRATION_FUNDER_PRIVATE_KEY=... \
  bun run test:integration -- --run

# Verbose per-intent diagnostics
SDK_ITEST_DEBUG=1 bun run test:integration:smoke      # or test:integration:smoke:debug
```

Unexpected failures print compact diagnostics by default: phase, duration,
intent id, settlement layer, trace id, transaction result, operation summaries,
and any URLs in the error payload.

### Framework

`test/integration/framework/` provides the shared harness so scenarios stay
declarative:

- `runner.ts` — `executeIntent` drives a flow in `sign` / `dryRun` / `execute`
  mode and `expectOutcome` asserts the terminal state.
- `fixtures.ts` — owners, no-op calls, USDC requests, and session builders.
- `funding.ts` — `ensureFunded` tops up the funder before funded specs; fails
  fast on insufficient balance.
- `signatures.ts` — signature-mode classification and tampering helpers.
- `assertions.ts` — onchain checks (`expectDeployed`, `expectSessionEnabled`, …).

Config lives in `test/integration/config/` (`environment.ts` for env access,
`chains.ts` for the testnet set).

### Coverage

Smoke suite: sponsored same-chain and cross-chain execution, inline
smart-session enablement, submit-time simulation failure, and deployed-account
reuse. The fuller set adds account kinds, signature modes, smart-session scope
and policy enforcement, preclaim source calls, and 7702 / unsupported-route
error cases.
