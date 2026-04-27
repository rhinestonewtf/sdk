---
'@rhinestone/sdk': major
---

Drop the local EIP-712 builders that became dead code once the
orchestrator started emitting `signData` per quote.

`getCompactTypedData`, `getCompactDigest`, `getPermit2Digest`, the
Permit2 `getTypedData` helper, and the single-chain-ops typed-data
builder are removed. The Permit2 batch/sequential signing helpers
(`signPermit2Batch`, `signPermit2Sequential`) are also dropped from the
public surface along with their `MultiChainPermit2Config`,
`MultiChainPermit2Result`, and `BatchPermit2Result` types — they signed
over the now-removed `IntentOp` shape and have no equivalent in the
blanc flow. Permit2 allowance utilities (`checkERC20Allowance`,
`checkERC20AllowanceDirect`, `getPermit2Address`) and the compact
constants (`COMPACT_ADDRESS`, `SCOPE_MULTICHAIN`, `RESET_PERIOD_ONE_WEEK`)
remain.
