# Code generation

The repo generates two artifacts. Neither is hand-edited — regenerate instead.

| Artifact            | Source                          | Output                          | Command              |
| ------------------- | ------------------------------- | ------------------------------- | -------------------- |
| SDK Reference (MDX) | JSDoc on public symbols         | `docs` repo `wallets/custom-signer/sdk-reference/` | `bun run generate:reference` |
| Orchestrator wire types | Orchestrator OpenAPI spec   | `src/clients/orchestrator/wire.gen.ts`  | `bun run generate:wire` |

## SDK Reference

The docs site's "SDK Reference" tab is generated from this repo's JSDoc, so the
doc comment you write on a public symbol ships verbatim to integrators. For how
to *write* those comments, use the `jsdoc` skill; this section is the pipeline.

### How it works

1. `generate:reference:extract` — `typedoc --json` (config `scripts/reference/typedoc.json`)
   extracts a structured model of the public API into `typedoc.json.out`
   (gitignored build artifact).
2. `generate:reference:render` — `scripts/reference/generate.ts` walks the curated
   `scripts/reference/manifest.ts`, looks up each symbol in that model, and
   renders one MDX page per symbol against a fixed template (Import / Usage /
   Parameters / Returns / See also). It then patches the `SDK reference` group
   under the Wallets → Custom signer menu in `docs/docs.json`. When the docs
   checkout carries unified-docs inventories, it synchronizes their generated
   page entries too.

```bash
bun run generate:reference            # extract + render (run from the sdk repo root)
bun run generate:reference:extract    # typedoc JSON only
bun run generate:reference:render     # render MDX from existing JSON
```

Output defaults to the sibling `docs` repo and can be overridden:

| Var | Purpose | Default |
| --- | --- | --- |
| `SDK_REF_OUT` | Output dir | `../docs/wallets/custom-signer/sdk-reference` |
| `SDK_REF_NAV_BASE` | Doc-root-relative generated path | `wallets/custom-signer/sdk-reference` |
| `SDK_REF_DOCS_JSON` | `docs.json` to patch | `../docs/docs.json` |
| `SDK_REF_TAB` | Host navigation tab | `Wallets` |
| `SDK_REF_MENU_ITEM` | Host menu item; set empty for legacy tab-level pages | `Custom signer` |
| `SDK_REF_SECTION_NAME` | Generated navigation group | `SDK reference` |
| `SDK_REF_OWNERSHIP_JSON` | Unified destination inventory | `../docs/unified-docs/ownership.json` |
| `SDK_REF_PATHS_FIXTURE` | Generated relative-path fixture | `../docs/scripts/fixtures/sdk-reference-paths.json` |
| `SDK_REF_DEFAULT_OWNER` | Owner for a generated page with no existing subtree metadata | `RHI-7109` |

The two inventory files are optional only as a pair, which keeps generation
compatible with docs branches predating the unified hierarchy. If present, the
generator preserves non-generated destinations and existing page ownership.
New pages inherit ownership from an unambiguous generated subtree, then fall
back to `SDK_REF_DEFAULT_OWNER`. Existing per-page metadata always wins.

### Scope and content

Hot path only: entry points, the account instance, actions, and utils. Types,
errors, `jwt-server`, and the standalone `/smart-sessions` module are out of
scope. Edit `manifest.ts` to change what is documented and how it is grouped —
the mapping is **curated, not automatic**, so the generator warns when a public
export in an already-documented module is missing from `manifest.ts`; add new
symbols there.

- Prose, params, returns come from JSDoc on the exported symbol. For
  account-instance methods the canonical JSDoc lives on the `RhinestoneAccount`
  interface members (what TypeDoc reads), not the implementations.
- Code samples come from `@example` blocks; without one a minimal snippet is
  synthesized from the signature.
- `@remarks` renders as a `<Note>`; experimental entries get a `<Warning>`.
- Hand-written pages in `MANUAL_PAGES` (e.g. `introduction.mdx`) survive
  regeneration.

### Committing

The generated MDX is committed to the `docs` repo — Mintlify builds from repo
content, so the pages must be present in git. Re-run `bun run generate:reference`
with the intended docs branch checked out as a sibling and commit the result
whenever the public API or its JSDoc changes.

Production releases currently target the docs integration branch configured by
the `SDK_REFERENCE_DOCS_BASE_BRANCH` GitHub repository variable, defaulting to
`integration/unified-wallet-docs`. After that branch merges at launch, set the
variable to `main`. The rolling output branch defaults to
`update/sdk-reference-unified`, separate from the pre-migration reference PR.

## Orchestrator wire types

`src/clients/orchestrator/wire.gen.ts` is generated from the orchestrator's published
OpenAPI spec (the `blanc` version) with `openapi-typescript`.

### Motivation

The generated wire types are the single source of truth for the orchestrator's
request/response shapes. The orchestrator mappers
(`src/clients/orchestrator/mappers.ts`, via the `wire.ts` aliases) adapt them to
the SDK's internal types — BigInt amounts, numeric chain ids —
at one boundary. When the wire shape drifts, regenerating turns the change into
a **typecheck error at the adapter boundary** instead of a runtime surprise.

### How it works

```bash
bun run generate:wire                          # default: pinned spec
bun run generate:wire ./path/to/blanc.json     # local checkout
ORCH_OPENAPI_SPEC=<url|path> bun run generate:wire
```

Spec source resolves as: CLI arg → `ORCH_OPENAPI_SPEC` env → pinned URL. The
default targets the `openapi` commit pinned in
`src/clients/orchestrator/.openapi-ref` — `orchestrator/blanc.json` at that SHA
in the public `rhinestonewtf/openapi` repo, so no auth is needed.

### Pin and auto-sync

The pin makes regeneration deterministic: `openapi/main` moves whenever the
rolling spec PR the orchestrator opens there is merged, so generating against it
live would break *every* open SDK PR the moment upstream moves. Pinning means the
per-PR CI check (`Verify wire types match the published OpenAPI spec`)
regenerates against a fixed SHA and only ever reflects intentional bumps.

A new orchestrator field is therefore **two merges** from being usable here: the
spec PR in `rhinestonewtf/openapi`, then the sync PR below.

The pin is advanced by the [`Sync wire types`](../.github/workflows/sync-wire-types.yaml)
workflow (hourly cron + `workflow_dispatch`), the *only* thing that changes
`wire.gen.ts`: it detects when `openapi/main` is ahead of the pin, bumps
`.openapi-ref`, regenerates, typechecks, and opens/updates a rolling PR. A regen
that fails typecheck (breaking upstream change) fails the job without opening a
PR, so open PRs keep building until a human adapts the boundary. The pin is
per-branch, so the v2 dev (`main`) and prod (`release`) lines can differ.
