---
'@rhinestone/sdk': major
---

Name the source of a Solana-origin transaction with `sourceAssets`, as on EVM, and cap what the Swig wallet may debit. Managed Solana now also runs on production.

- A Solana → EVM delivery takes `sourceAssets: [{ chain, address, amount? }]` instead of `sourceTokens: [{ address }]`. Migrate by moving the mint into `address` and adding the source cluster as `chain`. A leftover `sourceTokens` is refused with a pointer to `sourceAssets`, including in a prepared transaction persisted before this change.
- `amount` is a ceiling on the source debit, not the delivered amount. With a destination amount the route must fit under it; without one it spends the smaller of the balance and the ceiling. A quote whose source input exceeds it is refused before signing. Omit `amount` for today's uncapped behavior.
- A same-chain SPL transfer accepts the same optional `sourceAssets` entry, naming the transfer's cluster and mint with an `amount` no smaller than the one sent. Instruction executions take no `sourceAssets`.
- Export `SolanaSourceAsset` from `@rhinestone/sdk/solana`.
- Managed Solana accounts are accepted on production with the default endpoint (`https://v1.orchestrator.rhinestone.dev`) as well as on development with `https://dev.v1.orchestrator.rhinestone.dev`; any other environment/endpoint pair throws `ManagedSolanaAccountNotSupportedError`. Both environments support the same operations. On production the Swig derived from a managed EVM account uses the `prod-v1` namespace, so it differs from the development Swig of the same EVM account, and execution metadata carries `namespace: 'prod-v1'`.
