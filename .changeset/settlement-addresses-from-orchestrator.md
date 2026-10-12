---
'@rhinestone/sdk': minor
---

IntentExecutor-layer permits (`CCTP`, `OFT`, `ECO_IE`, `LZ`) read the addresses they pin from the orchestrator's `GET /chains` `settlement` block, so create such sessions with `sdk.createSession`; resolving one without those addresses throws. `SAME_CHAIN_IE` is unaffected.

- The orchestrator is trusted for these addresses: the pins bound a hostile session key, not a compromised orchestrator.
- `ECO_IE` provers and stablecoins follow the orchestrator's registry.
