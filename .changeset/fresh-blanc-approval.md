---
"@rhinestone/sdk": minor
---

Bind JWT sponsorship approval during Blanc quotation instead of submission, preserving the legacy callback input. Add `computeBlancIntentInputDigest` to `@rhinestone/sdk/jwt-server` for custom signers. Upgrade client and signing-backend SDK installations together and explicitly set `apiVersion: 'blanc'` on `createJwtSigner` or the Web/Express handler config to enable normalized Blanc quote binding. The default is `apiVersion: 'alps'`, preserving the raw callback digest for legacy Alps submission approval. Callback payloads and transaction inputs remain unchanged; each Blanc quote attempt requires a fresh approval.
