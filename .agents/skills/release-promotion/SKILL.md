---
name: release-promotion
description: Promotes @rhinestone/sdk v3 from main to release and publishes it to npm @latest. Use when a main → release "Release" PR is open, a changeset has to reach @latest, or a release PR is stuck BEHIND or unapproved.
---

# Release promotion

Publishing v3 to `@latest` takes two PRs into `release`, both titled "Release" and opened by `rhinestone-automations`. Merging the first publishes nothing.

## Before promotion

- Freeze/lock the historical `solana` branch and reconcile every queued or in-flight publishing run. Its old workflow can otherwise race `main` for the shared `@dev` tag.
- Confirm the checked-in local candidate manifest and default `x-sdk-version` header are `3.0.0-rc.0`. It is a local bootstrap identity, not an npm prerelease channel.
- Calculate the Changesets plan from the promotion tree. It must consume the pending v3 changesets once and produce exactly `3.0.0`; do not pre-bump the manifest or enable Changesets prerelease mode.
- Run the contract check against the exact release-PR base. The first promotion compares a v2 base with the v3 candidate under declared major changesets. Once the baseline exposes `/evm` and `/solana`, select v3 fixtures on both sides and retain strict v3 compatibility for version-only or patch follow-ups. Run the pre-v3 ancestor (`1529637ccc2553b28bfcba3adb8bf6ac40285228`) separately as the historical v2 migration audit; it does not replace the real baseline check.

## Promotion

1. **Promotion PR (`main` → `release`).** The Release workflow opens it after a `main` push with unreleased changesets publishes `@dev`. It is usually `BEHIND`, because the previous `chore: release` commit exists only on `release`. The `release` ruleset requires up-to-date `build`, `test` and `release-package-contract` checks, plus one approving review that any push dismisses.
   - Run `gh pr update-branch <n> --repo rhinestonewtf/sdk` before asking for approval. It pushes a merge of `release` into `main`.
   - Reconfirm the exact Changesets plan after updating the branch, wait for checks, get approval, then merge with a merge commit.
2. **Version PR (`changeset-release/release` → `release`).** Merging the promotion runs `changesets/action`, which opens or updates this PR with the stable `3.0.0` bump, matching header, changelog, and consumed changesets.
3. **Publish.** Merging the version PR runs build, unit tests and the full integration suite. It then publishes `@latest` over OIDC and opens the SDK-reference PR in `docs`. An npm publish cannot be undone.
   - Confirm with `npm view @rhinestone/sdk dist-tags` and verify the exact `3.0.0` package/header before handing the reference PR to RHI-8273.

Both PRs need an approving review. Passing checks alone never unblock them. V2 maintenance publishing remains owned by RHI-8326.
