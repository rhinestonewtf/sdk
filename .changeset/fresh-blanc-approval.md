---
"@rhinestone/sdk": minor
---

Bind JWT sponsorship approval during Blanc quotation instead of submission, preserving the legacy callback input. Add `computeBlancIntentInputDigest` to `@rhinestone/sdk/jwt-server` for custom signers. Upgrade client and signing-backend SDK installations together and explicitly set `apiVersion: 'blanc'` on `createJwtSigner` or the Web/Express handler config to enable normalized Blanc quote binding. The default is `apiVersion: 'alps'`, preserving the raw callback digest for legacy Alps submission approval. Callback payloads and transaction inputs remain unchanged; each Blanc quote attempt requires a fresh extension/JTI, even after a failed planning request. Approval occurs before wallet signing; submission uses ordinary access authentication only. Denials and callback errors propagate without an automatic unsponsored retry. A missing callback can yield user-paid routes: inspect `quote.cost.fees.breakdown` sponsorship flags.

Custom signers must apply `computeBlancIntentInputDigest` to the unchanged legacy numeric-chain/serialized-amount callback input, not hash raw JCS or a Blanc wire body. Generic `computeIntentInputDigest` remains unchanged. Sponsorship filters still check only destination chain, account and calls; cryptographic binding does not add policy checks.
