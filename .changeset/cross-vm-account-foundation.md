---
'@rhinestone/sdk': major
---

Replace the flat EVM account API with a capability-aware cross-VM account foundation.

- Wrap existing EVM configuration in `createAccount({ evm: config })` and select addresses with `account.getAddress('evm')`.
- Configure address-only Solana destinations with `{ solana: { address: solanaAddress(value) } }`; managed Solana construction and Solana-origin execution are not enabled yet.
- Restrict explicit delivery recipients to token delivery. Omit `recipient` when destination calls should execute through the invoking managed EVM account.
