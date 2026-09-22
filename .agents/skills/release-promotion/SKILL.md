---
name: release-promotion
description: Promotes @rhinestone/sdk from main to release and publishes it to npm @latest. Use when a main → release "Release" PR is open, a changeset has to reach @latest, or a release PR is stuck BEHIND or unapproved.
---

# Release promotion

Publishing v2 to `@latest` takes two PRs into `release`, both titled "Release" and opened by `rhinestone-automations`.
Merging the first publishes nothing.

1. **Promotion PR (`main` → `release`).** The Release workflow opens it after a `main` push with unreleased changesets
   publishes `@dev`. It is usually `BEHIND`, because the previous `chore: release` commit exists only on `release`.
   The `release` ruleset requires up-to-date `build`, `test` and `release-package-contract` checks, plus one approving
   review that any push dismisses.
   - Run `gh pr update-branch <n> --repo rhinestonewtf/sdk` BEFORE asking for approval. It pushes a merge of `release` into `main`.
   - Wait for the checks, get the approval, then merge with a merge commit, as earlier promotions were.
2. **Version PR (`changeset-release/release` → `release`).** Merging the promotion runs `changesets/action`, which
   opens or updates this PR with the version bump.
3. **Publish.** Merging the version PR runs build, unit tests and the full integration suite, then publishes `@latest`
   over OIDC and creates the GitHub Release. An npm publish cannot be undone.
   - Confirm with `npm view @rhinestone/sdk dist-tags`.
4. **Reference sync.** The GitHub Release triggers a separate `Sync SDK reference` run, which opens or updates the
   reviewed docs-main PR from `update/sdk-reference`. Inspect this status separately from the package Release run.
   A docs failure does not invalidate the npm publication: retry the docs-only run for a transient failure, or ship an
   automation fix normally and confirm it on a later publish. Never republish an existing package version to repair docs.

Both release PRs need an approving review. Passing checks alone never unblocks them. Recovery is confirmed only by a
later production publish completing both the package run and the independent reference sync; do not trigger one while
preparing or reviewing the automation change.
