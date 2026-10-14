---
'@rhinestone/sdk': minor
---

Support EVM → Solana token delivery: fund an intent from managed EVM sources and deliver SPL tokens to a Solana wallet.

- Set `destination.chain` to `solanaMainnet` or `solanaDevnet` with a base58 `destination.token`, funded from an EVM `source`; the delivery recipient is the explicit `destination.recipient`, otherwise the configured Solana receiver, otherwise the account's own Solana wallet.
- Read the delivering provider's own destination chain id from `quote.bridgeFill` on ECO routes, the id that resolves a Solana fill against that provider's status API.
