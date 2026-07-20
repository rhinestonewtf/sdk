---
'@rhinestone/sdk': minor
---

Add `customDeadline` transaction option to override the on-chain fill deadline. Accepts an absolute unix timestamp (seconds) and is honored only on the tokenless (same-chain / no-funding) route — ignored elsewhere. Bounds (`now + 120s` .. `now + 86400s`) are enforced by the orchestrator. When honored, the quoted `expiresAt` and the bundle claim/nonce expiry track this value automatically.
