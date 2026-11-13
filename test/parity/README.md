# v1 parity harness

Runs one scenario against two SDK v1 builds and diffs what they do. The baseline is the published `@rhinestone/sdk@1.22.0` (installed as `@rhinestone/sdk-v1-baseline`); the candidate is the working tree (`src/`). Both load in one process and run one after the other, so live changes in routes, liquidity and gas don't show up as diffs.

Each run records:

- every orchestrator call (method, path, query, version headers, which auth headers were present, bodies, status);
- every payload handed to a signer, with its output and digest;
- every public step's result or error.

The recordings are projected into version-neutral layers, through an alps or blanc adapter chosen per request. Named rules normalize the values that legitimately vary per quote, and then each layer is compared:

| Layer | What it holds |
| --- | --- |
| `quoteRequest` | the quote request body |
| `typedData` | messages returned by `getTransactionMessages` and typed data handed to signers; integer fields compare by value, whether built as bigints or served as decimal strings |
| `signatures` | signatures returned by `signTransaction`, templated by role, with byte lengths |
| `submitRequest` | the submit body: signatures by role, authorizations, permits |
| `reads` | request parameters and public results of read steps |
| `errors` | error class, name, type, status, message, context, trace id presence and wire status/domain code |
| `cost` | inputs, outputs and USD fees; compared within tolerances. A fee category the request sponsors is compared by that fact alone: alps reports what the user pays per category, blanc the full cost, and only their totals agree |
| `steps` | public step results not covered above; for `prepare`, the transaction and an EOA's token requirements (the quote's content is compared on `typedData`, `cost` and `submitRequest`) |
| `traffic` | which orchestrator operations each step called, in order, with the auth headers each sent |

## Running

