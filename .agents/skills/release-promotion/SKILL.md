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
3. **Publish.** Merging the version PR runs build, unit tests and the full integration suite. It then publishes `@latest`
   over OIDC and opens the SDK-reference PR in `docs`. An npm publish cannot be undone.
   - Confirm with `npm view @rhinestone/sdk dist-tags`.

Both PRs need an approving review. Passing checks alone never unblock them.
