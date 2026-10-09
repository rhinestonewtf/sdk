---
'@rhinestone/sdk': minor
---

Settlement-scoped permits (`CCTP`, `OFT`, `ECO_IE`, `SAME_CHAIN_IE`, `LZ`) can opt into paying an intent's app fee and unsponsored gas with `allowFees: true` ([RHI-7884](https://linear.app/rhinestone/issue/RHI-7884)).

- The session may then transfer the `from` token to the orchestrator's fee collector, approve the paymaster, and call the paymaster's `callbackAllowMaxAmount` for that token. Each of these calls has its own cumulative cap of 5 USD (30 USD on Ethereum mainnet), not one per session: the transfer and the approve one per `from` token, the callback one shared across tokens. So one token can pay up to about twice the cap (app fee plus gas), and N tokens up to N times the cap of app fee.
- A fee call the layer does not already make gets its own action (UniversalActionPolicy, or ArgPolicy for a callback over several tokens); one the layer makes joins that action's ArgPolicy as an OR.
- Every `from` token on the session's chain must be one the orchestrator serves for these layers and lists in `settlement.usdStablecoins` at 6 decimals (the cap is a 6-decimal USD amount), and the chain's `GET /chains` `settlement.fees` block must be present, so create the session with `sdk.createSession`.
- The orchestrator sizes the paymaster approve and callback at the refund ceiling (about 1.8x the gas estimate) and the fee transfer at the full fee, so an intent whose ceiling or fee exceeds the remaining cap (e.g. Ethereum mainnet gas at high prices, an app fee over the cap, or a reusable session that has used its budget) is refused: it fails closed.
- Off by default: sessions without `allowFees` are unchanged. `allowFees` on a Permit2-layer permit throws.
