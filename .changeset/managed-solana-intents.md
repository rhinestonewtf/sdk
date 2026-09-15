---
'@rhinestone/sdk': major
---

Add development-only managed Solana accounts and same-chain SPL intent execution.

- Pair an ECDSA-owned Solana branch with a managed EVM account to derive its precreated `dev-v1` Swig wallet.
- Prepare, sign, and submit one same-chain SPL transfer on Solana mainnet or devnet with tagged `personalSign` payloads.
- Expose Solana execution metadata, native transaction references, lifecycle errors, and the `solanaDevnet` descriptor.
- Make destination signing data and signatures optional for routes that do not require them.
