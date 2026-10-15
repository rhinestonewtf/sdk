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
| Reference examples | Generated SDK Reference Usage blocks   | Packed public package               | `bun run test:reference`     |
| Package contract   | `test/contract/**/*.ctest.ts`         | Packed release and current packages | `bun run test:contract`      |
| Integration        | `test/integration/**/*.itest.ts`      | Live orchestrator and testnets     | `bun run test:integration`   |

Unit tests live next to the source they cover. Vectors under `test/vectors/`
pin exact addresses, hashes, and init data for shipped code. The main
`bun run typecheck` command covers production source, colocated unit tests, and
the integration harness without executing live scenarios. Public type fixtures
run separately through `tsconfig.type-tests.json`. Run one unit file with
`bun run test -- path/to/file.test.ts`.

Cross-VM coverage pairs public type fixtures with runtime tests. Type fixtures
prove composite EVM-plus-Solana capability visibility, explicit VM address
selection, the single-SPL-transfer shape, forbidden EVM/cross-chain fields,
tagged `personalSign` payloads, optional destination signatures, persisted
Solana execution metadata, and chain-native references. Runtime tests repeat
these checks for widened or reconstructed values, validate explicit Swig state
addresses and derive their wallet PDAs offline, reject production or missing
managed Solana accounts, and validate exact persisted requests and opaque quote artifacts before
signing/submission. `src/api/transaction-input.test.ts` covers every rule of
the nested `{ source, destination }` input: obsolete fields refused by name,
delivery modes, when a source is required, the same-chain shorthand, and the
Solana-origin shapes. EVM → Solana delivery is covered at
the client, workflow and facade layers: the recipient resolution order on both
clusters, base58 mints and recipients passed through unnormalized, refused
destination execution, the provider's own destination chain id on `bridgeFill`,
and chain-native completion and refund references. Solana → EVM delivery is
covered the same way: the one named source on the wire, a
vendor-settled route with its delivery handle, mixed-namespace cost legs,
recipient defaulting to the account's own EVM identity, and the shapes refused
before quoting. The same explicitly named Swig is covered alone, with an EVM
receiver, and with managed EVM: invalid state addresses are refused; plain requests
carry no `evm` entry and bind metadata/sponsorship to the wallet; receivers
cannot spend; unrelated managed pairs refuse destination calls before effects;
and request tampering fails across instances. Swig creation is covered the same
way: the exact Solana-only creation request for ECDSA and passkey owners, the
deployment-route checks (purpose, Swig, wallet, authority, chain, costs, expiry)
before a `proofs: []` submission, Swig id resolution and every pre-network
refusal on the standalone and composite facades, VM routing of `deploy`, an
existing Swig resolving `true` without a submission, and the
`ACCOUNT_ALREADY_DEPLOYED` mapping that keeps EVM refusals generic. The opt-in
live Solana suite covers fresh Swig deployment; offline coverage remains
deterministic. Swig authority changes (passkeys and secp256k1 keys) run through the
real Solana workflow against a fake orchestrator with software signers: exact
requests, a refusal per quote mutation including curve and permission swaps,
cross-instance tampering, signing and expiry, an external `toAccount` manager
signer, the typed refusal, and the `getAuthorityStatus` mapping. Live
authority changes are not covered offline. Offline tests never execute a Solana
mainnet transfer.

The pure-core gate requires 95% statements, lines, and functions and 90%
branches. Contract-only files are excluded. The architecture check rejects
forbidden layer edges, concrete-client imports, published-barrel imports, and
cycles.

## Reference examples

`bun run test:reference` builds the SDK, regenerates the reference into an
isolated scratch directory, packs `src/`, and type-checks every rendered
TypeScript Usage block against that package. The manifest includes 74 pages;
CI reports the compiled block count.
The manifest and context registry must match exactly; malformed fences,
non-public imports, casts, suppressions, missing auth, legacy fields, missing
exports, and unavailable account capabilities fail the gate.

