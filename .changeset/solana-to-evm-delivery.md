---
'@rhinestone/sdk': minor
---

Support Solana → EVM token delivery: spend a managed Solana account's SPL balance and receive a token on an EVM chain.

- Pass `sourceChains: [solanaDevnet]`, `sourceTokens: [{ address: mint }]`, an EVM `targetChain` and one `tokenRequests` entry. Omit the delivery amount to spend the whole balance of that mint, and omit `recipient` to deliver to the account's own EVM address.
- Authorization is the existing Solana model: one `personalSign` origin payload, no destination signature, and the same short validity window. Costs keep each leg in its own namespace — base58 on the Solana input, hex on the EVM output.
- `PreparedTransactionData.execution` is now a union. Narrow on `kind` — `'solana'` for a same-chain transfer, `'solana-cross-chain'` for a delivery, which carries `destinationChain`, `destinationToken` and a hex `recipient`.
- Unsupported shapes are refused before a quote is requested: destination calls or instructions, HyperCore actions, sponsorship, more than one source or destination token, mixed-VM sources, and a non-EVM destination.
