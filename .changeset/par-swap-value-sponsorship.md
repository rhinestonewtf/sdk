---
'@rhinestone/sdk': minor
---

Let a caller ask for a par same-chain swap with `sponsored.swapValue`.

- The sponsor pays the market shortfall so the user trades 1:1 — they contribute the par amount and the integrator covers the difference between that and what the swap actually costs. Distinct from `swaps`, which waives a fee Rhinestone charges; this one is the exchange rate itself, so it moves real tokens.
- Object form only. `sponsored: true` does not enable it, because par spends the integrator's balance at the exchange rate rather than forgiving a line item.
- Omitted from the request when unset rather than sent as `false`: the field rides the server-signature surface, where a present-but-false key is different canonical bytes from an absent one.
- `SponsorSettings` now carries `swapValue`, so sponsorship servers reading `PreparedTransactionData.intentInput` or a JWT callback see it without a cast.

Setting it is a request, not a guarantee — the orchestrator also gates par on a kill switch and a per-client allowlist.
