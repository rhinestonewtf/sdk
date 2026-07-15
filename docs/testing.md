# Testing

This guide covers SDK test layers, live integration setup, and the v2 rewrite
characterization gate. Use the characterization section when calibrating or
comparing release behavior.

## Layers

| Layer            | Files                                 | Runs against                                | Command                         |
| ---------------- | ------------------------------------- | ------------------------------------------- | ------------------------------- |
| Unit and vectors | `src/**/*.test.ts`, `test/vectors/**` | Local code and deterministic fakes          | `bun run test`                  |
| Type             | `test/types/**`                       | TypeScript                                  | `bun run test:types`            |
| Package contract | `test/contract/**/*.ctest.ts`         | Packed current and base packages            | `bun run test:contract`         |
| Integration      | `test/integration/**/*.itest.ts`      | Live orchestrator and testnets              | `bun run test:integration`      |
| Characterization | `test/characterization/**`            | Selected legacy, rewrite, or public subject | `bun run test:characterization` |

Unit tests live next to the source they cover. Type tests assert the public
surface with `tsconfig.type-tests.json`. Run one unit file with
`bun run test -- path/to/file.test.ts`.

## Integration tests

Integration tests exercise the dev orchestrator on testnets by default. They
run manually through `vitest.config.integration.ts` with 180-second test
timeouts and file parallelism disabled.

### Environment

| Variable                                 | Purpose                                              | Required                 |
| ---------------------------------------- | ---------------------------------------------------- | ------------------------ |
| `INTEGRATION_TARGET`                     | `dev` by default; `prod` requires explicit selection | No                       |
| `INTEGRATION_RHINESTONE_API_KEY`         | Orchestrator API key                                 | Always                   |
| `INTEGRATION_RHINESTONE_API_RELAYER_KEY` | Relayer-scoped key for characterization dry-run      | Characterization dry-run |
| `INTEGRATION_FUNDER_PRIVATE_KEY`         | Testnet funder holding native tokens and USDC        | Funded scenarios         |
| `INTEGRATION_ORCHESTRATOR_URL`           | Orchestrator endpoint override                       | No                       |
| `INTEGRATION_USE_DEV_CONTRACTS`          | Use development contract addresses when `true`       | No                       |

Funded scenarios fail fast when the funder is absent or has insufficient
balance. The test harness selects `https://dev.v1.orchestrator.rhinestone.dev`
and development contracts when `INTEGRATION_TARGET` is unset. It rejects the
production URL unless `INTEGRATION_TARGET=prod` is set explicitly; missing dev
configuration never falls back to prod.

Characterization accounts are topped up to a 0.1-USDC minimum. Reusing the
same `SDK_ITEST_RUN_ID` reuses those deterministic accounts for a retry; a new
run ID creates isolated identities and requires fresh funding.

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

## Characterization matrix

The characterization matrix records release behavior before the atomic v2
rewrite and compares later subjects against that evidence. Live runs are
manual because they use credentials, funded testnet state, and external
services.

### Evidence model

The catalog contains 100 scenarios with the fixed sign/dry-run/execute and
primary-category allocations. At the initial calibration snapshot:

| Evidence kind        | Scenarios | Meaning                                                                                                   |
| -------------------- | --------: | --------------------------------------------------------------------------------------------------------- |
| Executable           |        66 | Live, dry-run-only, or local direct-signing observation recorded in subject/shard artifacts               |
| Explicit network gap |        34 | Non-executable network combination with a limitation and real committed `coverageRef`                     |
| **Catalog total**    |   **100** | Coverage test accounts for every catalog ID; subject/shard aggregation covers the 66 executable scenarios |

An explicit gap is evidence that a combination was not executed. It must not be
emitted as a successful result artifact or reported as a successful live flow.
The catalog coverage test requires each gap to reference real offline coverage.
The catalog and coverage test are the source of truth if support changes after
calibration.

The subjects have distinct meanings:

