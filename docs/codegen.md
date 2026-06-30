# Code generation

The repo generates two artifacts. Neither is hand-edited — regenerate instead.

| Artifact            | Source                          | Output                          | Command              |
| ------------------- | ------------------------------- | ------------------------------- | -------------------- |
| SDK Reference (MDX) | JSDoc on public symbols         | `docs` repo `sdk-reference/`    | `bun run reference`  |
| Orchestrator wire types | Orchestrator OpenAPI spec   | `src/orchestrator/wire.gen.ts`  | `bun run generate:wire` |

## SDK Reference

The docs site's "SDK Reference" tab is generated from this repo's JSDoc, so the
doc comment you write on a public symbol ships verbatim to integrators. For how
to *write* those comments, use the `jsdoc` skill; this section is the pipeline.

### How it works

1. `reference:extract` — `typedoc --json` (config `scripts/reference/typedoc.json`)
   extracts a structured model of the public API into `typedoc.json.out`
   (gitignored build artifact).
2. `reference:generate` — `scripts/reference/generate.ts` walks the curated
   `scripts/reference/manifest.ts`, looks up each symbol in that model, and
   renders one MDX page per symbol against a fixed template (Import / Usage /
   Parameters / Returns / See also). It then patches the `SDK Reference` tab into
   `docs/docs.json`.

```bash
bun run reference            # extract + generate (run from the sdk repo root)
bun run reference:extract    # typedoc JSON only
bun run reference:generate   # render MDX from existing JSON
```

Output defaults to the sibling `docs` repo and can be overridden:

| Var                 | Purpose                          | Default                  |
| ------------------- | -------------------------------- | ------------------------ |
| `SDK_REF_OUT`       | Output dir                       | `../../docs/sdk-reference` |
| `SDK_REF_DOCS_JSON` | `docs.json` to patch             | `../../docs/docs.json`   |

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
content, so the pages must be present in git. Re-run `bun run reference` with
the `docs` repo checked out as a sibling and commit the result whenever the
public API or its JSDoc changes.

## Orchestrator wire types

`src/orchestrator/wire.gen.ts` is generated from the orchestrator's published
OpenAPI spec (the `blanc` version) with `openapi-typescript`.

### Motivation

The generated wire types are the single source of truth for the orchestrator's
request/response shapes. The orchestrator client (`src/orchestrator/client.ts`)
adapts them to the SDK's internal types — BigInt amounts, numeric chain ids —
at one boundary. When the wire shape drifts, regenerating turns the change into
a **typecheck error at the adapter boundary** instead of a runtime surprise.

### How it works

```bash
bun run generate:wire                          # default: published spec
bun run generate:wire ./path/to/blanc.json     # local checkout
ORCH_OPENAPI_SPEC=<url|path> bun run generate:wire
```

Spec source resolves as: CLI arg → `ORCH_OPENAPI_SPEC` env → published URL. The
default is the public `rhinestonewtf/openapi` repo
(`orchestrator/blanc.json`), so no auth is needed. After an orchestrator API
change, regenerate and let `tsc` surface anything the client must adapt.
