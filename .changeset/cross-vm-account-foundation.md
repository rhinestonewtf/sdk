---
'@rhinestone/sdk': major
---

Replace the flat EVM account API with a capability-aware cross-VM account foundation.

- Wrap existing EVM configuration in `createAccount({ evm: config })` and select addresses with `account.getAddress('evm')`.
- Configure address-only Solana destinations with `{ solana: { address: solanaAddress(value) } }`; use a managed Solana account for Solana-origin execution.
- Restrict explicit delivery recipients to token delivery. Omit `destination.recipient` when destination calls should execute through the invoking managed EVM account.
