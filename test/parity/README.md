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
| `typedData` | messages returned by `getTransactionMessages` and typed data handed to signers |
| `signatures` | signatures returned by `signTransaction`, templated by role, with byte lengths |
| `submitRequest` | the submit body: signatures by role, authorizations, permits |
| `reads` | request parameters and public results of read steps |
| `errors` | error class, name, type, status, message, context and wire status/code |
| `cost` | inputs, outputs and USD fees; compared within tolerances |
| `steps` | public step results not covered above, including the prepared intent route |
| `traffic` | which orchestrator operations each step called, in order, with the auth headers each sent |

## Running

The live suite runs manually against prod testnets and needs an orchestrator API key. It needs no funds.

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

Behind a TLS-intercepting proxy, Node also needs `NODE_EXTRA_CA_CERTS`.

The console shows a verdict per scenario and per layer, with each diff's path and both values. The full report, with the raw recordings, goes to `.parity/reports/<timestamp>/` (gitignored). Recordings never contain header values: `x-api-key`, `authorization` and `x-intent-extension` are stored only as present or absent.

The offline tests for the harness itself (`test/parity/**/*.test.ts`) run with `bun run test`.

## Scenarios

| File | Covers |
| --- | --- |
| `seed.parity.ts` | One unfunded cross-chain quote, sign and captured submit; basic reads; basic errors. |
| `mapping.parity.ts` | Every transaction option v1 puts in the quote request, source selection, same-chain and tokenless routes, sessions, and each account shape (Safe, Kernel, Startale, multi-owner, EOA, EIP-7702 signed with a captured submit; passkey quoted only). |
| `reads.parity.ts` | Status of fixed past intents, portfolios of empty fixture accounts and a dormant account, splits. |
| `errors.parity.ts` | Orchestrator quote rejections, `sendTransaction` with no balance, the SDK's own validation errors, invalid API key and JWT, read errors. |

Every scenario is unfunded. Attempts inside a scenario are independent: a rejected quote or read is recorded and the next attempt runs.

## Checking the harness

- **Self-check:** `PARITY_CANDIDATE=published PARITY_REPEAT=3 bun run test:parity` must match 100%. A diff here is per-quote variance that needs a rule, or a non-deterministic scenario.
- **Fault checks** (`faults.ts`) must fail with `quoteRequest` diffs:
  - `quote.bump-token-amount`: `/<step>/tokenRequests/0/amount`.
  - `quote.drop-options`: `/<step>/options/<key>` for every option a step sets (`topupCompact` and `signatureMode` on every quote).
  - `quote.drop-optional-fields`: `recipient`, `accountAccessList`, `preClaimExecutions`, `destinationGasLimit`, `destinationExecutions` and the account's `mockSignature`, `mockSignatures` and `delegations`, wherever a step sets them.

## Harness errors

A scenario that can't run as written, such as a `wait` step while submits are captured, raises a harness error. It fails the run even when both builds record it identically, and the summary lists it under its own heading.

## Submits

Unfunded scenarios run with capture-only submit: the submit request is recorded and answered with a stub built for its API version, and never reaches the orchestrator. Funded scenarios (`funded: true`) submit for real; a `wait` step in capture mode fails.

## Adding a scenario

Add a `defineScenario` to a `*.parity.ts` file under `scenarios/` and register it with `assertParity`. Wrap every public SDK call in `ctx.step(name, kind, fn)`; the kind decides which layers the result feeds. Use `ctx.sdk()`, `ctx.signer(label)` and `ctx.build.root` instead of importing the SDK, so the same definition runs against both builds. If the scenario needs more of the SDK surface, extend the structural types in `builds.ts`.

Fixture accounts (every account type, owner set, EOA, 7702, sessions and passkey account built from the fixture owners) must never be funded or registered with the deposit service: their portfolios have to stay empty for the reads goldens to hold. Shared account configs, the default cross-chain request and `attempts` live in `scenarios/shared.ts`.

## Rules and accepted differences

- **Rules** (`rules.ts`) mask, ignore, decode or tolerance-compare values that vary per quote. Add one only for variance a repeated self-check shows, scope it to the narrowest path, and give it a reason that names what varies. Never mask a field that is deterministic in the request. Each report lists the rules that fired. Scenarios can override tolerances with `tolerances`.
- **Accepted differences** (`accepted.ts`, or `accepted` on a scenario) are differences the migration intends. Each needs a reason, and the report lists them under their own heading.

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
