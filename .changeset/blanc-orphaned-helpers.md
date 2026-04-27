---
'@rhinestone/sdk': major
---

Drop EIP-712 helpers and Permit2 signers orphaned by the blanc switch.

- Remove the locally-built typed-data helpers that became dead code
  once the orchestrator started emitting `signData` per quote:
  `getCompactTypedData`, `getCompactDigest`, `getPermit2Digest`, the
  Permit2 `getTypedData` helper, and the single-chain-ops typed-data
  builder.
- Drop the Permit2 batch / sequential signing helpers
  (`signPermit2Batch`, `signPermit2Sequential`) and their
  `MultiChainPermit2Config`, `MultiChainPermit2Result`, and
  `BatchPermit2Result` types — they signed over the now-removed
  `IntentOp` and have no equivalent in blanc.
- Permit2 allowance utilities (`checkERC20Allowance`,
  `checkERC20AllowanceDirect`, `getPermit2Address`) and the compact
  constants (`COMPACT_ADDRESS`, `SCOPE_MULTICHAIN`,
  `RESET_PERIOD_ONE_WEEK`) remain.