The live suite runs manually against prod testnets and needs an orchestrator API key. The funded scenarios also need the funded testnet fixtures described in [Funded scenarios](#funded-scenarios).

```sh
PARITY_API_KEY=<key> bun run test:parity
```

| Env | Default | |
| --- | --- | --- |
| `PARITY_API_KEY` | `RHINESTONE_API_KEY` | Required. |
| `PARITY_ENV` | `prod` | `dev` targets `https://dev.v1.orchestrator.rhinestone.dev` (not calibrated, see Goldens). |
| `PARITY_BASELINE` | `published` | `published` or `working-tree`. |
| `PARITY_CANDIDATE` | `working-tree` | `published` or `working-tree`. |
| `PARITY_REPEAT` | `1` | Repeat the whole comparison. |
| `PARITY_FAULT` | | Break the candidate's request on purpose (see `faults.ts`). |
| `PARITY_UPDATE_GOLDENS` | | `1` rewrites goldens from the baseline. |
| `PARITY_REPORT_DIR` | `.parity/reports` | |
| `PARITY_FUNDED` | | `0` skips the funded scenarios. They are always skipped on dev. |
| `PARITY_SETTLE_TIMEOUT_MS` | `600000` | How long a submitted intent may take to reach a terminal status. |
| `PARITY_RPC_URL_<chainId>` | viem's public RPC | RPC for the harness's on-chain reads and the EOA's own transactions, also passed to both builds. |
| `PARITY_LOCK_FILE` | `<tmpdir>/sdk-v1-parity-funded.lock` | The machine-wide funded-run lock. |

Behind a TLS-intercepting proxy, Node also needs `NODE_EXTRA_CA_CERTS`.

The console shows a verdict per scenario and per layer, with each diff's path and both values. The full report, with the raw recordings, goes to `.parity/reports/<timestamp>/` (gitignored). Recordings never contain header values: `x-api-key`, `authorization` and `x-intent-extension` are stored only as present or absent.

The offline tests for the harness itself (`test/parity/**/*.test.ts`) run with `bun run test`.

## Scenarios

| File | Covers |
| --- | --- |
| `seed.parity.ts` | One unfunded cross-chain quote, sign and captured submit; basic reads; basic errors. |
| `mapping.parity.ts` | Every transaction option v1 puts in the quote request, source selection, same-chain and tokenless routes, sessions, and each account shape (Safe, Kernel, Startale, multi-owner, EOA, EIP-7702 signed with a captured submit; passkey quoted only). |
| `reads.parity.ts` | Status of fixed past intents, portfolios of empty fixture accounts and a dormant account, splits, and the exported low-level client's status and portfolio (raw shapes, token filter). |
| `errors.parity.ts` | Orchestrator quote rejections, `sendTransaction` with no balance, the SDK's own validation errors, invalid API key and JWT, read errors. |
| `funded-tokenless.parity.ts` | Funded: sponsored no-op calls that execute each signing path without moving funds, and a non-owner signature the orchestrator refuses. |
| `funded-transfers.parity.ts` | Funded: smart-account transfers over Across, CCTP and same-chain, paired so principal comes back. |
| `funded-eoa.parity.ts` | Funded: the plain EOA with an ERC-2612 permit, an existing Permit2 approval and an ETH wrap. |
| `funded-reads.parity.ts` | Funded: portfolios with non-zero balances, and quotes for more than a fixture holds. |

Attempts inside a scenario are independent: a rejected quote or read is recorded and the next attempt runs.

## Checking the harness

- **Self-check:** `PARITY_CANDIDATE=published PARITY_REPEAT=3 bun run test:parity` must match 100%. A diff here is per-quote variance that needs a rule, or a non-deterministic scenario.
- **Fault checks** (`faults.ts`) must fail with `quoteRequest` diffs:
  - `quote.bump-token-amount`: `/<step>/tokenRequests/0/amount`.
  - `quote.drop-options`: `/<step>/options/<key>` for every option a step sets (`topupCompact` and `signatureMode` on every quote).
  - `quote.drop-optional-fields`: `recipient`, `accountAccessList`, `preClaimExecutions`, `destinationGasLimit`, `destinationExecutions` and the account's `mockSignatures` and `delegations`, wherever a step sets them.

## Harness errors

A scenario that can't run as written, such as a `wait` step while submits are captured, raises a harness error (`HarnessError`). Its verdict is `error` (harness) even when both builds record it identically, and the summary lists it under its own heading.

## Submits

Unfunded scenarios run with capture-only submit: the submit request is recorded and answered with a stub built for its API version, and never reaches the orchestrator. Funded scenarios (`funded: true`) submit for real; a `wait` step in capture mode fails.

## Adding a scenario

Add a `defineScenario` to a `*.parity.ts` file under `scenarios/` and register it with `assertParity`. Wrap every public SDK call in `ctx.step(name, kind, fn)`; the kind decides which layers the result feeds. Use `ctx.sdk()`, `ctx.signer(label)` and `ctx.build.root` instead of importing the SDK, so the same definition runs against both builds. If the scenario needs more of the SDK surface, extend the structural types in `builds.ts`.

The unfunded fixture accounts (every account type, owner set, EOA, 7702, sessions and passkey account built from `ownerA` and `ownerB`) must never be funded: their portfolios have to stay empty for the reads goldens to hold. No fixture account, funded or not, is ever registered with the deposit service. Shared account configs, the default cross-chain request and `attempts` live in `scenarios/shared.ts`.

A funded scenario sets `funded: true` and declares what it needs: its per-side spend in `funded/spend.ts`, the `steady` state a warm-up settles, a `beforeSide` reset for state that only exists once, and its `execution` expectation. Use `ctx.ephemeralSigner`, `ctx.ephemeralSalt` and `ctx.identity` for values that are fresh per side, and `ctx.clock` for times both sides must share.

## Rules and accepted differences

- **Rules** (`rules.ts`) mask, ignore, decode or tolerance-compare values that vary per quote. Add one only for variance a repeated self-check shows, scope it to the narrowest path, and give it a reason that names what varies. Never mask a field that is deterministic in the request. Each report lists the rules that fired. Scenarios can override tolerances with `tolerances`.
- **Adapters** project what the orchestrator plans from: the alps adapter folds a session's singular `mockSignature` into `mockSignatures['0']` (unless set) and the flat exact-input access list into `chainTokens` and `chainTokenAmounts`, as the orchestrator lowers alps requests.
- **Accepted differences** (`accepted.ts`, or `accepted` on a scenario) are differences the migration intends. Each needs a reason, and the report lists them under their own heading.
- **Reads**: the candidate reads status, portfolio, splits and app-fee balances through blanc, while the baseline reads them through alps; the read results must match exactly.
- **Errors** are compared strictly: class, name, type, status, message, context, the wire's domain code and whether the error carries a trace id. The wire code is the domain code on both versions (`ZERO_BALANCE`, `INSUFFICIENT_BALANCE`, …), not blanc's coarse envelope code (`UNPROCESSABLE_CONTENT`, `VALIDATION_ERROR`). When blanc's own wording of one error differs from alps's, accept that difference with one entry for that scenario, that step and that field (e.g. `/<step>/message`), with the reason. Never a wildcard or alternation on the errors layer: the runner rejects any such entry, global or on a scenario, and `accepted.test.ts` requires the global ones to name a scenario. Never rewritten text in the SDK.

## Goldens

`goldens/<scenario>.json` holds the published baseline's normalized deterministic layers (a scenario's `goldenLayers`, minus `goldenIgnore`). They are checked only when the baseline is `published`, and a mismatch is reported as drift, separately from parity diffs. Cost is never golden, and neither are values that depend on liquidity or time.

