---
'@rhinestone/sdk': minor
---

Create a managed Solana account's Swig with `account.deploy(solanaChain, { swigId? })`, a sponsored deployment intent that installs the configured owner as the Swig's root and resolves once it completes.

- Add `createSolanaSwigId()`, which mints an independent Swig id with the Swig and wallet addresses it derives. The Swig derived from a managed EVM account needs no id.
- Add `SolanaAccountAlreadyCreatedError` and `isSolanaAccountAlreadyCreated` to `@rhinestone/sdk/errors` for a Swig that already exists.
- Widen `purpose` on intent statuses to `'execution' | 'deployment'`.
