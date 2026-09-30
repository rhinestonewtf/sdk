---
'@rhinestone/sdk': minor
---

Settlement-scoped permits (`CCTP`, `OFT`, `ECO_IE`, `SAME_CHAIN_IE`, `LZ`) can opt into paying an intent's app fee and unsponsored gas with `allowFees: true` ([RHI-7884](https://linear.app/rhinestone/issue/RHI-7884)).

- The session may then transfer the `from` token to the orchestrator's fee collector, approve the paymaster, and call its `callbackAllowMaxAmount` for that token, each capped at 5 USD cumulatively.
- Every `from` token on the session's chain must be a USD stablecoin the orchestrator serves, and the chain's `GET /chains` `settlement.fees` block must be present, so create the session with `sdk.createSession`.
- Off by default: sessions without `allowFees` are unchanged. `allowFees` on a Permit2-layer permit throws.
