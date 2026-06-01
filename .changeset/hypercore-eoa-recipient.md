---
'@rhinestone/sdk': patch
---

Send HyperCore recipients as EOA-typed orchestrator accounts. HyperCore recipients are EVM EOAs, but `getRecipient` emitted them as a bare `{ address }` (the Solana/Tron shape, with no `accountType`). The orchestrator's HyperCore planning gate strictly requires `accountType === 'EOA'`, so deposits were rejected at `/quotes` with "HyperCore destinations require an EOA recipient". HyperCore now takes the EVM passthrough (`accountType: 'EOA'`) while remaining solver-mediated for signing.
