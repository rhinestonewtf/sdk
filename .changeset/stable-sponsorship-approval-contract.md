---
'@rhinestone/sdk': major
---

Name the sponsorship approval input `contractVersion: 'sdk-3.0.0-caucasus'`. Earlier v3 snapshots sent `sdk-caucasus-singular-2026-09-v1`; the projection and digest rule are unchanged, so only the identifier, and therefore the digest, differs.

- `/jwt-server`'s `shouldSponsor` and `SponsorshipFilter` accept `sdk-3.0.0-caucasus`, the `sdk-caucasus-singular-2026-09-v1` input of earlier v3 snapshots, and the legacy input of v2 clients. Any other `contractVersion` is still refused.
- Deploy the updated helpers, or a signer that accepts `sdk-3.0.0-caucasus`, on your backend before your clients send the new identifier. Older helpers refuse it and the prepare fails.
- `SerializedIntentInput['contractVersion']` is now `'sdk-3.0.0-caucasus'`.
- A Solana transaction prepared under the interim identifier fails restore with `InvalidSolanaTransactionArtifactError`; prepare it again.
