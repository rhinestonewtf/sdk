---
'@rhinestone/sdk': major
---

`/jwt-server`'s `shouldSponsor` and `SponsorshipFilter` no longer accept `sdk-caucasus-singular-2026-09-v1`, the interim approval input of earlier v3 snapshots. They refuse it like any other unknown `contractVersion`, and the orchestrator no longer binds grants under it. Upgrade clients still on an earlier v3 snapshot, and update any sponsorship policy or signer that matches on `sdk-caucasus-singular-2026-09-v1` to match `sdk-3.0.0-caucasus`.
