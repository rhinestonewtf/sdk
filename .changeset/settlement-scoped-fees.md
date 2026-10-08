---
'@rhinestone/sdk': minor
---

Settlement-scoped permits (`CCTP`, `OFT`, `ECO_IE`, `SAME_CHAIN_IE`, `LZ`) can opt into paying an intent's app fee and unsponsored gas with `allowFees: true` ([RHI-7884](https://linear.app/rhinestone/issue/RHI-7884)).

- The session may then transfer the `from` token to the orchestrator's fee collector and approve the paymaster, each capped at 5 USD cumulative per `from` token (up to 10 USD per token including gas), and call the paymaster's `callbackAllowMaxAmount` for that token within one 5 USD budget shared across tokens.
- Every `from` token on the session's chain must be one the orchestrator serves for these layers (USD stablecoins today), and the chain's `GET /chains` `settlement.fees` block must be present, so create the session with `sdk.createSession`.
- The orchestrator sizes the paymaster approve and callback at the refund ceiling (about 1.8x the gas estimate) and the fee transfer at the full fee, so an intent whose ceiling or fee exceeds the remaining cap (e.g. Ethereum mainnet gas at high prices, an app fee over 5 USD, or a reusable session that has used its budget) is refused: it fails closed.
- Off by default: sessions without `allowFees` are unchanged. `allowFees` on a Permit2-layer permit throws.