| Subject   | Meaning                                                           | Rewrite evidence?                                     |
| --------- | ----------------------------------------------------------------- | ----------------------------------------------------- |
| `legacy`  | Preserved implementation calibrated at the exact release base SHA | No; compatibility oracle                              |
| `rewrite` | Test-only rewritten composition                                   | Yes, once the complete composition exists in Commit 6 |
| `public`  | Published package facade on the checked-out branch                | Only after the facade cutover in Commit 7             |

Through Commit 5, `public` still exercises legacy implementation paths. A passing
legacy/public run is a regression gate, not proof that rewritten internals
work. The manual workflow intentionally runs only `legacy` and `public` until
the rewrite subject is executable.

### Commands

| Command                                   | Purpose                                               |
| ----------------------------------------- | ----------------------------------------------------- |
| `bun run test:characterization`           | Run one selected subject                              |
| `bun run test:characterization:compare`   | Run an ordered subject pair back-to-back per scenario |
| `bun run test:characterization:smoke`     | Run the committed low-cost smoke slice                |
| `bun run test:characterization:aggregate` | Validate the expected subject/shard artifact matrix   |

Examples use the calibrated release commit:

```bash
BASE_SHA=49efb8b8d957b2eea2b24c11ac56d6c4d80478d6
RUN_ID="local-$(date -u +%Y%m%dT%H%M%SZ)"

SDK_ITEST_SUBJECT=legacy \
SDK_ITEST_BASE_SHA="$BASE_SHA" \
SDK_ITEST_RUN_ID="$RUN_ID" \
INTEGRATION_TARGET=dev \
bun run test:characterization -- --run

SDK_ITEST_COMPARE=legacy,rewrite \
SDK_ITEST_BASE_SHA="$BASE_SHA" \
SDK_ITEST_RUN_ID="$RUN_ID" \
SDK_ITEST_SHARD=1/8 \
INTEGRATION_TARGET=dev \
bun run test:characterization:compare -- --run
```

The compare command executes both subjects for one scenario before advancing.
It does not run all legacy cases hours before all rewrite cases.

### Harness environment

| Variable                    | Contract                                                                                  |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| `SDK_ITEST_SUBJECT`         | One of `legacy`, `rewrite`, or `public`; single-subject command only                      |
| `SDK_ITEST_COMPARE`         | Two different ordered subjects, for example `legacy,rewrite`; compare and aggregate only  |
| `SDK_ITEST_BASE_SHA`        | Full lowercase calibrated release SHA; required for legacy, compare, and baseline updates |
| `SDK_ITEST_RUN_ID`          | Non-secret 1-80 character identifier; required for full, sharded, and aggregate runs      |
| `SDK_ITEST_SHARD`           | One-based `index/total`, for example `1/8`; omit only for local unsharded subsets         |
| `SDK_ITEST_WORKFLOW`        | Optional comma-separated `intent,user-operation,direct-signing` filter                    |
| `SDK_ITEST_TAGS`            | Optional registered-tag filter; semantics below                                           |
| `SDK_ITEST_MODE`            | Optional comma-separated `sign,dryRun,execute` filter; workflow/mode pairs are validated  |
| `SDK_ITEST_UPDATE_BASELINE` | Must equal `1`; accepted only for a legacy run at the exact base SHA                      |
| `SDK_ITEST_RESULTS_DIR`     | Result root; defaults to ignored `.artifacts/characterization`                            |
| `INTEGRATION_TARGET`        | External environment; defaults to `dev`, while `prod` must be explicit                    |

Tag filters use registered catalog tags only:

```bash
# Default and explicit all-match forms are equivalent.
SDK_ITEST_TAGS=smoke,stateful
SDK_ITEST_TAGS=all:smoke,stateful

# Match at least one tag.
SDK_ITEST_TAGS=any:smoke,golden-vector
```

Workflow, mode, and tag filters change selection only. They do not weaken the
100-row catalog coverage test. A complete subject aggregate still requires all
66 executable scenarios.

### Baseline updates

Baseline writes are a separate, reviewable operation:

```bash
SDK_ITEST_SUBJECT=legacy \
SDK_ITEST_BASE_SHA=49efb8b8d957b2eea2b24c11ac56d6c4d80478d6 \
SDK_ITEST_RUN_ID=baseline-20260715 \
SDK_ITEST_UPDATE_BASELINE=1 \
INTEGRATION_TARGET=dev \
bun run test:characterization -- --run
```

The harness verifies that the configured base resolves to the exact recorded
commit. Normal runs cannot rewrite baselines. Review every update for
volatile-field over-normalization and secrets before committing it.

### Credentials

Keep local credentials in the ignored `.env` file as `op://` references. Do
not paste resolved values into commands, run IDs, result paths, or logs.

```bash
export OP_SHIM_KEY=...
op read "op://Shared/alchemy/api_key"
op run --env-file=.env -- bun run test:characterization -- --run
```

If `OP_SHIM_KEY` is absent, ask for it and export it for the current shell only.
Never write it to disk. A missing op-shim reference means the secret has not
been seeded; do not guess a replacement path.

The integration workflow uses `INTEGRATION_RHINESTONE_API_KEY` or
`INTEGRATION_RHINESTONE_API_KEY_DEV` for its explicitly selected target. The
Commit 1 characterization workflow is dev-only: it uses
`INTEGRATION_RHINESTONE_API_KEY_DEV` and maps
`INTEGRATION_RELAYER_API_KEY_DEV` to
`INTEGRATION_RHINESTONE_API_RELAYER_KEY`. These roles are separate because
orchestrator dry-run requires the privileged relayer machine role. Both
workflows use `INTEGRATION_FUNDER_PRIVATE_KEY` for funded scenarios and fail
instead of falling back between environments.

### Artifacts and aggregation

Results default to `.artifacts/characterization/<run-id>/<subject>/`. This path
is gitignored. Each shard artifact records its base SHA, run ID, subject, shard,
catalog version, normalized observations, and secret-scan result.

Each completed scenario is first persisted under the subject's `scenarios/`
directory before its diagnostics are asserted. A secret-bearing or unsupported
value is replaced by a safe rejection marker, so it cannot reach test output and
cannot prevent sibling scenario evidence from being retained. The final shard
artifact remains the input to aggregation.

The aggregate gate fails on:

- missing or duplicate subject/shard artifacts;
- base SHA, run ID, subject, or shard mismatch;
- missing, duplicate, unknown, or wrongly sharded scenarios;
- failed scenarios or unexplained deltas;
- artifacts without a passing secret scan.

Never store API keys, JWTs, private keys, authorization headers, or complete
sensitive wallet payloads in artifacts. GitHub uploads only secret-scanned JSON
results and retains them for a bounded period.

Normalization may replace generated IDs, hashes, timestamps, gas/fee estimates,
and ephemeral hosts when the scenario selects the matching allowlisted rule. It
must retain account and module addresses, chain IDs, token and amount inputs,
call order/data, signature semantics, error identity, and terminal state.

### Sharding and calibration

The Commit 1 manual workflow is dev-only and uses a provisional eight-shard
assignment. Each job runs `legacy` then `public` back to back for every selected
scenario, and stateful work remains sequential inside the shard.

The dispatcher owns calibration for that run: review prior duration and spend,
confirm funded identities are isolated, and stop dispatching if a shard no
longer fits its timeout with margin. Change the shard count or concurrency only
after recording new duration, spend, and flake evidence. The committed catalog
assignment, workflow matrix, and aggregate expectation must change together.

Classify live failures before rerunning:

| Failure                                      | Action                                                         |
| -------------------------------------------- | -------------------------------------------------------------- |
| Deterministic local/vector/contract failure  | Block the change                                               |
| Reproducible semantic subject difference     | Block unless approved                                          |
| Both subjects fail during an external outage | Retain evidence and rerun                                      |
| One isolated provider failure                | Rerun narrowly and retain both results                         |
| Flaky setup                                  | Fix the harness; do not waive the case                         |
| Unsupported environment combination          | Keep offline/dry-run evidence and the explicit live limitation |

The rewrite cannot merge with unexplained full-matrix failures.