Goldens and fixed fixtures (past intent ids, the dormant account) are prod-only. On dev, those reads differ by design and the goldens drift; compare dev runs for parity only.

Refresh them deliberately and review the diff:

```sh
PARITY_UPDATE_GOLDENS=1 PARITY_CANDIDATE=published bun run test:parity
bunx biome check --write test/parity/goldens
```

## Baseline version

The baseline is pinned to the exact published tarball in `package.json`. Bump it only on purpose, when v1 hotfixes are merged forward, and refresh the goldens in the same change. It is referenced by tarball URL rather than an `npm:` alias because Bun links an alias of `@rhinestone/sdk` to the workspace package of the same version.

## Funded scenarios

The funded scenarios quote, sign, **submit for real** and wait, once per build, against the prod orchestrator on Base, Arbitrum and OP Sepolia. Dry-run submission isn't available to integrator keys, so a signature is proven correct by its intent completing. They run with the rest of the suite on prod; `PARITY_FUNDED=0` skips them, and they are always skipped on dev.

For each funded scenario the runner:

1. **Checks steady state**: the fixture is deployed where the route needs it, its session is enabled, its Permit2 allowance is set. Anything only the first execution would do (deploy, enable, approve) is settled first by an unrecorded warm-up run of the published build, never by a compared side.
2. **Checks funding**: every fixture balance must cover the scenario's per-side spend for every side it may run (2 × `PARITY_REPEAT`, plus warm-ups). If not, the verdict is `error` (funding), the report lists faucet-ready top-ups, and nothing is submitted.
3. Runs `beforeSide` (unrecorded on-chain resets), then the **baseline**, then **settles**: each submitted intent is polled, unrecorded, until COMPLETED, FAILED or EXPIRED. Then the same for the **candidate**. If the baseline doesn't settle, the candidate is skipped.
4. Compares as usual, then checks **execution**: every live submit on both sides must reach COMPLETED (or, for `execution: 'reject'`, must be refused). Anything else is `error` (execution), even when both builds fail the same way. `error` outranks `diff`, and a funded scenario stops repeating after one.

The console and the JSON report show each submit's intent id, final status, elapsed time and submit trace id, the fixture balances at preflight, and any warm-up.

Values that differ between the sides only because they ran one after the other are normalized: fill and claim transaction hashes, the ERC-2612 permit nonce, and fresh per-side identities (`<id:…>`: the undeployed account and its salt, the fresh 7702 EOA and its signatures). Passkey signatures embed the signed hash in `clientDataJSON`; its challenge is templated as `<challenge:…>`.

Only one funded run may be in flight: the first funded scenario takes a machine-wide lock (`PARITY_LOCK_FILE`), and a second funded run on the same machine refuses at it. The lock can't see other machines, so coordinate before running from two.

### Scenarios

