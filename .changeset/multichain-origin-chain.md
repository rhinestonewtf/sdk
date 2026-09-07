---
'@rhinestone/sdk': patch
---

Accept a chain-agnostic origin payload, so an intent whose legs are covered by one signature can be signed.

The orchestrator can serve a multi-leg IntentExecutor bundle as a single `MultiChainOps` payload: the contract verifies it with `_hashTypedDataSansChainId`, so the EIP-712 domain deliberately carries no `chainId` and each leg's chain lives in its own `ChainOps` leaf. Reading the chain off the domain therefore produced `Invalid chain id: NaN` and failed the intent — on this path, after the user had already approved it. The chain now falls back to the leaves, and a payload naming no chain at all throws with the payload's type instead of coercing to `NaN`.
