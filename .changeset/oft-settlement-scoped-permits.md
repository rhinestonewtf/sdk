---
'@rhinestone/sdk': minor
---

Add `OFT` (USDT0 over LayerZero) as a settlement-scoped cross-chain permit layer (RHI-7826). A `crossChainPermits` entry with `settlementLayers: ['OFT']` restricts the session to `USDT0.approve(adapter)` and the adapter's `send`, on the chains the USDT0 mesh reaches (the SDK bundles each chain's adapter, eid and token):

- Pinned in `send`: the `to` chains' eids paired with their recipients, a non-zero `amountLD` capped by `maxAmount` (cumulative), `refundAddress` = the account, a zero LayerZero-token fee, and the canonical tuple layout with empty `extraOptions`, `composeMsg` and `oftCmd` — so no native drop or compose call can ride along.
- `send` may carry any `msg.value`: it pays the LayerZero fee, and the pinned refund address returns any excess to the account. The session definition therefore needs `account`.
- The `from` token and every `to` token must be USDT0 on its chain. `sendMax` (max-out behind an origin swap) is not authorised.
- A permit now names exactly one IntentExecutor layer (`CCTP` or `OFT`).
