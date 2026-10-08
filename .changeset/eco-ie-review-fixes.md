---
'@rhinestone/sdk': patch
---

Harden settlement-scoped permits (RHI-7826):

- Read `settlement.usdStablecoins` from the orchestrator's `GET /chains`, kept only when every entry is well-formed.
- `ECO_IE` prices the delivery against the reward 1:1, rescaled between the two tokens' served decimals, so its `maxFeeBps` floor now refuses a `from` or `to` token the orchestrator does not serve as a USD stablecoin with known decimals, and refuses when `usdStablecoins` is absent.
- `ECO_IE` refuses a `validUntil` less than 7 days ahead: the session pins Eco's reward deadline under it, and Eco quotes that deadline about 7 days out, so a shorter session could never settle.
- An intent whose explicit `settlementLayers` filter removes every layer the session permits now throws instead of sending `{ include: [] }`.
- `SAME_CHAIN` and `ECO` are documented as deprecated in favor of `SAME_CHAIN_IE` and `ECO_IE`.