All fixtures, inferred contracts, and negative probes are type-checked in one
compiler pass, in a separate `bun --smol` worker. SDK and dependency
declarations stay checked (`skipLibCheck: false`); only TypeScript's bundled
`lib.*.d.ts` are skipped. Build, TypeDoc, render, and compile each run as their
own process group under an RSS budget (default 2048 MiB, override with
`SDK_REF_MAX_RSS_MIB`); a step over budget is killed and the gate fails with
"exceeded the … memory budget". One run per host holds
`$TMPDIR/rhinestone-sdk-test-reference.lock`; others wait up to 15 minutes, then
fail as incomplete.

A run counts as passed only with exit 0, a final `Reference examples passed: …`
line, and `report.json` `status: "passed"`. The report starts as `incomplete`,
so a killed run never looks green; missing output is a failure. The success
line and the report's `steps` record each step's peak RSS.

## Address derivation vectors

`test/vectors/accounts/` guards the promise that a configuration always derives
the same account address — an address change orphans already deployed accounts,
so it must never happen by accident.

`matrix.ts` enumerates one case per address-affecting axis: every account type
with every owner type, account variants (adapter, version, salt, nonce, custom
factory), owner variants (multi-owner, thresholds, module overrides,
multi-factor, ENS, ENS owner expiry), sessions, recovery, custom modules, caller-pinned init data,
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

## Sponsorship approval vectors

`test/vectors/sponsorship-approval-caucasus/` pins the current contract in
[sponsorship-approval.md](sponsorship-approval.md). Every case is rebuilt from
the SDK on each run: EVM cases through `prepareTransaction` (or `deploy`), the
others through the request builders. It must project to its recorded approval
input and digest, and every refused body must be refused. `provenance` records
the orchestrator commit the vectors were last cross-checked against. To
regenerate after an intended change, run
`bun run scripts/vectors/sponsorship-approval.ts`.

`test/vectors/sponsorship-approval/` holds the frozen legacy contract. Its
bodies are projected through test-only `legacy-projection.ts`, and a hash guard
fails on any change to `vectors.json`; nothing regenerates it.

## Derivation invariants

`test/vectors/accounts/invariants.test.ts` guards the *shape* of the same
promise with generated configurations (fast-check): which caller-visible
differences must never move a derived address, and which must.

Invariant: the order owners, recovery guardians, multi-factor factor members, and
the credentials of a passkey factor are listed in; reordering modules across
kinds while each kind keeps its relative order; spelling out a default
(`threshold: 1`, `sessions: { enabled: false }`, `modules: []`); address and
passkey public key casing and the uncompressed point prefix; the chain the
address is requested for and whether the account is deployed; repeated derivation, derivation order across accounts, and host
collation. Derivation never mutates the caller's configuration.

Sensitive by design, and asserted as such: owner set membership, threshold,
account type, version, salt, nonce, sessions, recovery, installed modules, the
order of modules of the same kind, and the order of multi-factor factors.

Documented exceptions, also asserted so they cannot drift: ENS-HCA accounts
derive from their lowest-sorted ENS owner alone, so configurations sharing that
owner share an address; EOA, EIP-7702, and caller-pinned `initData` pass an
address through; the legacy v0 factory args keep their owner-order sensitivity,
and the `address` `experimental_getV0InitData` reports comes from the current
derivation path rather than from those factory args, so the two describe
different accounts (reconstruction is unaffected — passing the result back as
`initData` re-derives the address from `factoryData`).

Properties run on a fixed seed so a counterexample reproduces on any host.
`SDK_PROPERTY_SEED` and `SDK_PROPERTY_RUNS` override the seed and run count for
exploration — never commit a configuration that depends on them.

## Smart Session parity

Compiler suites live in `src/modules/validators/smart-sessions/`: settlement
selection/coverage, scoped vs open access, time windows, once burns, lifetime
caps and installed-policy semantics. Facade coverage in `src/api/compose.test.ts`
checks online reads/refusal order, UAP-copy verification and coherent budget
reset consent. `src/smart-sessions/index.test.ts` checks supplied offline catalog
options without network dependencies. Intent suites exercise singular-source
funding, burn ordering/deduplication and ordered signing/sponsorship preservation.

