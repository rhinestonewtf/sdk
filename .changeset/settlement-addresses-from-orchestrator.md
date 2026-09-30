---
'@rhinestone/sdk': minor
---

IntentExecutor-layer permits (`CCTP`, `OFT`, `ECO_IE`, `LZ`) now read the addresses they pin from the orchestrator's `GET /chains` per-chain `settlement` block instead of tables bundled in the SDK (RHI-7826). `sdk.createSession` passes them automatically; the standalone `toSession(definition, { settlement })` takes them as `options.settlement` (`SettlementCatalog`), and a permit naming one of these layers without them throws. `SAME_CHAIN_IE` pins no served address and is unchanged.

- There is no bundled fallback: a chain whose `/chains` entry lacks a layer's block refuses that layer, as an unsupported chain did before.
- The orchestrator is trusted for these addresses, so the pins bound a hostile session key, not a compromised orchestrator.
- An `ECO_IE` leg may name any prover served on both of its chains, and its stablecoins follow the orchestrator's registry rather than a bundled list.
