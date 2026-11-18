---
'@rhinestone/sdk': minor
---

Derive a managed Solana account's Swig from its owner when the account configuration names no `swig`.

- `createAccount({ solana: { owner } })` uses the Swig reserved for the owner's public key, so the same owner always yields the same Swig. An ECDSA owner must be a viem local account (such as `privateKeyToAccount`), which carries its public key.
- `account.deploy('solana', chain)` creates that Swig from its reservation and takes no `swigId`. A Swig minted with `createSolanaSwigId()` still needs its saved `swigId`.
