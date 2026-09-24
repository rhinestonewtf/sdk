---
'@rhinestone/sdk': major
---

`deploy` now names its VM first, and a managed Solana account can create its Swig with it.

- Deploy an EVM account with `account.deploy('evm', chain, { sponsored })`. `account.deploy(chain, …)` no longer compiles.
- Create a managed Solana account's Swig with `account.deploy('solana', solanaChain, { swigId })`: a sponsored deployment intent that installs the configured owner as the Swig's root and resolves `true` once the Swig exists, including when it already did. `swigId` is required without managed EVM; on a composite account the Swig derived from the EVM account needs none.
- Add `createSolanaSwigId()`, which mints an independent Swig id with the Swig and wallet addresses it derives.
- Widen `purpose` on intent statuses to `'execution' | 'deployment'`.
