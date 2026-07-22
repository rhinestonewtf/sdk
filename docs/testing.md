# Testing

This guide covers the SDK test layers, how to run them, and the live
integration setup.

## Layers

| Layer              | Files                                 | Runs against                       | Command                      |
| ------------------ | ------------------------------------- | ---------------------------------- | ---------------------------- |
| Unit and vectors   | `src/**/*.test.ts`, `test/vectors/**` | Local code and deterministic fakes | `bun run test`               |
| Pure-core coverage | Rewritten core and pure adapters      | V8 coverage with scoped thresholds | `bun run test:coverage:pure` |
| Architecture       | Production imports                    | Dependency and cycle rules         | `bun run check:architecture` |
| Typecheck           | Source, unit tests, and test harnesses | TypeScript                         | `bun run typecheck`          |
| Public types        | `test/types/**`                       | Consumer-facing compile fixtures   | `bun run test:types`         |
| Package contract   | `test/contract/**/*.ctest.ts`         | Packed release and current packages | `bun run test:contract`      |
| Integration        | `test/integration/**/*.itest.ts`      | Live orchestrator and testnets     | `bun run test:integration`   |

Unit tests live next to the source they cover. Vectors under `test/vectors/`
pin exact addresses, hashes, and init data for shipped code. The main
`bun run typecheck` command covers production source, colocated unit tests, and
the integration harness without executing live scenarios. Public type fixtures
run separately through `tsconfig.type-tests.json`. Run one unit file with
`bun run test -- path/to/file.test.ts`.

The pure-core gate requires 95% statements, lines, and functions and 90%
branches. Contract-only files are excluded. The architecture check rejects
forbidden layer edges, concrete-client imports, published-barrel imports, and
cycles.

## Package contract

`bun run test:contract` builds and packs both `origin/release` and the current
worktree, then stages isolated consumer projects against both tarballs. Set
`SDK_CONTRACT_BASE_SHA` to compare against a specific release commit; CI pins it
to the pull request's base SHA and installs that commit's frozen dependencies.
Local runs reuse the existing dependency installation so the comparison remains
offline. The command validates:

- every published subpath resolves, its declaration file exists, and its runtime
  export keys match the packed release package;
- semantic declaration reports and bidirectional assignability match the packed
  release declarations;
- representative consumer projects type-check configurations, selected root
  APIs, and every published subpath against both packages
  (`test/contract/fixtures/consumer.ts`). Type-only root exports must be imported
  here explicitly because runtime export-key checks cannot observe them;
- compatibility probes preserve address-only init data, legacy module shapes,
  and public error identity;
- optional-peer behavior — the root imports without `jose`/`express`, and
  `/jwt-server` works without `express` but fails cleanly without `jose`;
- public error constructor identity survives across the package boundary;
- `publint` metadata validity;
- the per-entry `size-limit` gate for every published subpath.

The suite runs through `scripts/contract/run.ts`, which owns the build, pack,
consumer staging, and size run; `vitest.config.contract.ts` only discovers the
`*.ctest.ts` assertions and requires the staged environment.

## Integration tests

Integration tests exercise Base Sepolia as the source chain and Arbitrum
Sepolia as the target chain. Unless `INTEGRATION_ORCHESTRATOR_URL` is set, they
use the SDK's built-in production orchestrator URL and production contract
addresses. They run manually through `vitest.config.integration.ts`, with file
parallelism disabled and five-minute test and hook timeouts.

The smoke suite validates an unfunded sponsored flow. The full suite covers the
account adapters, supported-chain queries, EIP-7702, failure behavior,
pre-claim operations, signature modes, Smart Sessions, and session policies.
Some full-suite scenarios move testnet native tokens or USDC and therefore need
the funder key.

### Environment

| Variable                         | Purpose                                              | Required          |
| -------------------------------- | ---------------------------------------------------- | ----------------- |
| `INTEGRATION_RHINESTONE_API_KEY` | Orchestrator API key                                 | Always            |
| `INTEGRATION_FUNDER_PRIVATE_KEY` | Testnet funder holding native tokens and USDC        | Funded scenarios  |
| `INTEGRATION_ORCHESTRATOR_URL`   | Orchestrator endpoint override                       | No                |
| `INTEGRATION_USE_DEV_CONTRACTS`  | Use development contract addresses when `true`       | No                |
| `INTEGRATION_RPC_URL_<CHAIN_ID>` | Per-chain RPC override for funding operations        | No                |
| `SDK_ITEST_DEBUG`                | Compact per-intent diagnostics when `1`              | No                |

The API key must belong to the selected orchestrator environment; using a dev
key against production, or the reverse, returns HTTP 403. A custom orchestrator
URL also enables development contract addresses;
`INTEGRATION_USE_DEV_CONTRACTS=true` can enable them explicitly. With neither
setting, the SDK uses its production endpoint and production contracts.

Funded scenarios fail immediately when the key is absent or the funder cannot
cover a required top-up. After an onchain USDC transfer confirms, the harness
also waits for the orchestrator portfolio view to observe the balance before it
submits the intent. Indexer or public-RPC latency can therefore consume most of
the five-minute test timeout. A timeout during funding or portfolio polling is
an infrastructure/setup failure, not necessarily a failed SDK assertion.

### Running

```bash
# Smoke suite against the production orchestrator and testnets; no funder required.
op run --env-file=.env -- bun run test:integration:smoke -- --run

# Full suite against the production orchestrator and testnets.
op run --env-file=.env -- bun run test:integration -- --run

# Run one scenario or test while investigating a failure.
op run --env-file=.env -- bun run test:integration -- --run \
  test/integration/scenarios/ssx-policies.itest.ts -t "allowlisted"

# Compact per-intent diagnostics.
SDK_ITEST_DEBUG=1 op run --env-file=.env -- \
  bun run test:integration:smoke -- --run
```

`test/integration/framework/` owns execution, funding, signature assertions,
and reusable fixtures. Configuration lives in `test/integration/config/`.

### GitHub Actions

The `Integration Tests` workflow is manual and serializes live runs through the
`live-integration-tests` concurrency group. Choose `suite=smoke` or `suite=all`
and `target=prod` or `target=dev`. The job has a 30-minute timeout and resolves
the environment-specific API key before executing the selected suite.

```bash
gh workflow run integration-tests.yaml -f suite=all -f target=prod
```

For `target=prod`, the workflow leaves the endpoint override empty so the SDK
uses its built-in production URL and contracts. For `target=dev`, it supplies
the development URL, which also enables development contract addresses.

### Credentials

Keep local credentials in the ignored `.env` file as `op://` references. Do not
paste resolved values into commands or logs.

```bash
export OP_SHIM_KEY=...
op run --env-file=.env -- bun run test:integration:smoke -- --run
```

If `OP_SHIM_KEY` is absent, ask for it and export it for the current shell only.
Never write it to disk.