`src/api/removed-inputs.test.ts` exercises public online and offline entrypoints
with widened objects, present undefined/empty keys and inherited keys. Spies
prove no catalog, RPC, fetch, token-provider or signing effects precede refusal.
`test/types/removed-inputs.ts` and the packed current-consumer fixture reject the
removed auth shorthand, raw claim definitions and Solana permission alias.
Historical claim artifacts under `test/utils/persisted-*-claims.json` and
`persisted-claim-sessions.json` retain encoding/identity probes; low-level
policy tests retain raw guardrail coverage without a public raw constructor.
Standard-permit replacements have separate identity pins rather than rewriting
historical ones. See [migration guidance](session-migration.md).

Run focused deterministic coverage with:

```bash
bun run test -- --run src/api src/smart-sessions src/transactions/intents
```

The reference example gate remains CI-only; do not run it locally or reproduce
its steps manually. A compiler or fork pass does not verify served testnet
catalog support, deployed bytecode or end-to-end settlement.

## Package contract

`bun run test:contract` builds and packs the exact release baseline and the
current worktree, then stages isolated consumer projects against both tarballs.
Set `SDK_CONTRACT_BASE_SHA` to the comparison commit; CI pins it to the pull
request base and installs that commit's frozen dependencies. Local runs reuse
the existing dependency installation so the comparison remains offline.

Fixture selection follows the packed package exports, not its version number:
v2 packages expose `/utils`; v3 packages expose `/evm` and `/solana`. An
unknown or ambiguous export shape fails the run. The first promotion compares
the actual v2 `release` base with the v3 candidate under declared major changesets.
Subsequent v3 patch/version-only checks use their actual `release`-line base;
both sides compile v3 consumer fixtures and strict v3 assignability checks apply.
Run the pre-v3 ancestor separately as an additional migration audit; it verifies
the frozen v2 consumer without replacing the promotion-base check:

```bash
SDK_CONTRACT_BASE_SHA=1529637ccc2553b28bfcba3adb8bf6ac40285228 \
SDK_CONTRACT_INSTALL_BASE_DEPENDENCIES=1 bun run test:contract
```

`legacy-consumer.ts` intentionally retains the old shorthand for a genuine v2
baseline only. V3 fixtures use nested auth, and current-package negative probes
must continue to reject the removed inputs. A size failure is separate from
consumer compilation; do not suppress it to make the migration look green.
The command validates:

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
- optional-peer behavior — the root imports without `jose`, and `/jwt-server`
  declares no `express` peer, never imports it, and fails cleanly without
  `jose`;
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

The Release workflow runs the smoke suite before a `main` snapshot publish to
`@dev` and the full suite before a `release` production publish. Publishing is
blocked on its result. `solana` is a frozen historical branch and must be
locked, with queued or in-flight publishing runs reconciled, before a v3 release
starts. The manual `Integration Tests` workflow remains available for ad-hoc
runs. Both workflows serialize live runs through the
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

## Opt-in Solana live suite

This separate manual suite exercises a fresh Solana Devnet fixture and Base
Sepolia. It is not part of smoke, `test:integration`, `all`, or release
publication. A passing offline run does not establish live settlement coverage.

### Matrix and refusals

Each row runs twice: `sponsored: false`, then gas-only sponsorship
`{ gas: true, bridging: false, swaps: false }`.

| Row | Live action | Sponsorship |
| --- | --- | --- |
| SC-D | Devnet USDC → Devnet USDC delivery | Unsponsored; gas-only |
| SC-I-USDC | Devnet SPL-USDC instruction | Unsponsored; gas-only |
| SC-I-SOL | Devnet System Program native-SOL instruction | Unsponsored; gas-only |
| IN-D | Base Sepolia USDC → Devnet USDC delivery | Unsponsored; gas-only |
| OUT-D | Devnet USDC → Base Sepolia USDC delivery | Unsponsored; gas-only |
| OUT-C | Devnet USDC → managed Base Sepolia account, then ERC-20 transfer call | Unsponsored; gas-only |

