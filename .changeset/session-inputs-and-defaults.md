---
'@rhinestone/sdk': major
---

Remove deprecated inputs and apply stricter Smart Session defaults.

- Replace top-level SDK `apiKey` with `auth: { mode: 'apiKey', apiKey }`. Empty or undefined removed keys also reject; nested API-key/JWT auth and service credentials remain supported.
- Replace `SolanaPasskeyPermission` with `SolanaAuthorityPermission` from `@rhinestone/sdk/solana`.
- Replace definition-input `claimPolicies` with standard `crossChainPermits`. Arbitrary custom-spender definitions are no longer supported. Preserve compiled `Session.claimPolicies` when restoring authorized sessions; do not rebuild persisted grants through definition resolution.
- Omitted or empty settlement layers now select all enforceable served layers; inspect dropped coverage. Explicit lists must be fully enforceable. Open fallback is opt-in and retains its ACROSS default.
- Permit2 permits default to scoped actions. Reusable scoped `maxAmount` is a lifetime budget on counted approval/value paths, not existing allowances or arbitrary actions. Re-enabling an already-enabled budgeted session requires `allowBudgetReset: true`.
- Action windows and default deployed policies can change permissionId and enable digests. Persist resolved sessions; new definitions do not upgrade installed grants. Once sessions allow at most one settlement transaction per participating chain, not one operation.
