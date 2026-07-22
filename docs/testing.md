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
  (`test/contract/fixtures/consumer.ts`);
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

Integration tests exercise live testnets. Unless
`INTEGRATION_ORCHESTRATOR_URL` is set, they use the SDK's built-in production
orchestrator URL. They run manually through `vitest.config.integration.ts`
with file parallelism disabled.

### Environment

| Variable                         | Purpose                                              | Required          |
| -------------------------------- | ---------------------------------------------------- | ----------------- |
| `INTEGRATION_RHINESTONE_API_KEY` | Orchestrator API key                                 | Always            |
| `INTEGRATION_FUNDER_PRIVATE_KEY` | Testnet funder holding native tokens and USDC        | Funded scenarios  |
| `INTEGRATION_ORCHESTRATOR_URL`   | Orchestrator endpoint override                       | No                |
| `INTEGRATION_USE_DEV_CONTRACTS`  | Use development contract addresses when `true`       | No                |
| `SDK_ITEST_DEBUG`                | Compact per-intent diagnostics when `1`              | No                |

Funded scenarios fail fast when the funder is absent or has insufficient
balance. A custom orchestrator URL also enables development contract addresses;
`INTEGRATION_USE_DEV_CONTRACTS=true` can enable them explicitly. With neither
setting, the SDK uses its production endpoint and production contracts.

### Running

```bash
# Smoke suite; no funder required. Uses the SDK's production endpoint by default.
INTEGRATION_RHINESTONE_API_KEY=... \
bun run test:integration:smoke

# Full integration suite against a custom orchestrator.
INTEGRATION_ORCHESTRATOR_URL=https://dev.v1.orchestrator.rhinestone.dev \
INTEGRATION_RHINESTONE_API_KEY=... \
INTEGRATION_FUNDER_PRIVATE_KEY=... \
bun run test:integration -- --run

# Compact per-intent diagnostics.
SDK_ITEST_DEBUG=1 bun run test:integration:smoke
```

`test/integration/framework/` owns execution, funding, signature assertions,
and reusable fixtures. Configuration lives in `test/integration/config/`.

### Credentials

Keep local credentials in the ignored `.env` file as `op://` references. Do not
paste resolved values into commands or logs.

```bash
export OP_SHIM_KEY=...
op run --env-file=.env -- bun run test:integration:smoke
```

If `OP_SHIM_KEY` is absent, ask for it and export it for the current shell only.
Never write it to disk.
