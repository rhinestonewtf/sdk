---
'@rhinestone/sdk': minor
---

Run Solana instructions on a same-chain intent from a managed Solana account. No orchestrator route serves them yet, so a well-formed request is refused with `UNSUPPORTED_DESTINATION_INSTRUCTIONS` until one ships; the SDK surfaces that reason unchanged.

- Pass `{ chain, instructions, addressLookupTables? }`. The instructions run out of the account's own Solana wallet, so the transaction is tokenless and names no recipient — the payee is encoded inside the instructions. Mixing them with `tokenRequests`, `recipient`, EVM calls or fees is rejected in the types and before the quote.
- Instructions are accepted both as the JSON Jupiter's `/swap-instructions` returns and as `@solana/web3.js` instruction objects, and are normalized to the wire shape. No Solana runtime dependency is added. `@solana/kit` instructions are not accepted; convert them first.
- Order, account metadata, signer flags and data bytes are preserved verbatim. The published request limits — 32 instructions, 64 accounts each, 1232 bytes of data in total, 8 address lookup tables — are checked locally, so an oversized request fails before a round trip.
- `PreparedTransactionData.execution` gains a third arm: narrow on `kind === 'solana-instructions'`.
- New public types: `SameChainSolanaInstructionsTransaction`, `SolanaInstruction`, `SolanaAccountMeta`, `SolanaProgramInstruction`, `SolanaInstructionInput`, `SolanaInstructionsExecutionMetadata`.