| Scenario | Account | Signer | Route | Funding | Options |
| --- | --- | --- | --- | --- | --- |
| `undeployed-nexus` | Nexus, fresh salt per side | ECDSA owner | Base, no-op call | none | sponsored, custom deadline |
| `eip7702-first-delegation` | fresh EOA per side, delegated to Nexus | ECDSA owner, 7702 authorization | Arbitrum, no-op call | none | sponsored |
| `safe-send-transaction` | Safe 1.4.1 | ECDSA 2-of-3, `sendTransaction` | OP, no-op call | none | sponsored per category |
| `startale-erc7739` | Startale | ECDSA (K1, ERC-7739) | Arbitrum, no-op call | none | sponsored |
| `session-verify-executions` | Nexus | session with a scoped action (mode 5, target-execution signature) | Base, no-op call | none | sponsored |
| `invalid-signature` | Nexus, signed by a non-owner | ECDSA | Base, no-op call | none | sponsored; the submit is refused |
| `across-owner-destination-call` | Nexus | ECDSA owner | Base → OP, Across, destination call | Permit2 | unsponsored, quoter filter |
| `across-session-source-call` | Nexus | session, no actions (mode 1) | OP → Base, Across, source call | Permit2 | sponsored |
| `same-chain-fees` | Nexus → Kernel | ECDSA owner | Base | intent executor | unsponsored, app and protocol fees |
| `same-chain-passkey-sponsored` | Kernel 3.3 → Nexus | software passkey | Base | intent executor | sponsored including the protocol fee |
| `cctp-safe` | Safe 1.4.1 | ECDSA 2-of-3 | Base → OP, CCTP | intent executor | sponsored per category |
| `across-safe-return` | Safe 1.4.1 | ECDSA 2-of-3 | OP → Base, Across | Permit2 | unsponsored, source assets |
| `eoa-permit` | EOA | EOA | Base → OP, Across | ERC-2612 permit (allowance reset before each side) | sponsored |
| `eoa-permit2` | EOA | EOA | OP → Base, Across | Permit2, already approved | sponsored |
| `eoa-wrap` | EOA | EOA | Base → OP, Across, ETH | wrap (the harness wraps the quoted amount), then Permit2 | unsponsored |
| `portfolio` | Nexus, Safe, Kernel, EOA | — | testnet portfolio reads | — | — |
| `insufficient-balance` | Kernel, Nexus | — | quotes above the balance (same-chain, Across) | — | — |

All amounts are 0.05 USDC or 0.00001 ETH. Settlement layers are pinned on every cross-chain route. Nothing is sent to Arbitrum over Across: relayers there held about 0.04 USDC, and larger fills failed.

Not covered, because prod testnets can't execute it:

- **Passport**: the submit is refused, `Simulation failed: InvalidSignature()` (trace `c560f5f9df0d93d725a54de846a13200`).
- **Multi-factor owners** (ECDSA + passkey, threshold 2, Nexus 1.2.1 and default): the fill simulation fails, `CallFailed()` (trace `d01916960dff0b87be6acefeb63c55ec`). The same software passkey executes on Kernel, so the signer is not the cause.
- **Enabling a session inside an intent in ERC-1271 mode** (mode 1): refused, `InvalidContractSignature()` (trace `8d32b73862b54ab45dad2e4eb9f28079`). With execution verification (mode 5) it works, so `across-session-source-call` enables its session that way in its warm-up. Enable-in-intent request mapping stays with `mapping/sessions`.
- **Across into Arbitrum Sepolia**: relayer capacity is about 0.04 USDC; fills of 0.05 failed after a quote succeeded.
- **Quorum signers**: no Quorum Signer validator on testnets. **HCA / ENS owners**: no factory or module on testnets.
- **Relay** (unsupported on testnet destinations), **Eco** and **Plasma** (no Eco origin balance).
- **Multi-source intents**: no route on prod testnets.
- **Swaps**: no testnet venue, so the quoter filter only rides along. **Fees on cross-chain routes**: Across has no capacity with a fee, and CCTP's unsponsored fee costs about 0.10 USDC a run.
- **First-time state on token-moving routes**: a fresh account per run would strand its funds; undeployed accounts and first 7702 delegations run only on sponsored no-op calls.
- **Locked balances, guardians, `lockFunds` / Compact**: no deposits are made, and v1 refuses guardians for intents.

