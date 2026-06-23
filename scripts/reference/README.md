# SDK reference generation

Generates the Mintlify "SDK Reference" tab in the [docs repo](../../../docs) from
the SDK's JSDoc.

## How it works

1. `typedoc --json` (config: `typedoc.json`) extracts a structured model of the
   public API into `typedoc.json.out` (a gitignored build artifact).
2. `generate.ts` walks the curated `manifest.ts`, looks up each symbol in that
   model, and renders one MDX page per symbol against a fixed template
   (Import / Usage / Parameters / Returns / See also). It then patches the
   `SDK Reference` tab into `docs/docs.json`.

```
bun run reference            # extract + generate (run from the sdk repo root)
bun run reference:extract    # typedoc JSON only
bun run reference:generate   # render MDX from existing JSON
```

Output paths default to the sibling `docs` repo and can be overridden:

- `SDK_REF_OUT` — output dir (default `../../docs/sdk-reference`)
- `SDK_REF_DOCS_JSON` — docs.json to patch (default `../../docs/docs.json`)

## Scope

Hot path only: entry points, the account instance, actions, and utils. Types,
errors, jwt-server, and the standalone `/smart-sessions` module are out of scope.
Edit `manifest.ts` to change what is documented and how it is grouped.

## Content sources

- **Prose, params, returns** come from JSDoc on the exported symbol. For account
  instance methods, the canonical JSDoc lives on the `RhinestoneAccount`
  interface members (that is what TypeDoc reads), not the inner implementations.
- **Code samples** come from `@example` blocks in the JSDoc. Without one, a
  minimal usage snippet is synthesized from the signature.
- **`@remarks`** renders as a `<Note>`; experimental entries get a `<Warning>`.
- **Hand-written pages** listed in `MANUAL_PAGES` (e.g. `introduction.mdx`)
  survive regeneration.

## Note for maintainers

The generated MDX is committed to the docs repo — Mintlify builds from repo
content, so the pages must be present in git. Re-run `bun run reference` and
commit the result whenever the public API or its JSDoc changes.