The suite also refuses same-chain native-SOL delivery-only, EVM→Solana
instructions/calls, unsponsored instructions without a fee source, instruction
source caps, invalid caps or mint pairs, invalid deployment IDs, and a request
above the fixture's spendable USDC. Refusals must occur before signing,
submission, funding, or balance effects.

Native SOL is `11111111111111111111111111111111`, not WSOL. Native-SOL
cross-chain shapes are SDK-supported but excluded from live acceptance while
Devnet has no suitable provider route; this is a coverage gap, not an invalid
native-delivery test. Inbound Solana instructions/calls are invalid SDK inputs.

### Configuration and fixture safety

| Variable | Purpose |
| --- | --- |
| `INTEGRATION_SOLANA_FUNDER_PRIVATE_KEY` | Required Devnet funder: a consistent JSON array of exactly 64 integer bytes (`0`–`255`) from a standard ed25519 Solana keypair. |
| `INTEGRATION_SOLANA_TARGET` | `dev` (default) or explicit `prod` service target. |
| `INTEGRATION_SOLANA_RPC_URL` | Optional Solana RPC override; it must be Devnet. |
| `INTEGRATION_RPC_URL_84532` | Optional Base Sepolia RPC override. |
| `INTEGRATION_RHINESTONE_API_KEY` | API key for the selected service target. |
| `INTEGRATION_FUNDER_PRIVATE_KEY` | Existing Base Sepolia EVM funder for cross-VM rows. |

Do not put key values in commands, source, reports, or chat. Use a secure
launcher that reads a permission-restricted environment file and exports values
only to its child test process. A fresh ECDSA Swig owner is generated in memory
per run; its key is never persisted or uploaded and cannot be recovered later.
Fresh fixtures can leave Devnet rent/dust.

The default target is `dev`: `https://dev.v1.orchestrator.rhinestone.dev` with
dev contracts. `prod` is explicit and uses the production endpoint/contracts.
Conflicting `INTEGRATION_ORCHESTRATOR_URL` or `INTEGRATION_USE_DEV_CONTRACTS`
overrides fail rather than retargeting the suite. Both targets remain pinned to
Solana Devnet (genesis
`EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`) and Base Sepolia (chain ID
`84532`); mainnet RPCs are refused before deployment, signing, or funding.

Funds belong to the derived Swig **wallet**, not its public state account or
ECDSA authority. Before any funding, the suite verifies the state/program,
derived wallet, role-0 ECDSA authority, and its permissions. It creates the
wallet and recipient USDC ATAs, then funds measured shortfalls only.

### Limits, execution, and evidence

Funding ceilings are 5 USDC on each chain, 0.1 SOL including ATA rent/fees, and
0.002 Base Sepolia ETH. The current fixture targets are 4 USDC plus rent and
20,000,000 lamports on Solana, and 1 USDC plus 0.001 ETH on Base Sepolia; a
shortfall may be lower. Cross-chain source caps are 0.5 USDC. The suite stops
on a limit or balance failure; it never automatically raises limits or refills.

The runner is sequential, has bounded five-minute test/hook timeouts, and has
zero automatic retries. It records a sanitized intent ID before submission. An
interrupted or timed-out submission halts further spending until its intent and
native receipts are reconciled. Diagnostics are sanitized and written to
`.scratch/rhi-7365/solana-report.json`. Manual `suite=solana` runs upload only
this sanitized report (including on failure), retained for seven days.

### Running

Run against dev first after a secure launcher has supplied the environment;
the commands themselves contain no values:

```bash
bun run test:integration:solana -- --run

gh workflow run integration-tests.yaml --ref <ref> -f suite=solana -f target=dev
```

Production orchestrator testing is optional and must be selected explicitly;
it still uses Solana Devnet and Base Sepolia:

```bash
gh workflow run integration-tests.yaml --ref <ref> -f suite=solana -f target=prod
```

The manual workflow serializes this suite with other live runs and injects the
Solana funder secret only for the Solana step. Ordinary smoke, all-integration,
and release commands/workflows remain unchanged and never require that secret.
