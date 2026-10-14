# Code generation

The repo generates two artifacts. Neither is hand-edited — regenerate instead.

| Artifact            | Source                          | Output                          | Command              |
| ------------------- | ------------------------------- | ------------------------------- | -------------------- |
| SDK Reference (MDX) | JSDoc on public symbols         | `docs` repo `wallets/custom-signer/sdk-reference/` | `bun run generate:reference` |
| Orchestrator wire types | Orchestrator OpenAPI spec   | `src/clients/orchestrator/wire.gen.ts`  | `bun run generate:wire` |

## SDK Reference

The docs site's Wallets → Custom signer → SDK reference group is generated
from this repo's JSDoc, so the doc comment you write on a public symbol ships
verbatim to integrators. For how to *write* those comments, use the `jsdoc`
skill; this section is the pipeline.

### How it works

1. `generate:reference:extract` — `typedoc --json` (config `scripts/reference/typedoc.json`)
   extracts a structured model of the public API into `typedoc.json.out`
   (gitignored build artifact).
2. `generate:reference:render` — `scripts/reference/generate.ts` walks the curated
   `scripts/reference/manifest.ts`, looks up each symbol in that model, and
   renders one MDX page per symbol against a fixed template (Import / Usage /
   Parameters / Returns / See also). It then patches the `SDK reference` group
   under the Wallets → Custom signer menu in `docs/docs.json`.

```bash
bun run generate:reference            # extract + render (run from the sdk repo root)
bun run generate:reference:extract    # typedoc JSON only
bun run generate:reference:render     # render MDX from existing JSON
```

Output defaults to the sibling `docs` repo. Filesystem controls support
isolated CI validation without changing public routes or navigation:

| Var | Purpose | Default |
| --- | --- | --- |
| `SDK_REF_OUT` | Dedicated generated output directory | `../docs/wallets/custom-signer/sdk-reference` |
| `SDK_REF_DOCS_JSON` | `docs.json` to patch; a missing file skips navigation patching | `../docs/docs.json` |
| `SDK_REF_TYPEDOC_JSON` | TypeDoc model consumed by the renderer | `scripts/reference/typedoc.json.out` |
| `SDK_REF_CHECK` | Set to `1` to fail on unresolved manifest symbols or undocumented exports | unset |

An existing `docs.json` must contain exactly one Wallets tab and one Custom
signer menu item. Unsupported or ambiguous navigation fails instead of falling
back to a legacy location. The generated group always uses the canonical
`wallets/custom-signer/sdk-reference` route root.

### Reference example gate

`bun run test:reference` builds the SDK, extracts fresh TypeDoc, renders into an
isolated `.scratch/reference-examples-*` directory, packs `src/`, and compiles
every rendered TypeScript Usage block against the packed public package. It
currently covers 73 pages and 78 blocks. The inventory comes from the manifest,
so additions, missing Usage blocks, stale context registrations, malformed
fences, non-public imports, casts, and suppressions fail closed.

