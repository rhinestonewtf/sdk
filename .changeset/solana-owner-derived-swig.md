---
'@rhinestone/sdk': minor
---

Derive a managed Solana account's Swig from its owner when the account configuration names no `swig`.

- `createAccount({ solana: { owner } })` uses the Swig reserved for the owner's public key, so the same owner always yields the same Swig. An ECDSA owner must be a viem local account (such as `privateKeyToAccount`), which carries its public key.
- `account.config.solana.swig` is typed for every managed Solana entry and holds that Swig. Save it, and configure it as `swig` to use that Swig with another key.
- `account.deploy('solana', chain)` creates that Swig from its reservation and takes no `swigId`. A Swig minted with `createSolanaSwigId()` still needs its saved `swigId`.
- The sponsorship approval input of that creation carries `account.svm.initData.reservation` in place of `id`.
- The derived Swig follows the configured owner and is the same in development and production. It is never the Swig a managed EVM account pairs with, so it makes plain deliveries only; name that Swig with `swig` to keep EVM destination calls.
- A passkey owner whose public key is not a point on P-256 is refused before any request: by `createAccount` when it derives the Swig, and by `deploy('solana', …)`.
