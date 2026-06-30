---
name: changesets
description: Writes, reviews, and polishes @rhinestone/sdk changesets. Use when adding release notes, editing .changeset/*.md files, preparing SDK releases, or reviewing changelog wording.
---

# SDK Changesets

Use this skill for `@rhinestone/sdk` changesets and changelog wording.

## Workflow

1. Inspect the actual code diff, affected exports, and existing `.changeset/*.md` files before writing.
2. Choose severity from consumer impact:
   - `major`: breaking public API, removed exports, renamed fields, changed return shapes, changed required call flow, or changed runtime semantics consumers must migrate.
   - `minor`: additive public API or newly supported chain/token/flow.
   - `patch`: bug fix, behavior correction, internal compatibility fix, typing fix that does not require migration.
3. Use the standard frontmatter shape:

```md
---
'@rhinestone/sdk': patch
---
```

4. Write for SDK consumers and integrators. Lead with what changed and why they care.
5. Keep small fixes to one sentence. Use flat bullets only when the change is broad enough that scanning matters.
6. Run `bun run check` after changing changesets.

When editing unpublished prerelease changesets, it is safe to improve wording. Do not change frontmatter severity, delete files listed in `.changeset/pre.json`, or edit `pre.json` unless the release intent changed.

## Style

- Prefer direct verbs: `Add`, `Drop`, `Expose`, `Fix`, `Remove`, `Support`, `Replace`, `Normalize`.
- Do not prefix bodies with `**Breaking:**`, `**BREAKING**:`, `Fix:`, `Feature:`, or similar labels. Changesets already groups output under `Major Changes`, `Minor Changes`, and `Patch Changes`.
- For major changes, include migration guidance inline when there is a direct replacement.
- Avoid implementation postmortems, internal file/function names, and orchestrator plumbing unless the detail is part of the public contract.
- Avoid subheaders inside a changeset. Use one opening sentence plus flat bullets for large changes.
- Avoid vague lines like `Fix bug`, `Update API`, or `Add support`. Name the API, field, account type, chain, or behavior.
- Avoid noisy routine details in release notes: dependency bump mechanics, refactor rationale, test-only changes, and internal cleanup rarely matter unless they change consumer behavior.
- Keep formatting consistent: single-quoted package name in frontmatter, backticks for API names, no markdown headings in the body.

## Examples

Small patch:

```md
---
'@rhinestone/sdk': patch
---

Fix `experimental_enableSession` dropping `permissions` on scoped sessions, which caused the emissary to reject the enable. The function now accepts a resolved `Session`.
```

Additive minor:

```md
---
'@rhinestone/sdk': minor
---

Expose `BridgeFill` on quote responses, a per-intent tracking handle for third-party bridge layers (`OFT`, `RELAY`, `NEAR`, `RHINO`, `CCTP`).
```

Breaking change with migration hint:

```md
---
'@rhinestone/sdk': major
---

Drop the `account.sendTransaction(transaction)` shortcut. Use the `prepareTransaction` -> `signTransaction` -> `submitTransaction` flow instead.
```

Broad breaking change:

```md
---
'@rhinestone/sdk': major
---

Align SDK with the orchestrator's new operation model (blanc API version).

- `IntentStatus` reduced to 3 states: `PENDING`, `COMPLETED`, `FAILED`. Removed: `PRECONFIRMED`, `CLAIMED`, `FILLED`, `EXPIRED`.
- `IntentOpStatus` response shape replaced with flat per-chain `operations[]`. Removed: `claims`, `fillTransactionHash`, `fillTimestamp`, `destinationChainId`.
- `TransactionStatus` now contains `status`, `accountAddress`, and `operations[]` instead of `fill` / `claims`.
- `waitForExecution` no longer accepts the `acceptsPreconfirmations` parameter.
```

## Review Checklist

- Does the changeset describe the consumer-visible effect, not the implementation journey?
- Is the severity accurate for the public API and runtime behavior?
- Can a migrator understand what to replace or remove?
- Is the body brief enough for a generated changelog?
- Are superseded or duplicate prerelease notes still true in the final release context?