The gate keeps overload Usage blocks separate and checks their inferred return
types, including both signing and polling contracts. It also runs negative
compiler probes for missing auth, legacy transaction fields, missing exports,
and unsupported account capabilities. Every fixture and probe shares a single
compiler program; a probe passes only when its own file reports the expected TS
code, and any other diagnostic fails the gate. Each heavy step runs under a
per-step RSS budget with a host-wide lock; see
[Testing](testing.md#reference-examples) for the budget, lock, and pass
criteria. Reference generation and this validation gate run in CI only; do not
run them locally, reconstruct their heavy steps manually, replace them with
source-alias typechecking, or execute snippets that can submit transactions.

### Scope and content

Hot path only: entry points, the account instance, actions, and the
`/solana` and `/evm` helpers. Types,
errors, `jwt-server`, and the standalone `/smart-sessions` module are out of
scope. Edit `manifest.ts` to change what is documented and how it is grouped —
the mapping is **curated, not automatic**, so the generator warns when a public
export in an already-documented module is missing from `manifest.ts`; add new
symbols there.

- Prose, params, returns come from JSDoc on the exported symbol. For
  account-instance methods, put the comment on the capability interface member
  that exposes it (`RhinestoneAccountBase`, `ManagedTransactionAccount`,
  `ManagedEvmAccount`, `SolanaStandaloneAccount`, or
  `ManagedSolanaDeployment`), not the composed `RhinestoneAccount` alias or an
  implementation.
- Code samples come from `@example` blocks; without one a minimal snippet is
  synthesized from the signature.
- `@remarks` renders as a `<Note>`; experimental entries get a `<Warning>`.
- Files explicitly listed in `MANUAL_PAGES` survive regeneration. The list is
  currently empty; the output directory is otherwise generator-owned.

### Committing

Canonical generated MDX is committed to the `docs` repo because Mintlify builds
from repository content. Local output overrides are for preview and validation;
they do not publish production documentation automatically.

Successful production v2 publishes generate reviewed docs update PRs. Dev
snapshots, v1 publishes, and release-PR creation do not update the production
reference. See
the [release workflow](../.github/workflows/release.yaml) for the operational
details.

## Orchestrator wire types

`src/clients/orchestrator/wire.gen.ts` is generated from the orchestrator's
OpenAPI document for the API version the SDK speaks (`2026-09.caucasus`) with
`openapi-typescript`.

### Motivation

The generated wire types are the single source of truth for the orchestrator's
request/response shapes. The orchestrator mappers
(`src/clients/orchestrator/mappers.ts`, via the `wire.ts` aliases) adapt them to
the SDK's internal types — BigInt amounts, narrowed signing requests — at one
boundary. When the wire shape drifts, regenerating turns the change into
a **typecheck error at the adapter boundary** instead of a runtime surprise.

### How it works

```bash
bun run generate:wire                            # default: the vendored snapshot
bun run generate:wire ./path/to/caucasus.json    # local checkout
ORCH_OPENAPI_SPEC=<url|path> bun run generate:wire
```

Source resolves as: CLI arg → `ORCH_OPENAPI_SPEC` env → the vendored snapshot.
Only an override resolves against your working directory; the default is
module-relative, so generation does not depend on where you ran it from.

### The vendored document

`2026-09.caucasus` is not in the orchestrator's published version set yet, so it
is absent from the public `rhinestonewtf/openapi` repo. The generated document
is therefore checked in at `scripts/openapi/caucasus.json`, with
`scripts/openapi/provenance.json` recording the API version, the upstream
repository, ref and commit it was generated from, the artifact's SHA-256, and
the command that produced it. The orchestrator generates it with its opt-in
`scripts/generateOpenApi.ts --version 2026-09.caucasus`.

The pinned document is the accepted singular-only Caucasus artifact from
orchestrator commit `30aa909db5053fbe67170513dfa21b4e0f984d09` (SHA-256
`b2ada4e7d36cd10cc91d682fff21937d6159ca46d0800f9e7e9d32fb4cda2fcd`).
`POST /quotes` and `POST /quotes/estimate` advertise only singular bodies, with
numeric EVM signature modes, corrected unions, nullable fields, and documented
errors. `WireSingularQuoteRequest` in `wire.ts` directly aliases the complete
quote request; `mapIntentRequestToWire` returns it, preserving the structural
check at the mapper. `provenance.test.ts` asserts the direct request schemas.
This alignment preserves SDK runtime behavior and does not resolve the
artifact's acknowledged upstream error-envelope and submit-coverage gaps.

Both are verified before generating: a snapshot whose bytes or declared version
disagree with the manifest fails loudly rather than producing plausible types
against a document nobody reviewed. Change the snapshot and the manifest hash in
the same commit.

### Determinism and auto-sync

Pinning the document makes regeneration deterministic: generating against a
moving upstream would break *every* open SDK PR the moment it moved. The per-PR
CI check (`Verify wire types match the pinned OpenAPI document`) regenerates and
diffs, so `wire.gen.ts` only ever reflects an intentional change.

Intentional, reviewed re-vendoring updates the snapshot, provenance, and
`wire.gen.ts` together. The [`Sync wire types`](../.github/workflows/sync-wire-types.yaml)
workflow (hourly cron + `workflow_dispatch`) handles future automated sync.
While Caucasus is unpublished it reports a clean no-op — it never
falls back to an older version, and never points at a file that does not exist.
Once the document is published it starts opening the rolling PR that swaps the
source to the immutable public commit, regenerates and typechecks. A regen that
fails typecheck (a breaking upstream change) fails the job without opening a PR,
so open PRs keep building until a human adapts the boundary.
