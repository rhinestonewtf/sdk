---
'@rhinestone/sdk': patch
---

Prevent unusable WebAuthn signatures by deriving client-data offsets and normalizing P-256 signatures to low-s before packing. Supplied `challengeIndex` and `typeIndex` values remain accepted for compatibility but no longer override the values derived from `clientDataJSON`.
