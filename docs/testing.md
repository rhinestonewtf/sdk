# Testing

This guide covers the SDK test layers, how to run them, and the live
integration setup.

## Layers

| Layer              | Files                                 | Runs against                       | Command                      |
| ------------------ | ------------------------------------- | ---------------------------------- | ---------------------------- |
| Unit and vectors   | `src/**/*.test.ts`, `test/vectors/**` | Local code and deterministic fakes | `bun run test`               |
| Pure-core coverage | Rewritten core domains                | V8 coverage with scoped thresholds | `bun run test:coverage:core` |
| Architecture       | Production imports                    | Dependency and cycle rules         | `bun run check:architecture` |
| Type               | `test/types/**`                       | TypeScript                         | `bun run test:types`         |
| Package contract   | `test/contract/**/*.ctest.ts`         | Packed current package             | `bun run test:contract`      |
| Integration        | `test/integration/**/*.itest.ts`      | Live orchestrator and testnets     | `bun run test:integration`   |

Unit tests live next to the source they cover. Vectors under `test/vectors/`
pin exact addresses, hashes, and init data for shipped code. Type tests assert
the public surface with `tsconfig.type-tests.json`. Run one unit file with
`bun run test -- path/to/file.test.ts`.

The pure-core gate requires 95% statements, lines, and functions and 90%
branches. Contract-only files are excluded. The architecture check rejects
forbidden layer edges, concrete-client imports, published-barrel imports, and
cycles.

## Package contract

`bun run test:contract` cleans, builds, and packs the current package, then
stages consumer projects against the packed tarball. It validates:

- every published subpath resolves and its declaration/runtime export set
  matches the calibrated snapshot (`test/contract/snapshots/release-package.json`);
- a consumer project type-checks against the packed types
  (`test/contract/fixtures/consumer.ts`);
- optional-peer behavior — the root imports without `jose`/`express`, and
  `/jwt-server` works without `express` but fails cleanly without `jose`;
- public error constructor identity survives across the package boundary;
- `publint` metadata validity;
- the per-entry `size-limit` gate for every published subpath.

The suite runs through `scripts/contract/run.ts`, which owns the build, pack,
consumer staging, and size run; `vitest.config.contract.ts` only discovers the
`*.ctest.ts` assertions and requires the staged environment.

## Integration tests

Integration tests exercise the dev orchestrator on testnets by default. They
run manually through `vitest.config.integration.ts` with file parallelism
disabled.

### Environment

| Variable                         | Purpose                                              | Required          |
| -------------------------------- | ---------------------------------------------------- | ----------------- |
| `INTEGRATION_TARGET`             | `dev` by default; `prod` requires explicit selection | No                |
| `INTEGRATION_RHINESTONE_API_KEY` | Orchestrator API key                                 | Always            |
| `INTEGRATION_FUNDER_PRIVATE_KEY` | Testnet funder holding native tokens and USDC        | Funded scenarios  |
| `INTEGRATION_ORCHESTRATOR_URL`   | Orchestrator endpoint override                       | No                |
| `INTEGRATION_USE_DEV_CONTRACTS`  | Use development contract addresses when `true`       | No                |
| `SDK_ITEST_DEBUG`                | Compact per-intent diagnostics when `1`              | No                |

Funded scenarios fail fast when the funder is absent or has insufficient
balance. The harness selects `https://dev.v1.orchestrator.rhinestone.dev` and
development contracts when `INTEGRATION_TARGET` is unset. It rejects the
production URL unless `INTEGRATION_TARGET=prod` is set explicitly; missing dev
configuration never falls back to prod.

### Running

```bash
# Smoke suite; no funder required.
INTEGRATION_TARGET=dev \
INTEGRATION_RHINESTONE_API_KEY=... \
bun run test:integration:smoke

# Full integration suite.
INTEGRATION_TARGET=dev \
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
