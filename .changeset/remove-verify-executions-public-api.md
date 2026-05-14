---
'@rhinestone/sdk': major
---

Remove `verifyExecutions` from the public session signer API. Previously callers could override the SDK's heuristic by setting `verifyExecutions` on `SingleSessionSignerSet`, `PerChainSessionSignerSet`, or per-chain `ChainSessionConfig`. The field is now fully internal: the SDK resolves it from `session.hasExplicitPermissions` (true when the session declares `permissions: [...]`, false otherwise).

**Migration**: drop `verifyExecutions` from any `signers` object you build. Build sessions with `permissions: [...]` to opt into emissary execution validation, or without to use claim-only validation.
