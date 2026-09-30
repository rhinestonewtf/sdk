---
'@rhinestone/sdk': minor
---

Add and remove passkeys on a managed Solana account's Swig. Pass `{ chain, authority: addPasskey(passkey, { permission }) }` or `{ chain, authority: removePasskey(passkey) }` to `prepareTransaction`, then sign, submit and wait as usual.

- `addPasskey` and `removePasskey` come from `@rhinestone/sdk/solana`. They take a viem `WebAuthnAccount` or a P-256 public key in any encoding, and compress it. `permission` is `'all'` or `'allButManageAuthority'`. It is required on an add and rejected on a remove.
- The configured owner, ECDSA or passkey, signs the change with one prompt. Available on standalone and composite accounts with a managed Solana entry; address-only receivers can't use it.
- Always gas-sponsored and billed to the integrator's sponsorship, like `deploy('solana', …)`. An authority change can't take fees, tokens, a recipient or instructions.
- The quote is checked before signing: one `manageAuthority` signing request, and a plan disclosing the same action, key, permission, role id and rent.
- The orchestrator's refusals throw `SolanaAuthorityChangeRefusedError` from `@rhinestone/sdk/errors`, with `reason`, `swigAddress`, `roleId`, `roleIds` and `permission`. Detect it with `isSolanaAuthorityChangeRefused`. After an uncertain outcome, prepare the same change again: `authority_exists` with the same permission, or `authority_not_found` on a remove, means the change already landed.
- New public types: `SameChainSolanaAuthorityTransaction`, `SolanaAuthorityChange`, `SolanaAuthorityKey`, `SolanaPasskeyPermission`, `SolanaAuthorityDisclosure`, `SolanaAuthorityExecutionMetadata` (execution `kind: 'solana-authority'`) and `SolanaAuthorityChangeRefusalReason`. `SigningScope` and `PlanExecution` gain the Solana authority-change variants.
- Every other Solana transaction type now declares `authority?: never`.