### Fixtures

Keys are derived from readable labels (`keccak256("sdk-v1-parity:<label>:v1")`, in `funded/fixtures.ts`) and guard only testnet dust; anyone can read them, so a drained fixture shows up in the preflight. They are distinct from the seed keys, whose accounts stay unfunded. The passkey is a software P-256 credential derived the same way.

| Fixture | Address | Config | Must hold |
| --- | --- | --- | --- |
| `nexus-main` | `0xF2EF721498c691a5fCc84Adf03e8676F7fe594c3` | Nexus, ECDSA `owner`, sessions enabled | USDC on Base and OP |
| `safe-multisig` | `0xF20fC2C4f28dd5e3f94FFdaF899Ea5667Cb3ACc1` | Safe, `owner`, `owner2`, `owner3`, threshold 2 | USDC on Base and OP |
| `kernel-passkey` | `0x9c5a766Ce7eb07C6227C9BFeA664841CAF28D68B` | Kernel 3.3, software passkey | USDC on Base |
| `eoa` | `0x557A8848Fd79EBeedB6b53340C5F042A7b530E45` | plain EOA | USDC on Base and OP, ETH on Base |
| `startale` | `0x4209a72df960CB0d313Bf66eC170f6F761dF35E7` | Startale, `owner` | nothing |

Smart-account fixtures never hold ETH, so routes stay on the token under test. A changed config moves an address and orphans its funds; `funded/fixtures.test.ts` pins them.

Paired flows bring principal back within a run (Base → OP and back for Nexus, the Safe and the EOA; Nexus → Kernel and back), so each scenario only needs its own spend for the sides it runs. Each scenario's preflight checks exactly that. To see every fixture's balances, the per-chain requirement for a run and the top-ups that cover it:

```sh
PARITY_REPEAT=3 bun run parity:funding
```

It prints one line per send in the shared faucet's format, `chain=<faucet chain> token=<USDC|ETH> amount=<decimal> recipient=<address>`. Send exactly those; the faucet caps a send at 2 USDC or 0.001 ETH. Never send ETH to a smart-account fixture, and never fund `startale`, the seed account or a fresh per-side account.

Measured on prod testnets (2026-11, over about 20 full comparison iterations): one iteration of the full suite (each funded scenario once per build) takes about 4 minutes and costs about 0.065 USDC and 0.000013 ETH net. Fees come out of Nexus on Base (about 0.04 USDC: the unsponsored Across and same-chain transfers), the Safe on OP (about 0.023 USDC: the unsponsored Across return) and the EOA's ETH on Base (about 0.000033 ETH leaves Base, 0.00002 of it arrives on OP); sponsored routes cost the fixtures nothing. A `PARITY_REPEAT=3` invocation takes about 12 minutes and costs about 0.2 USDC and 0.00004 ETH. Standing balances of about 2 USDC for Nexus on Base, 1 USDC for the Safe on OP and 0.001 ETH for the EOA on Base last about ten such invocations.

### Checking the funded harness

- **Self-check:** `PARITY_CANDIDATE=published PARITY_REPEAT=3 bun run test:parity` must match 100%, with every intent COMPLETED on both sides.
- **Execution fault:** `PARITY_FAULT=submit.corrupt-origin-signature bun run test:parity test/parity/scenarios/funded-transfers.parity.ts -t funded/across-owner-destination-call` flips a byte of the candidate's first origin signature. Expect `error` (execution): the baseline completes, the candidate's submit is refused (`InvalidContractSignature()`). Run it on one scenario only, and on a route with a claim: same-chain no-op calls without funds (`SingleChainOps`) execute with the destination signature, so a corrupted origin signature still completes there and shows only as a `submitRequest` diff.
- **Funding:** `PARITY_REPEAT=50 bun run test:parity test/parity/scenarios/funded-eoa.parity.ts` must stop at preflight with top-up lines and submit nothing.
