---
'@rhinestone/sdk': minor
---

Add an experimental spend-session abstraction (`experimental_defineSpendSession`) that formulates the session-policy combination from a business-level spend (tokens, amounts, recipients, target chains, settlement layers), covering same-chain and Across/Eco cross-chain routes with optional one-time-use. Adds a byte-exact encoder for the IntentExecutor settlement-layer policy family (CCTP/Relay/Rhino adapters) and an `erc1271Policies` install path on the session definition. The IntentExecutor-backed layers are refused until that policy is deployed.
