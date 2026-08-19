# Testing

This guide covers the SDK test layers, how to run them, and the live
integration setup.

## Layers

| Layer              | Files                                 | Runs against                       | Command                      |
| ------------------ | ------------------------------------- | ---------------------------------- | ---------------------------- |
| Unit and vectors   | `src/**/*.test.ts`, `test/vectors/**` | Local code and deterministic fakes | `bun run test`               |
| Pure-core coverage | Rewritten core and pure adapters      | V8 coverage with scoped thresholds | `bun run test:coverage:pure` |
| Architecture       | Production imports                    | Dependency, cycle, and host-independence rules | `bun run check:architecture` |
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

## Address derivation vectors

`test/vectors/accounts/` guards the promise that a configuration always derives
the same account address — an address change orphans already deployed accounts,
so it must never happen by accident.

`matrix.ts` enumerates one case per address-affecting axis: every account type
with every owner type, account variants (adapter, version, salt, nonce, custom
factory), owner variants (multi-owner, thresholds, module overrides,
multi-factor, ENS), sessions, recovery, custom modules, caller-pinned init data,
EOA and EIP-7702 accounts, and the legacy v0 reconstruction path. Each case pins
`address`, `factory`, and the `factoryData` hash in `account-deployment.json`;
cases that only pass an address through pin the address alone. Both derivation
drivers run — the public API (`createAccount`) and the adapter deployment plan —
and the suite also asserts that the matrix and the baseline cover exactly the
same case ids, so coverage cannot shrink silently. `useDevContracts`
configurations are excluded: dev module addresses are redeployable and not part
of the compatibility promise.

Baseline values are calibrated against the published release recorded in
`source`. A case whose value deliberately differs from that release carries a
`deliberateChange` note naming the release sha and the reason.

To record a deliberate change, run `bun run vectors:generate` — it rewrites the
baseline from the current checkout, carries over `source` and existing
`deliberateChange` notes, and prints the cases whose values moved. Add a
`deliberateChange` note for each of them and a changeset describing the change.
To recalibrate against another ref, add a worktree of it, symlink
`node_modules`, copy `test/vectors/accounts/{matrix,derive}.ts`,
`test/consts.ts` and `scripts/vectors/generate.ts` into it, and run the
generator there with `SDK_VECTORS_OUT` pointing at this checkout's baseline.

## Package contract

`bun run test:contract` builds and packs both `origin/release` and the current
worktree, then stages isolated consumer projects against both tarballs. Set
`SDK_CONTRACT_BASE_SHA` to compare against a specific release commit; CI pins it
to the pull request's base SHA and installs that commit's frozen dependencies.
Local runs reuse the existing dependency installation so the comparison remains
offline. The command validates:

- every published subpath resolves, its declaration file exists, and its runtime
  export keys match the packed release package;
- patch releases keep the exact declared export inventory and require changed
  public types to be mutually assignable with the packed release. Text-equal
  symbols take a fast path; generic types use representative `never`, `any`,
  default, and SDK smart-session ABI instantiations. Namespaces,
  checker-sensitive declarations (explicit
  `any`, method or constructor syntax, and readonly object properties), and
  classes with private or protected members (including inherited members) keep
  their declarations and referenced declarations text-strict;
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
consumer staging, compatibility report, and size run. A patch failure reports
only the affected entry point and symbol with its base and current declarations.
Minor and major changes keep their existing additive and well-formedness rules.
`vitest.config.contract.ts` only discovers the `*.ctest.ts` assertions and
requires the staged environment.

## Integration tests

Integration tests exercise Base Sepolia as the source chain and Arbitrum
Sepolia as the target chain. Unless `INTEGRATION_ORCHESTRATOR_URL` is set, they
use the SDK's built-in production orchestrator URL and production contract
addresses. They run through `vitest.config.integration.ts`, with file parallelism disabled
and five-minute test and hook timeouts. CI retries a failed test up to twice;
local runs fail on the first attempt.

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
bun run test:integration:smoke -- --run

# Full suite against the production orchestrator and testnets.
bun run test:integration -- --run

# Run one scenario or test while investigating a failure.
bun run test:integration -- --run \
  test/integration/scenarios/ssx-policies.itest.ts -t "allowlisted"

# Compact per-intent diagnostics.
SDK_ITEST_DEBUG=1 bun run test:integration:smoke -- --run
```

`test/integration/framework/` owns execution, funding, signature assertions,
and reusable fixtures. Configuration lives in `test/integration/config/`.

### GitHub Actions

The Release workflow runs the smoke suite before a `main` snapshot publish and
the full suite before a `release` production publish. Publishing is blocked on
its result. The manual `Integration Tests` workflow remains available for
ad-hoc runs. Both workflows serialize live runs through the
`live-integration-tests` concurrency group.

For a manual run, choose `suite=smoke` or `suite=all` and `target=prod` or
`target=dev`. The job has a 30-minute timeout and resolves the
environment-specific API key before executing the selected suite.

```bash
gh workflow run integration-tests.yaml -f suite=all -f target=prod
```

For `target=prod`, the workflow leaves the endpoint override empty so the SDK
uses its built-in production URL and contracts. For `target=dev`, it supplies
the development URL, which also enables development contract addresses.

### Credentials

Keep local credentials in the ignored `.env` file. Do not paste them into
commands or logs.

```bash
bun run test:integration:smoke -- --run
```

`.env.example` lists the required variables.
